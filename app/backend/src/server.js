import express from 'express'
import cors from 'cors'
import http from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { PrismaClient } from '@prisma/client'
import jwt from 'jsonwebtoken'

const app = express()
const port = process.env.BACKEND_PORT || 8080
const prisma = new PrismaClient()

app.use(cors({ origin: '*', credentials: false }))
app.use(express.json())

// Cloudflare Accessからユーザー情報を取得するミドルウェア
app.use((req, res, next) => {
  const userEmail = req.headers['cf-access-authenticated-user-email']
  const jwtToken = req.headers['cf-access-jwt-assertion']
  
  if (userEmail) {
    let userName = userEmail.split('@')[0] // デフォルト: メールの@前
    let userPicture = null
    
    // JWTトークンからGoogleの表示名を取得を試みる
    if (jwtToken) {
      try {
        // JWTをデコード（署名検証なし、情報取得のみ）
        const decoded = jwt.decode(jwtToken)
        
        // Googleの名前が含まれている可能性のあるフィールド
        if (decoded?.name) {
          userName = decoded.name
        } else if (decoded?.given_name || decoded?.family_name) {
          userName = [decoded.given_name, decoded.family_name].filter(Boolean).join(' ')
        } else if (decoded?.custom?.name) {
          userName = decoded.custom.name
        }
        
        // プロフィール画像URLを取得
        userPicture = decoded?.picture || null
        
        console.log('JWT decoded:', { 
          name: decoded?.name, 
          given_name: decoded?.given_name, 
          email: decoded?.email, 
          picture: decoded?.picture 
        })
      } catch (err) {
        console.warn('Failed to decode JWT:', err.message)
      }
    }
    
    req.user = {
      email: userEmail,
      name: userName,
      picture: userPicture,
      isAuthenticated: true
    }
  } else {
    // 認証されていない場合（開発環境やIPアドレス直接アクセス）
    req.user = {
      isAuthenticated: false
    }
  }
  next()
})

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' })
})

// ログイン中のユーザー情報を返すAPI
app.get('/api/me', (req, res) => {
  if (req.user.isAuthenticated) {
    res.json({
      email: req.user.email,
      name: req.user.name,
      picture: req.user.picture || null
    })
  } else {
    res.json({
      email: null,
      name: null,
      picture: null
    })
  }
})

// 履歴取得: 最新50件を新しい順→クライアント側で古い順に並べ替え可能
app.get('/api/channels/:room/messages', async (req, res) => {
  const room = req.params.room
  try {
    // systemユーザーを先に用意（外部キー対策）
    const systemUser = await prisma.user.upsert({
      where: { email: 'system@local' },
      create: { id: 'system', email: 'system@local', name: 'system', passwordHash: 'n/a' },
      update: {}
    })

    // Serverを1つのデフォルトとして扱う
    const server = await prisma.server.upsert({
      where: { id: 'default' },
      create: { id: 'default', name: 'default', ownerId: systemUser.id },
      update: {}
    })

    const channel = await prisma.channel.upsert({
      where: { id: `${server.id}:${room}` },
      create: { id: `${server.id}:${room}`, serverId: server.id, name: room },
      update: {}
    })

    const messages = await prisma.message.findMany({
      where: { room: room },
      orderBy: { createdAt: 'desc' },
      take: 50
    })
        // author名、アバター画像、作成時刻を返す
        const serialized = messages
          .reverse()
          .map(m => ({
            id: m.id,
            username: m.username,
            picture: null,
            content: m.content,
            ts: m.createdAt,
            editedAt: m.editedAt
          }))
    res.json(serialized)
  } catch (e) {
    // DB未準備時も落ちないようにする
    res.status(200).json([])
  }
})

