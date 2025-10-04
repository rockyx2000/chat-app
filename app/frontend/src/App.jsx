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
  Circle as OnlineIcon
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
        
        if (userData.name) {
          setUsername(userData.name)
          setUserPicture(userData.picture)
          setUserEmail(userData.email)
          console.log('Logged in as:', userData.email)
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
    
    setIsConnecting(true)
    
    // 既存の接続を切断
    if (socketRef.current) {
      socketRef.current.disconnect()
      socketRef.current = null
    }
    
    setCurrentChannel(channelName)
    setMessages([])
    
    // 新しいチャンネルに接続
    await connectToChannel(channelName)
    setIsConnecting(false)
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
        picture: msg.picture,
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

  return (
    <ThemeProvider theme={discordTheme}>
      <CssBaseline />
      <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
        {/* サイドバー */}
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
            gap: 1
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
                        boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)'
                      }
                    }}
                  >
                    {m.system ? (
                      <Box sx={{ 
                        textAlign: 'center', 
                        width: '100%',
                        py: 1
                      }}>
                        <Typography 
                          variant="caption" 
                          color="text.secondary"
                          sx={{ 
                            bgcolor: 'rgba(79, 84, 92, 0.16)',
                            px: 2,
                            py: 0.5,
                            borderRadius: 1,
                            fontStyle: 'italic'
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
                              {m.createdAt.toLocaleTimeString('ja-JP', { 
                                hour: '2-digit', 
                                minute: '2-digit' 
                              })}
                            </Typography>
                          </Box>
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
      </Box>
    </ThemeProvider>
  )
}

