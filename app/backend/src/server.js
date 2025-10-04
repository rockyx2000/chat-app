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
      where: { channelId: channel.id },
      orderBy: { createdAt: 'desc' },
      include: { author: true },
      take: 50
    })
    // author名、アバター画像、作成時刻を返す
    const serialized = messages
      .reverse()
      .map(m => ({
        id: m.id,
        username: m.author?.name ?? 'unknown',
        picture: m.author?.avatar || null,
        content: m.content,
        ts: m.createdAt
      }))
    res.json(serialized)
  } catch (e) {
    // DB未準備時も落ちないようにする
    res.status(200).json([])
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

io.on('connection', socket => {
  console.log('Socket.IO client connected:', socket.id)
  
  socket.on('join', ({ room, username, picture }) => {
    console.log(`User ${username} joining room: ${room}`)
    socket.join(room)
    socket.data.username = username
    socket.data.picture = picture || null
    socket.to(room).emit('system', `${username} joined`)
  })

  socket.on('message', ({ room, content }) => {
    const username = socket.data.username || 'anonymous'
    const picture = socket.data.picture || null
    const payload = { username, picture, content, ts: Date.now() }
    io.to(room).emit('message', payload)
    // 永続化（失敗してもリアルタイムは継続）
    ;(async () => {
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
          create: { email: `${username}@local`, name: username, passwordHash: 'n/a', avatar: picture },
          update: { name: username, avatar: picture }
        })
        await prisma.message.create({
          data: {
            channelId: channel.id,
            userId: user.id,
            content
          }
        })
      } catch (e) {
        // ログに出す程度（本実装ではloggerを使う）
        console.warn('persist failed:', e?.message)
      }
    })()
  })

  socket.on('disconnect', () => {
    // optional: broadcast leave
  })
})

httpServer.listen(port, () => {
  console.log(`backend listening on :${port}`)
  console.log(`Socket.IO server available at http://localhost:${port}/socket.io`)
})