// メッセージ編集API
app.put('/api/messages/:messageId', async (req, res) => {
  const { messageId } = req.params
  const { content } = req.body
  const currentUser = req.user

  if (!currentUser.isAuthenticated || !currentUser.email) {
    return res.status(401).json({ error: 'Google OAuth authentication required' })
  }

  try {
    // メッセージの存在確認と所有者確認
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { author: true }
    })

    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // 現在のユーザーがメッセージの所有者かチェック
    const currentUserRecord = await prisma.user.findUnique({
      where: { email: currentUser.email }
    })

    if (!currentUserRecord || message.userId !== currentUserRecord.id) {
      return res.status(403).json({ error: 'You can only edit your own messages' })
    }

    // メッセージを更新
    const updatedMessage = await prisma.message.update({
      where: { id: messageId },
      data: {
        content,
        editedAt: new Date()
      },
      include: { author: true }
    })

    res.json({
      id: updatedMessage.id,
      username: updatedMessage.author?.name ?? 'unknown',
      picture: updatedMessage.author?.avatarUrl || null,
      content: updatedMessage.content,
      ts: updatedMessage.createdAt,
      editedAt: updatedMessage.editedAt
    })
  } catch (error) {
    console.error('Error updating message:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

// メッセージ削除API
app.delete('/api/messages/:messageId', async (req, res) => {
  const { messageId } = req.params
  const currentUser = req.user

  if (!currentUser.isAuthenticated || !currentUser.email) {
    return res.status(401).json({ error: 'Google OAuth authentication required' })
  }

  try {
    // メッセージの存在確認と所有者確認
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: { author: true }
    })

    if (!message) {
      return res.status(404).json({ error: 'Message not found' })
    }

    // 現在のユーザーがメッセージの所有者かチェック
    const currentUserRecord = await prisma.user.findUnique({
      where: { email: currentUser.email }
    })

    if (!currentUserRecord || message.userId !== currentUserRecord.id) {
      return res.status(403).json({ error: 'You can only delete your own messages' })
    }

    // メッセージを削除
    await prisma.message.delete({
      where: { id: messageId }
    })

    res.json({ success: true })
  } catch (error) {
    console.error('Error deleting message:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

const httpServer = http.createServer(app)
const io = new SocketIOServer(httpServer, {
  path: '/socket.io',
  cors: {
    origin: '*',
    credentials: false,
    methods: ['GET', 'POST']
  },
  allowEIO3: true,
  transports: ['polling', 'websocket'],
  pingTimeout: 60000,
  pingInterval: 25000
})

console.log('Socket.IO server initialized with path: /socket.io')

// オンラインユーザー一覧を取得する関数
async function getOnlineUsers(room) {
  try {
    const systemUser = await prisma.user.upsert({
      where: { email: 'system@local' },
      create: { id: 'system', email: 'system@local', name: 'system', passwordHash: 'n/a' },
      update: {}
    })
    
    const server = await prisma.server.upsert({
      where: { id: 'default' },
      create: { id: 'default', name: 'default', ownerId: systemUser.id },
      update: {}
    })
    
    const memberships = await prisma.membership.findMany({
      where: { serverId: server.id },
      include: { user: true }
    })
    
    return memberships.map(membership => ({
      username: membership.user.name,
      picture: membership.user.avatarUrl,
      joinedAt: membership.joinedAt
    }))
  } catch (error) {
    console.error('Error getting online users:', error)
    return []
  }
}

io.on('connection', socket => {
  console.log('Socket.IO client connected:', socket.id)
  
  socket.on('join', async ({ room, username, picture }) => {
    console.log(`User ${username} joining room: ${room}, socket.id: ${socket.id}`)
    socket.join(room)
    console.log(`Socket ${socket.id} joined room ${room}. Rooms:`, Array.from(socket.rooms))
    socket.data.username = username
    socket.data.picture = picture || null
    
    try {
      // システムユーザーとサーバーを準備
      const systemUser = await prisma.user.upsert({
        where: { email: 'system@local' },
        create: { id: 'system', email: 'system@local', name: 'system', passwordHash: 'n/a' },
        update: {}
      })
      
      const server = await prisma.server.upsert({
        where: { id: 'default' },
        create: { id: 'default', name: 'default', ownerId: systemUser.id },
        update: {}
      })
      
      const channel = await prisma.channel.upsert({
        where: { id: `${server.id}:${room}` },
        create: { id: `${server.id}:${room}`, serverId: server.id, name: room },
        update: {}
      })
      
      // ユーザーを準備
      const user = await prisma.user.upsert({
        where: { email: `${username}@local` },
        create: { email: `${username}@local`, name: username, passwordHash: 'n/a', avatarUrl: picture },
        update: { name: username, avatarUrl: picture }
      })
      
      // メンバーシップを確認・作成
      const existingMembership = await prisma.membership.findUnique({
        where: { userId_serverId: { userId: user.id, serverId: server.id } }
      })
      
      if (!existingMembership) {
        // 初回参加の場合のみ通知
        await prisma.membership.create({
          data: {
            userId: user.id,
            serverId: server.id,
            role: 'MEMBER'
          }
        })
        socket.to(room).emit('system', `${username}が参加しました`)
        console.log(`First time join: ${username} joined ${room}`)
      } else {
        console.log(`Already a member: ${username} in ${room}`)
      }
      
      // オンラインユーザー一覧を更新
      const onlineUsers = await getOnlineUsers(room)
      socket.emit('online_users', onlineUsers)
      socket.to(room).emit('online_users', onlineUsers)
      
    } catch (error) {
      console.error('Error handling join:', error)
      // エラーが発生しても参加通知は送信
      socket.to(room).emit('system', `${username}が参加しました`)
    }
  })

  socket.on('message', async ({ room, content, mentions = [] }) => {
    const username = socket.data.username || 'anonymous'
    const picture = socket.data.picture || null
    console.log(`Received message event from socket ${socket.id}:`, { room, content, username, mentions, socketRooms: Array.from(socket.rooms) })
    
    try {
      const systemUser = await prisma.user.upsert({
        where: { email: 'system@local' },
        create: { id: 'system', email: 'system@local', name: 'system', passwordHash: 'n/a' },
        update: {}
      })
      const server = await prisma.server.upsert({
        where: { id: 'default' },
        create: { id: 'default', name: 'default', ownerId: systemUser.id },
        update: {}
      })
      const channel = await prisma.channel.upsert({
        where: { id: `${server.id}:${room}` },
        create: { id: `${server.id}:${room}`, serverId: server.id, name: room },
        update: {}
      })
      // authorは匿名ユーザーを簡易表現
      const user = await prisma.user.upsert({
        where: { email: `${username}@local` },
        create: { email: `${username}@local`, name: username, passwordHash: 'n/a', avatarUrl: picture },
        update: { name: username, avatarUrl: picture }
      })
      const message = await prisma.message.create({
        data: {
          channelId: channel.id,
          userId: user.id,
          room: room,
          username: username,
          content
        }
      })
      
      // メッセージIDを含めて一度だけ送信
      const payload = { 
        id: message.id,
        room: room,  // チャンネル名を含める
        username, 
        picture, 
        content, 
        ts: message.createdAt.getTime(),
        editedAt: message.editedAt,
        mentions: mentions || [] // メンションされたユーザー名の配列
      }
      // そのチャンネルのメッセージとして送信
      console.log(`Emitting message to room: ${room}`, payload)
      // room内のsocket数を確認（デバッグ用）
      try {
        const socketsInRoom = await io.in(room).fetchSockets()
        console.log(`Sockets in room ${room}:`, socketsInRoom.length, socketsInRoom.map(s => ({ id: s.id, username: s.data.username })))
      } catch (err) {
        console.warn('Could not fetch sockets (this is okay):', err.message)
      }
      io.to(room).emit('message', payload)
      // 全てのクライアントに未読通知用に送信（チャンネル名を含むので、クライアント側でフィルタリング可能）
      console.log(`Emitting new_message to all clients`, payload)
      io.emit('new_message', payload)
    } catch (e) {
      // エラーが発生した場合でもリアルタイム通知は送信
      console.warn('persist failed:', e?.message)
      const payload = { room: room, username, picture, content, ts: Date.now(), mentions: mentions || [] }
      io.to(room).emit('message', payload)
      io.emit('new_message', payload)
    }
  })

  // メッセージ編集イベント
  socket.on('edit_message', async ({ room, messageId, content }) => {
    const username = socket.data.username || 'anonymous'
    const picture = socket.data.picture || null
    
    // 認証チェック（簡易版）
    if (!username || username === 'anonymous' || username === 'user') {
      socket.emit('error', { message: 'Authentication required' })
      return
    }
    
    try {
      // メッセージの存在確認と所有者確認
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { author: true }
      })

      if (!message) {
        socket.emit('error', { message: 'Message not found' })
        return
      }

      // 現在のユーザーがメッセージの所有者かチェック
      const currentUser = await prisma.user.findUnique({
        where: { email: `${username}@local` }
      })

      if (!currentUser || message.userId !== currentUser.id) {
        socket.emit('error', { message: 'You can only edit your own messages' })
        return
      }

      // メッセージを更新
      const updatedMessage = await prisma.message.update({
        where: { id: messageId },
        data: {
          content,
          editedAt: new Date()
        },
        include: { author: true }
      })

      // 全クライアントに編集を通知
      io.to(room).emit('message_edited', {
        id: updatedMessage.id,
        username: updatedMessage.author?.name ?? 'unknown',
        picture: updatedMessage.author?.avatarUrl || null,
        content: updatedMessage.content,
        ts: updatedMessage.createdAt,
        editedAt: updatedMessage.editedAt
      })
    } catch (error) {
      console.error('Error editing message:', error)
      socket.emit('error', { message: 'Failed to edit message' })
    }
  })

  // メッセージ削除イベント
  socket.on('delete_message', async ({ room, messageId }) => {
    const username = socket.data.username || 'anonymous'
    
    // 認証チェック（簡易版）
    if (!username || username === 'anonymous' || username === 'user') {
      socket.emit('error', { message: 'Authentication required' })
      return
    }
    
    try {
      // メッセージの存在確認と所有者確認
      const message = await prisma.message.findUnique({
        where: { id: messageId },
        include: { author: true }
      })

      if (!message) {
        socket.emit('error', { message: 'Message not found' })
        return
      }

      // 現在のユーザーがメッセージの所有者かチェック
      const currentUser = await prisma.user.findUnique({
        where: { email: `${username}@local` }
      })

      if (!currentUser || message.userId !== currentUser.id) {
        socket.emit('error', { message: 'You can only delete your own messages' })
        return
      }

      // メッセージを削除
      await prisma.message.delete({
        where: { id: messageId }
      })

      // 全クライアントに削除を通知
      io.to(room).emit('message_deleted', { id: messageId })
    } catch (error) {
      console.error('Error deleting message:', error)
      socket.emit('error', { message: 'Failed to delete message' })
    }
  })

  socket.on('disconnect', () => {
    // optional: broadcast leave
  })
})

httpServer.listen(port, () => {
  console.log(`backend listening on :${port}`)
  console.log(`Socket.IO server available at http://localhost:${port}/socket.io`)
})

