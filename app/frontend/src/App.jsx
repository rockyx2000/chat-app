import React from 'react'
import { io } from 'socket.io-client'
import {
  Box,
  Paper,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  TextField,
  IconButton,
  Chip,
  Skeleton,
  CircularProgress,
  Divider
} from '@mui/material'
import {
  Tag as HashIcon,
  ExitToApp as LogoutIcon,
  Send as SendIcon,
  Circle as OnlineIcon,
  Edit as EditIcon,
  Delete as DeleteIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Security as SecurityIcon,
  Login as LoginIcon,
  MoreVert as MoreVertIcon,
  Reply as ReplyIcon,
  ContentCopy as CopyIcon,
  PushPin as PinIcon
} from '@mui/icons-material'
import { ThemeProvider, createTheme } from '@mui/material/styles'
import CssBaseline from '@mui/material/CssBaseline'

// Material UI ダークテーマ（Discord風）
const discordTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#5865f2', // Discord blue
    },
    secondary: {
      main: '#f04747', // Discord red
    },
    background: {
      default: '#36393f', // Discord dark gray
      paper: '#2f3136', // Discord sidebar
    },
    text: {
      primary: '#ffffff',
      secondary: '#b9bbbe',
    },
  },
  typography: {
    fontFamily: '"Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif',
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundColor: '#2f3136',
        },
      },
    },
  },
})

