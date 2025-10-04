import React from 'react'
import { io } from 'socket.io-client'

export default function App() {
  const [health, setHealth] = React.useState('...')
  const [room, setRoom] = React.useState('general')
  const [username, setUsername] = React.useState('user')
  const [content, setContent] = React.useState('')
  const [messages, setMessages] = React.useState([])
  const socketRef = React.useRef(null)

  React.useEffect(() => {
    // ヘルスチェック
    fetch('/api/health')
      .then(r => r.json())
      .then(d => setHealth(d.status))
      .catch(() => setHealth('error'))
    
    // Cloudflare Accessで認証されたユーザー情報を取得
    fetch('/api/me')
      .then(r => r.json())
      .then(data => {
        if (data.name) {
          setUsername(data.name) // Googleアカウントの名前を自動設定
          console.log('Logged in as:', data.email)
        }
      })
      .catch(err => console.error('Failed to fetch user info:', err))
  }, [])

  const connect = async () => {
    if (socketRef.current) return

    // 履歴をロード
    try {
      const historyRes = await fetch(`/api/channels/${room}/messages`)
      const history = await historyRes.json()
      setMessages(history.map(msg => ({
        username: msg.username,
        content: msg.content,
        createdAt: new Date(msg.ts), // Dateオブジェクトに変換
      })))
    } catch (error) {
      console.error('Error loading message history:', error)
    }

    const socket = io({ path: '/socket.io', query: { username } })
    console.log('Socket.IO client connecting with username:', username)
    
    socket.on('connect', () => {
      console.log('Socket.IO client connected successfully')
      socket.emit('join', { room, username })
    })
    
    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error)
    })
    socket.on('system', msg => {
      setMessages(m => [...m, { system: true, content: msg }])
    })
    socket.on('message', msg => {
      setMessages(m => [...m, { ...msg, createdAt: new Date(msg.ts) }]) // Dateオブジェクトに変換
    })
    socketRef.current = socket
  }


  const send = () => {
    if (!socketRef.current || !content) return
    socketRef.current.emit('message', { room, content })
    setContent('')
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>Chat App</h1>
      <p>Backend health: {health}</p>

      <div style={{ marginTop: 16 }}>
        <input value={username} onChange={e => setUsername(e.target.value)} placeholder="name" />
        <input value={room} onChange={e => setRoom(e.target.value)} placeholder="room" style={{ marginLeft: 8 }} />
        <button onClick={connect} style={{ marginLeft: 8 }}>Connect</button>
      </div>

      <div style={{ marginTop: 16 }}>
        <input value={content} onChange={e => setContent(e.target.value)} placeholder="message" style={{ width: 300 }} />
        <button onClick={send} style={{ marginLeft: 8 }}>Send</button>
      </div>

      <ul style={{ marginTop: 16 }}>
        {messages.map((m, i) => (
          <li key={i}>
            {m.system ? (
              <em>{m.content}</em>
            ) : (
              <span>
                <b>{m.username}:</b> {m.content} <small>({m.createdAt.toLocaleTimeString()})</small>
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

