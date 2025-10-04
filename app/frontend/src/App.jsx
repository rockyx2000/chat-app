import React from 'react'
import { io } from 'socket.io-client'
import './App.css'

export default function App() {
  const [health, setHealth] = React.useState('...')
  const [currentChannel, setCurrentChannel] = React.useState('general')
  const [username, setUsername] = React.useState('user')
  const [userPicture, setUserPicture] = React.useState(null)
  const [userEmail, setUserEmail] = React.useState(null)
  const [content, setContent] = React.useState('')
  const [messages, setMessages] = React.useState([])
  const [channels] = React.useState(['general', 'random', 'help'])
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
          setUsername(data.name)
          setUserPicture(data.picture)
          setUserEmail(data.email)
          console.log('Logged in as:', data.email)
        }
      })
      .catch(err => console.error('Failed to fetch user info:', err))
  }, [])

  const switchChannel = async (channelName) => {
    // 既存の接続を切断
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    
    setCurrentChannel(channelName)
    setMessages([])
    
    // 新しいチャンネルに接続
    await connectToChannel(channelName)
  }

  const connectToChannel = async (channelName) => {
    if (socketRef.current) return

    // 履歴をロード
    try {
      const historyRes = await fetch(`/api/channels/${channelName}/messages`)
      const history = await historyRes.json()
      setMessages(history.map(msg => ({
        username: msg.username,
        content: msg.content,
        createdAt: new Date(msg.ts),
      })))
    } catch (error) {
      console.error('Error loading message history:', error)
    }

    const socket = io({ path: '/socket.io', query: { username } })
    console.log('Socket.IO client connecting with username:', username)
    
    socket.on('connect', () => {
      console.log('Socket.IO client connected successfully')
      socket.emit('join', { room: channelName, username, picture: userPicture })
    })
    
    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error)
    })
    socket.on('system', msg => {
      setMessages(m => [...m, { system: true, content: msg }])
    })
    socket.on('message', msg => {
      setMessages(m => [...m, { ...msg, createdAt: new Date(msg.ts) }])
    })
    socketRef.current = socket
  }

  React.useEffect(() => {
    if (username && username !== 'user') {
      connectToChannel(currentChannel)
    }
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [username])


  const send = (e) => {
    e?.preventDefault()
    if (!socketRef.current || !content.trim()) return
    socketRef.current.emit('message', { room: currentChannel, content: content.trim() })
    setContent('')
  }

  const logout = () => {
    window.location.href = '/cdn-cgi/access/logout'
  }

  const getInitials = (name) => {
    if (!name) return '?'
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const messagesEndRef = React.useRef(null)
  
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="app-container">
      {/* サイドバー */}
      <div className="sidebar">
        <div className="server-header">
          <h2>Chat Server</h2>
        </div>
        
        <div className="channels-section">
          <div className="section-title">TEXT CHANNELS</div>
          {channels.map(channel => (
            <div
              key={channel}
              className={`channel-item ${currentChannel === channel ? 'active' : ''}`}
              onClick={() => switchChannel(channel)}
            >
              <span className="channel-hash">#</span>
              <span className="channel-name">{channel}</span>
            </div>
          ))}
        </div>
        
        <div className="user-panel">
          <div className="user-info">
            {userPicture ? (
              <img src={userPicture} alt="avatar" className="user-avatar-small" />
            ) : (
              <div className="user-avatar-small">{getInitials(username)}</div>
            )}
            <div className="user-details">
              <div className="user-name">{username}</div>
              <div className="user-status">オンライン</div>
            </div>
          </div>
          <button className="logout-btn" onClick={logout} title="Logout">
            🚪
          </button>
        </div>
      </div>

      {/* メインコンテンツ */}
      <div className="main-content">
        {/* チャンネルヘッダー */}
        <div className="channel-header">
          <span className="channel-hash">#</span>
          <span className="channel-title">{currentChannel}</span>
          <div className="health-indicator">
            <span className={`health-dot ${health === 'ok' ? 'online' : 'offline'}`}></span>
            Backend: {health}
          </div>
        </div>

        {/* メッセージエリア */}
        <div className="messages-area">
          <div className="messages-list">
            {messages.map((m, i) => (
              <div key={i} className={m.system ? 'system-message' : 'message'}>
                {m.system ? (
                  <div className="system-content">{m.content}</div>
                ) : (
                  <>
                    <div className="message-avatar">
                      {m.picture ? (
                        <img src={m.picture} alt={m.username} className="avatar-img" />
                      ) : (
                        <div className="avatar-placeholder">{getInitials(m.username)}</div>
                      )}
                    </div>
                    <div className="message-content">
                      <div className="message-header">
                        <span className="message-username">{m.username}</span>
                        <span className="message-timestamp">
                          {m.createdAt.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                      <div className="message-text">{m.content}</div>
                    </div>
                  </>
                )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* 入力エリア */}
        <div className="input-area">
          <form onSubmit={send} className="message-form">
            <input
              type="text"
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder={`#${currentChannel} にメッセージを送信`}
              className="message-input"
            />
            <button type="submit" className="send-btn" disabled={!content.trim()}>
              送信
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