export default function App() {
  const [health, setHealth] = React.useState('...')
  const [currentChannel, setCurrentChannel] = React.useState('general')
  const [username, setUsername] = React.useState('user')
  const [userPicture, setUserPicture] = React.useState(null)
  const [userEmail, setUserEmail] = React.useState(null)
  const [content, setContent] = React.useState('')
  const [messages, setMessages] = React.useState([])
  const [channels] = React.useState(['general', 'random', 'help'])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isConnecting, setIsConnecting] = React.useState(false)
  const [onlineUsers, setOnlineUsers] = React.useState([])
  const [editingMessage, setEditingMessage] = React.useState(null)
  const [editContent, setEditContent] = React.useState('')
  const [isAuthenticated, setIsAuthenticated] = React.useState(false)
  const [authError, setAuthError] = React.useState(null)
  const [contextMenu, setContextMenu] = React.useState(null)
  const contextMenuRef = React.useRef(null)
  const socketRef = React.useRef(null)

  React.useEffect(() => {
    const initializeApp = async () => {
      try {
        setIsLoading(true)
        
        // ヘルスチェック
        const healthResponse = await fetch('/api/health')
        const healthData = await healthResponse.json()
        setHealth(healthData.status)
        
        // Cloudflare Accessで認証されたユーザー情報を取得
        const userResponse = await fetch('/api/me')
        const userData = await userResponse.json()
        
        if (userData.name && userData.email) {
          setUsername(userData.name)
          setUserPicture(userData.picture)
          setUserEmail(userData.email)
          setIsAuthenticated(true)
          console.log('Logged in as:', userData.email)
        } else {
          setIsAuthenticated(false)
          setAuthError('Google OAuth認証が必要です。')
        }
      } catch (err) {
        console.error('Failed to initialize app:', err)
        setHealth('error')
      } finally {
        setIsLoading(false)
      }
    }
    
    initializeApp()
  }, [])

  const switchChannel = async (channelName) => {
    if (isConnecting) return
    
    console.log(`Switching to channel: ${channelName}`)
    setIsConnecting(true)
    
    // 既存の接続を切断
    if (socketRef.current) {
      console.log('Disconnecting existing socket')
      socketRef.current.disconnect()
      socketRef.current = null
    }
    
    setCurrentChannel(channelName)
    setMessages([])
    
    // 新しいチャンネルに接続
    console.log(`Connecting to channel: ${channelName}`)
    await connectToChannel(channelName)
    setIsConnecting(false)
    console.log(`Successfully switched to channel: ${channelName}`)
  }

  const connectToChannel = async (channelName) => {
    // 履歴をロード
    try {
      const historyRes = await fetch(`/api/channels/${channelName}/messages`)
      const history = await historyRes.json()
      setMessages(history.map(msg => ({
        id: msg.id,
        username: msg.username,
        content: msg.content,
        picture: msg.picture,
        createdAt: new Date(msg.ts),
        editedAt: msg.editedAt ? new Date(msg.editedAt) : null
      })))
      console.log(`Loaded ${history.length} messages for channel: ${channelName}`)
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
      setMessages(m => [...m, { 
        ...msg, 
        createdAt: new Date(msg.ts),
        editedAt: msg.editedAt ? new Date(msg.editedAt) : null
      }])
    })
    socket.on('user_joined', (userData) => {
      setOnlineUsers(prev => {
        const exists = prev.find(u => u.username === userData.username)
        if (!exists) {
          return [...prev, userData]
        }
        return prev
      })
    })
    socket.on('user_left', (userData) => {
      setOnlineUsers(prev => prev.filter(u => u.username !== userData.username))
    })
    socket.on('online_users', (users) => {
      setOnlineUsers(users)
    })
    socket.on('message_edited', (updatedMessage) => {
      setMessages(prev => prev.map(msg => 
        msg.id === updatedMessage.id ? { ...msg, ...updatedMessage, createdAt: new Date(updatedMessage.ts) } : msg
      ))
    })
    socket.on('message_deleted', ({ id }) => {
      setMessages(prev => prev.filter(msg => msg.id !== id))
    })
    socket.on('error', (error) => {
      console.error('Socket error:', error.message)
      // エラーメッセージを表示する場合はここで処理
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

  const startEdit = (message) => {
    setEditingMessage(message.id)
    setEditContent(message.content)
  }

  const cancelEdit = () => {
    setEditingMessage(null)
    setEditContent('')
  }

  const saveEdit = () => {
    if (!socketRef.current || !editingMessage || !editContent.trim()) return
    socketRef.current.emit('edit_message', { 
      room: currentChannel, 
      messageId: editingMessage, 
      content: editContent.trim() 
    })
    setEditingMessage(null)
    setEditContent('')
  }

  const deleteMessage = (messageId) => {
    if (!socketRef.current || !messageId) return
    if (window.confirm('このメッセージを削除しますか？')) {
      socketRef.current.emit('delete_message', { 
        room: currentChannel, 
        messageId 
      })
    }
  }

  const logout = () => {
    window.location.href = '/cdn-cgi/access/logout'
  }

  const retryAuth = () => {
    window.location.reload()
  }

  const handleContextMenu = (event, message) => {
    event.preventDefault()
    const rect = event.currentTarget.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const menuHeight = 300 // メニューの推定高さ
    
    // 画面の下に近い場合は上に表示
    let mouseY = event.clientY - 6
    if (event.clientY + menuHeight > viewportHeight) {
      mouseY = event.clientY - menuHeight - 6
    }
    
    setContextMenu({
      mouseX: event.clientX - 10, // メッセージにより近く配置
      mouseY: mouseY,
      message: message
    })
  }

  const handleMenuButtonClick = (event, message) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const menuHeight = 300 // メニューの推定高さ
    
    // 画面の下に近い場合は上に表示
    let mouseY = rect.bottom + 6
    if (rect.bottom + menuHeight > viewportHeight) {
      mouseY = rect.top - menuHeight - 6
    }
    
    setContextMenu({
      mouseX: rect.left - 10, // メッセージにより近く配置
      mouseY: mouseY,
      message: message
    })
  }

  const closeContextMenu = () => {
    setContextMenu(null)
  }

  const copyMessage = (content) => {
    navigator.clipboard.writeText(content)
    closeContextMenu()
  }

  const replyToMessage = (message) => {
    // 返信機能（将来実装）
    console.log('Reply to:', message)
    closeContextMenu()
  }

  const getInitials = (name) => {
    if (!name) return '?'
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)
  }

  const formatMessageTime = (date) => {
    const now = new Date()
    const messageDate = new Date(date)
    const diffInHours = (now - messageDate) / (1000 * 60 * 60)
    
    // 今日の場合
    if (diffInHours < 24 && messageDate.toDateString() === now.toDateString()) {
      return messageDate.toLocaleTimeString('ja-JP', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })
    }
    
    // 昨日の場合
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    if (messageDate.toDateString() === yesterday.toDateString()) {
      return `昨日 ${messageDate.toLocaleTimeString('ja-JP', { 
        hour: '2-digit', 
        minute: '2-digit' 
      })}`
    }
    
    // それ以前の場合
    return messageDate.toLocaleString('ja-JP', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short'
    })
  }

  const messagesEndRef = React.useRef(null)
  
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // コンテキストメニュー外をクリックした時にメニューを閉じる
  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (contextMenu) {
        closeContextMenu()
      }
    }

    if (contextMenu) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [contextMenu])

  // メニューの位置を動的に調整
  React.useEffect(() => {
    if (contextMenu && contextMenuRef.current) {
      const menu = contextMenuRef.current
      const rect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      
      let newX = contextMenu.mouseX
      let newY = contextMenu.mouseY
      
      // 右端にはみ出る場合（メッセージの左側に表示）
      if (rect.right > viewportWidth) {
        newX = contextMenu.mouseX - rect.width - 20 // メッセージの左側に配置
      }
      
      // 下端にはみ出る場合
      if (rect.bottom > viewportHeight) {
        newY = viewportHeight - rect.height - 10
      }
      
      // 上端にはみ出る場合
      if (newY < 0) {
        newY = 10
      }
      
      // 左端にはみ出る場合
      if (newX < 0) {
        newX = 10
      }
      
      if (newX !== contextMenu.mouseX || newY !== contextMenu.mouseY) {
        setContextMenu(prev => ({
          ...prev,
          mouseX: newX,
          mouseY: newY
        }))
      }
    }
  }, [contextMenu])

  // ローディング画面
  if (isLoading) {
    return (
      <ThemeProvider theme={discordTheme}>
        <CssBaseline />
        <Box sx={{ 
          display: 'flex', 
          height: '100vh', 
          bgcolor: 'background.default',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 2
        }}>
          <CircularProgress size={60} />
          <Typography variant="h6" color="text.secondary">
            チャットアプリを読み込み中...
          </Typography>
        </Box>
      </ThemeProvider>
    )
  }

  // 認証エラーページ
  if (!isAuthenticated) {
    return (
      <ThemeProvider theme={discordTheme}>
        <CssBaseline />
        <Box sx={{ 
          display: 'flex', 
          height: '100vh', 
          bgcolor: 'background.default',
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          gap: 3,
          p: 3
        }}>
          <Box sx={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            gap: 2,
            textAlign: 'center',
            maxWidth: 500
          }}>
            <SecurityIcon sx={{ fontSize: 80, color: 'error.main' }} />
            <Typography variant="h4" color="text.primary" fontWeight="bold">
              認証が必要です
            </Typography>
            <Typography variant="h6" color="text.secondary">
              {authError || 'Google OAuth認証が必要です。'}
            </Typography>
            <Typography variant="body1" color="text.secondary" sx={{ mt: 2 }}>
              このチャットアプリを使用するには、Googleアカウントでの認証が必要です。
              <br />
              管理者にお問い合わせいただくか、認証設定を確認してください。
            </Typography>
            <Box sx={{ display: 'flex', gap: 2, mt: 3 }}>
              <IconButton 
                onClick={retryAuth}
                sx={{ 
                  bgcolor: 'primary.main',
                  color: 'white',
                  px: 3,
                  py: 1,
                  '&:hover': {
                    bgcolor: 'primary.dark',
                    transform: 'scale(1.05)',
                  },
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                <LoginIcon sx={{ mr: 1 }} />
                再試行
              </IconButton>
              <IconButton 
                onClick={() => window.location.href = '/cdn-cgi/access/logout'}
                sx={{ 
                  bgcolor: 'error.main',
                  color: 'white',
                  px: 3,
                  py: 1,
                  '&:hover': {
                    bgcolor: 'error.dark',
                    transform: 'scale(1.05)',
                  },
                  transition: 'all 0.2s ease-in-out'
                }}
              >
                <LogoutIcon sx={{ mr: 1 }} />
                ログアウト
              </IconButton>
            </Box>
          </Box>
        </Box>
      </ThemeProvider>
    )
  }

  return (
    <ThemeProvider theme={discordTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
        {/* 左サイドバー */}
        <Paper 
          elevation={0} 
          sx={{ 
            width: 240, 
            bgcolor: 'background.paper',
            borderRadius: 0,
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* サーバーヘッダー */}
          <Box sx={{ 
            p: 2, 
            borderBottom: '1px solid', 
            borderColor: 'divider',
            bgcolor: 'background.paper'
          }}>
            <Typography variant="h6" color="text.primary" fontWeight="bold">
              Chat-app
            </Typography>
          </Box>
          
          {/* チャンネルリスト */}
          <Box sx={{ flex: 1, p: 1 }}>
            <Typography 
              variant="caption" 
              color="text.secondary" 
              sx={{ 
                px: 2, 
                py: 1, 
                display: 'block',
                textTransform: 'uppercase',
                fontWeight: 'bold',
                letterSpacing: 0.5
              }}
            >
              TEXT CHANNELS
            </Typography>
            <List dense>
              {channels.map(channel => (
                <ListItem key={channel} disablePadding>
                  <ListItemButton
                    selected={currentChannel === channel}
                    onClick={() => switchChannel(channel)}
                    disabled={isConnecting}
                    sx={{
                      borderRadius: 1,
                      mx: 1,
                      '&.Mui-selected': {
                        bgcolor: 'rgba(114, 137, 218, 0.1)',
                        '&:hover': {
                          bgcolor: 'rgba(114, 137, 218, 0.2)',
                        }
                      }
                    }}
                  >
                    <ListItemIcon sx={{ minWidth: 24 }}>
                      <HashIcon fontSize="small" color="text.secondary" />
                    </ListItemIcon>
                    <ListItemText 
                      primary={channel}
                      primaryTypographyProps={{
                        fontSize: '0.9rem',
                        color: currentChannel === channel ? 'text.primary' : 'text.secondary'
                      }}
                    />
                    {isConnecting && currentChannel === channel && (
                      <CircularProgress size={16} />
                    )}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          </Box>
          
          {/* ユーザーパネル */}
          <Box sx={{ 
            p: 1, 
            borderTop: '1px solid', 
            borderColor: 'divider',
            bgcolor: 'rgba(0,0,0,0.1)'
          }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
              <Avatar 
                src={userPicture} 
                sx={{ width: 32, height: 32, bgcolor: 'primary.main' }}
              >
                {getInitials(username)}
              </Avatar>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" color="text.primary" noWrap>
                  {username}
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <OnlineIcon sx={{ fontSize: 8, color: 'success.main' }} />
                  <Typography variant="caption" color="text.secondary">
                    オンライン
                  </Typography>
                </Box>
              </Box>
              <IconButton 
                size="small" 
                onClick={logout}
                sx={{ 
                  color: 'text.secondary',
                  '&:hover': {
                    color: 'error.main',
                    bgcolor: 'rgba(244, 67, 54, 0.1)',
                    transform: 'scale(1.1)',
                  },
                  transition: 'all 0.2s ease-in-out'
                }}
                title="ログアウト"
              >
                <LogoutIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </Paper>

        {/* メインコンテンツ */}
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          {/* チャンネルヘッダー */}
          <Box sx={{ 
            p: 2, 
            borderBottom: '1px solid', 
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minHeight: 64
          }}>
            <HashIcon color="text.secondary" />
            <Typography variant="h6" color="text.primary">
              {currentChannel}
            </Typography>
            <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
              <Chip
                icon={<OnlineIcon sx={{ fontSize: 8 }} />}
                label={`Backend: ${health}`}
                size="small"
                color={health === 'ok' ? 'success' : 'error'}
                variant="outlined"
              />
            </Box>
          </Box>

          {/* メッセージエリア */}
          <Box sx={{ 
            flex: 1, 
            overflow: 'auto', 
            p: 2,
            display: 'flex',
            flexDirection: 'column'
          }}>
            {messages.length === 0 && !isConnecting ? (
              <Box sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                height: '100%',
                flexDirection: 'column',
                gap: 2
              }}>
                <Typography variant="h6" color="text.secondary">
                  #{currentChannel} にようこそ！
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  メッセージを送信して会話を始めましょう
                </Typography>
              </Box>
            ) : (
              <Box>
                {messages.map((m, i) => (
                  <Box 
                    key={i} 
                    sx={{ 
                      mb: 2, 
                      display: 'flex', 
                      gap: 2,
                      p: 1,
                      borderRadius: 1,
                      transition: 'all 0.2s ease-in-out',
                      '&:hover': {
                        bgcolor: 'rgba(255, 255, 255, 0.05)',
                        transform: 'translateX(4px)',
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
                        '& .message-actions': {
                          opacity: 1
                        }
                      }
                    }}
                    onContextMenu={(e) => handleContextMenu(e, m)}
                  >
                    {m.system ? (
                      <Box sx={{ 
                        textAlign: 'center', 
                        width: '100%',
                        py: 0.5
                      }}>
                        <Typography 
                          variant="caption" 
                          color="text.secondary"
                          sx={{ 
                            bgcolor: 'rgba(79, 84, 92, 0.16)',
                            px: 1.5,
                            py: 0.25,
                            borderRadius: 0.5,
                            fontStyle: 'italic',
                            fontSize: '0.7rem'
                          }}
                        >
                          {m.content}
                        </Typography>
                      </Box>
                    ) : (
                      <>
                        <Avatar 
                          src={m.picture} 
                          sx={{ 
                            width: 40, 
                            height: 40, 
                            bgcolor: 'primary.main',
                            transition: 'all 0.2s ease-in-out',
                            '&:hover': {
                              transform: 'scale(1.05)',
                              boxShadow: '0 4px 12px rgba(88, 101, 242, 0.3)'
                            }
                          }}
                        >
                          {getInitials(m.username)}
                        </Avatar>
                        <Box sx={{ flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
                            <Typography 
                              variant="body2" 
                              color="text.primary" 
                              fontWeight="bold"
                              sx={{
                                transition: 'color 0.2s ease-in-out',
                                '&:hover': {
                                  color: 'primary.main'
                                }
                              }}
                            >
                              {m.username}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {formatMessageTime(m.createdAt)}
                            </Typography>
                            {m.editedAt && (
                              <Typography variant="caption" color="text.secondary" sx={{ fontStyle: 'italic' }}>
                                (編集済み)
                              </Typography>
                            )}
                          </Box>
                          
                          {editingMessage === m.id ? (
                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                              <TextField
                                fullWidth
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                variant="outlined"
                                size="small"
                                multiline
                                maxRows={4}
                                sx={{
                                  '& .MuiOutlinedInput-root': {
                                    bgcolor: 'rgba(255,255,255,0.05)',
                                    '&:hover': {
                                      bgcolor: 'rgba(255,255,255,0.1)',
                                    },
                                    '&.Mui-focused': {
                                      bgcolor: 'rgba(255,255,255,0.1)',
                                    }
                                  }
                                }}
                              />
                              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                                <IconButton 
                                  size="small" 
                                  onClick={saveEdit}
                                  sx={{ 
                                    bgcolor: 'success.main',
                                    color: 'white',
                                    '&:hover': {
                                      bgcolor: 'success.dark',
                                    }
                                  }}
                                >
                                  <CheckIcon fontSize="small" />
                                </IconButton>
                                <IconButton 
                                  size="small" 
                                  onClick={cancelEdit}
                                  sx={{ 
                                    bgcolor: 'error.main',
                                    color: 'white',
                                    '&:hover': {
                                      bgcolor: 'error.dark',
                                    }
                                  }}
                                >
                                  <CloseIcon fontSize="small" />
                                </IconButton>
                              </Box>
                            </Box>
                          ) : (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                              <Typography 
                                variant="body1" 
                                color="text.primary"
                                sx={{
                                  transition: 'color 0.2s ease-in-out',
                                  '&:hover': {
                                    color: 'text.secondary'
                                  }
                                }}
                              >
                                {m.content}
                              </Typography>
                              
                              {/* メニューボタン（ホバー時に表示） */}
                              <Box className="message-actions" sx={{ display: 'flex', gap: 0.5, opacity: 0, transition: 'opacity 0.2s ease-in-out' }}>
                                <IconButton 
                                  size="small" 
                                  onClick={(e) => handleMenuButtonClick(e, m)}
                                  sx={{ 
                                    color: 'text.secondary',
                                    '&:hover': {
                                      color: 'text.primary',
                                      bgcolor: 'rgba(255, 255, 255, 0.1)',
                                    }
                                  }}
                                  title="メッセージオプション"
                                >
                                  <MoreVertIcon fontSize="small" />
                                </IconButton>
                              </Box>
                            </Box>
                          )}
                        </Box>
                      </>
                    )}
                  </Box>
                ))}
                <div ref={messagesEndRef} />
              </Box>
            )}
          </Box>

          {/* 入力エリア */}
          <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box component="form" onSubmit={send} sx={{ display: 'flex', gap: 1 }}>
              <TextField
                fullWidth
                value={content}
                onChange={e => setContent(e.target.value)}
                placeholder={`#${currentChannel} にメッセージを送信`}
                variant="outlined"
                size="small"
                disabled={isConnecting}
                sx={{
                  '& .MuiOutlinedInput-root': {
                    bgcolor: 'rgba(255,255,255,0.05)',
                    '&:hover': {
                      bgcolor: 'rgba(255,255,255,0.1)',
                    },
                    '&.Mui-focused': {
                      bgcolor: 'rgba(255,255,255,0.1)',
                    }
                  }
                }}
              />
              <IconButton 
                type="submit" 
                disabled={!content.trim() || isConnecting}
                color="primary"
                sx={{ 
                  bgcolor: 'primary.main',
                  color: 'white',
                  '&:hover': {
                    bgcolor: 'primary.dark',
                    transform: 'scale(1.05)',
                    boxShadow: '0 4px 12px rgba(88, 101, 242, 0.4)',
                  },
                  '&:disabled': {
                    bgcolor: 'rgba(255,255,255,0.1)',
                    color: 'text.secondary',
                    transform: 'none',
                    boxShadow: 'none'
                  },
                  transition: 'all 0.2s ease-in-out',
                  boxShadow: '0 2px 8px rgba(88, 101, 242, 0.2)'
                }}
                title="メッセージを送信"
              >
                <SendIcon />
              </IconButton>
            </Box>
          </Box>
        </Box>

        {/* 右サイドバー - 参加者一覧 */}
        <Paper 
          elevation={0} 
          sx={{ 
            width: 200, 
            bgcolor: 'background.paper',
            borderRadius: 0,
            borderLeft: '1px solid',
            borderColor: 'divider',
            display: 'flex',
            flexDirection: 'column'
          }}
        >
          {/* 参加者一覧ヘッダー - チャンネルヘッダーと同じ高さに配置 */}
          <Box sx={{ 
            p: 2, 
            borderBottom: '1px solid', 
            borderColor: 'divider',
            bgcolor: 'background.paper',
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            minHeight: 64
          }}>
            <Typography variant="h6" color="text.primary" fontWeight="bold">
              参加者 — {onlineUsers.length}
            </Typography>
          </Box>
          
          {/* 参加者リスト - メッセージエリアと同じ高さに配置 */}
          <Box sx={{ 
            flex: 1, 
            p: 1, 
            overflow: 'auto',
            display: 'flex',
            flexDirection: 'column'
          }}>
            <List dense>
              {onlineUsers.map((user, index) => (
                <ListItem key={index} disablePadding>
                  <Box sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    gap: 1, 
                    p: 1, 
                    width: '100%',
                    borderRadius: 1,
                    '&:hover': {
                      bgcolor: 'rgba(255, 255, 255, 0.05)'
                    }
                  }}>
                    <Avatar 
                      src={user.picture} 
                      sx={{ width: 24, height: 24, bgcolor: 'primary.main' }}
                    >
                      {getInitials(user.username)}
                    </Avatar>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography 
                        variant="body2" 
                        color="text.primary" 
                        noWrap
                        sx={{ fontSize: '0.8rem' }}
                      >
                        {user.username}
                      </Typography>
                    </Box>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                      <OnlineIcon sx={{ fontSize: 8, color: 'success.main' }} />
                      <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.7rem' }}>
                        オンライン
                      </Typography>
                    </Box>
                  </Box>
                </ListItem>
              ))}
            </List>
          </Box>
        </Paper>
      </Box>

      {/* コンテキストメニュー */}
      {contextMenu && (
        <Box
          ref={contextMenuRef}
          sx={{
            position: 'fixed',
            top: contextMenu.mouseY,
            left: contextMenu.mouseX,
            zIndex: 1300,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            minWidth: 200,
            maxWidth: 250,
            py: 0.5
          }}
          onClick={closeContextMenu}
        >
          {/* リアクションセクション */}
          <Box sx={{ display: 'flex', gap: 0.5, p: 1, borderBottom: '1px solid', borderColor: 'divider' }}>
            <IconButton size="small" sx={{ bgcolor: 'rgba(255, 255, 255, 0.1)' }}>
              👍
            </IconButton>
            <IconButton size="small" sx={{ bgcolor: 'rgba(255, 255, 255, 0.1)' }}>
              😢
            </IconButton>
            <IconButton size="small" sx={{ bgcolor: 'rgba(255, 255, 255, 0.1)' }}>
              👏
            </IconButton>
            <IconButton size="small" sx={{ bgcolor: 'rgba(255, 255, 255, 0.1)' }}>
              ❤️
            </IconButton>
          </Box>

          {/* メインアクション */}
          <Box sx={{ py: 0.5 }}>
            <Box 
              sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                px: 2, 
                py: 1, 
                cursor: 'pointer',
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.05)' }
              }}
              onClick={() => replyToMessage(contextMenu.message)}
            >
              <ReplyIcon sx={{ fontSize: 16, mr: 2, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.primary">返信</Typography>
            </Box>
            
            {contextMenu.message.username === username && contextMenu.message.id && (
              <>
                <Box 
                  sx={{ 
                    display: 'flex', 
                    alignItems: 'center', 
                    px: 2, 
                    py: 1, 
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.05)' }
                  }}
                  onClick={() => {
                    startEdit(contextMenu.message)
                    closeContextMenu()
                  }}
                >
                  <EditIcon sx={{ fontSize: 16, mr: 2, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.primary">メッセージを編集</Typography>
                </Box>
              </>
            )}
            
            <Box 
              sx={{ 
                display: 'flex', 
                alignItems: 'center', 
                px: 2, 
                py: 1, 
                cursor: 'pointer',
                '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.05)' }
              }}
              onClick={() => copyMessage(contextMenu.message.content)}
            >
              <CopyIcon sx={{ fontSize: 16, mr: 2, color: 'text.secondary' }} />
              <Typography variant="body2" color="text.primary">テキストをコピー</Typography>
            </Box>
          </Box>

          {/* 削除アクション（自分のメッセージのみ） */}
          {contextMenu.message.username === username && contextMenu.message.id && (
            <>
              <Divider />
              <Box 
                sx={{ 
                  display: 'flex', 
                  alignItems: 'center', 
                  px: 2, 
                  py: 1, 
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(244, 67, 54, 0.1)' }
                }}
                onClick={() => {
                  deleteMessage(contextMenu.message.id)
                  closeContextMenu()
                }}
              >
                <DeleteIcon sx={{ fontSize: 16, mr: 2, color: 'error.main' }} />
                <Typography variant="body2" color="error.main">メッセージを削除</Typography>
              </Box>
            </>
          )}
        </Box>
      )}
    </ThemeProvider>
  )
}

