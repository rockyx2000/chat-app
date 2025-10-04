import express from 'express'
import cors from 'cors'
import http from 'http'
import { Server as SocketIOServer } from 'socket.io'
import { PrismaClient } from '@prisma/client'

const app = express()
const port = process.env.BACKEND_PORT || 8080
const prisma = new PrismaClient()

app.use(cors({ origin: '*', credentials: false }))
app.use(express.json())

app.get('/api/health', (_req, res) => {
  res.status(200).json({ status: 'ok' })
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
    // author名と作成時刻を返す
    const serialized = messages
      .reverse()
      .map(m => ({
        id: m.id,
        username: m.author?.name ?? 'unknown',
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
  cors: { origin: '*', credentials: false }
})

console.log('Socket.IO server initialized with path: /socket.io')

io.on('connection', socket => {
  console.log('Socket.IO client connected:', socket.id)
  
  socket.on('join', ({ room, username }) => {
    console.log(`User ${username} joining room: ${room}`)
    socket.join(room)
    socket.data.username = username
    socket.to(room).emit('system', `${username} joined`)
  })

  socket.on('message', ({ room, content }) => {
    const username = socket.data.username || 'anonymous'
    const payload = { username, content, ts: Date.now() }
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
          create: { email: `${username}@local`, name: username, passwordHash: 'n/a' },
          update: { name: username }
        })
        const created = await prisma.message.create({
          data: {
            channelId: channel.id,
            userId: user.id,
            content
          },
          include: { author: true }
        })
        // 正式な保存結果（正確な時刻）を送るイベント（任意）
        io.to(room).emit('message', {
          username: created.author?.name ?? username,
          content: created.content,
          ts: created.createdAt
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

