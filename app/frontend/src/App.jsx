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
  PushPin as PinIcon,
  Warning as WarningIcon,
  Add as AddIcon
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
  const [deleteModal, setDeleteModal] = React.useState(null)
  const [channelContextMenu, setChannelContextMenu] = React.useState(null)
  const [channelCreateModal, setChannelCreateModal] = React.useState(false)
  const [channelEditModal, setChannelEditModal] = React.useState(null)
  const [newChannelName, setNewChannelName] = React.useState('')
  // 未読メッセージとメンションを追跡: { channelName: { unread: number, mentions: number } }
  const [unreadChannels, setUnreadChannels] = React.useState({})
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
          
          // 認証成功後、チャンネルに接続（正しいユーザー名を渡す）
          await connectToChannel(currentChannel, userData.name, userData.picture)
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
    
    // 切り替えたチャンネルの未読をクリア
    setUnreadChannels(prev => {
      const next = { ...prev }
      delete next[channelName]
      return next
    })
    
    // 新しいチャンネルに接続
    console.log(`Connecting to channel: ${channelName}`)
    await connectToChannel(channelName, username, userPicture)
    setIsConnecting(false)
    console.log(`Successfully switched to channel: ${channelName}`)
  }

  const connectToChannel = async (channelName, userName = username, userPic = userPicture) => {
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

    const socket = io({ path: '/socket.io', query: { username: userName } })
    console.log('Socket.IO client connecting with username:', userName)
    
    socket.on('connect', () => {
      console.log('Socket.IO client connected successfully, joining room:', channelName)
      const joinData = { room: channelName, username: userName, picture: userPic }
      console.log('Emitting join event with data:', joinData)
      socket.emit('join', joinData)
      console.log('Join event emitted')
    })
    
    socket.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error)
    })
    socket.on('system', msg => {
      setMessages(m => [...m, { system: true, content: msg }])
    })
    socket.on('message', msg => {
      // messageイベントはio.to(room).emitで送信されるので、このsocketが参加しているroomのメッセージ
      // つまり現在のチャンネルのメッセージとして表示に追加
      console.log('Received message event:', msg)
      setMessages(m => {
        // 重複チェック: 既に同じIDのメッセージがある場合は追加しない
        const exists = m.find(existing => existing.id === msg.id)
        if (exists) {
          console.log('Message already exists, skipping:', msg.id)
          return m
        }
        console.log('Adding new message to list. Current count:', m.length)
        return [...m, { 
          ...msg, 
          createdAt: new Date(msg.ts),
          editedAt: msg.editedAt ? new Date(msg.editedAt) : null
        }]
      })
    })
    
    // 全チャンネルの新規メッセージ通知（未読マーク用 + 現在のチャンネルのメッセージ表示）
    socket.on('new_message', msg => {
      console.log('Received new_message event:', msg)
      const messageRoom = msg.room
      if (!messageRoom) {
        console.log('new_message has no room, ignoring')
        return // roomがない場合は無視
      }
      
      const isMention = msg.mentions?.includes?.(username) || false // 将来的なメンション機能に対応
      
      // 現在のチャンネルと比較
      setCurrentChannel(current => {
        console.log('Processing new_message:', { messageRoom, currentChannel: current, isCurrent: messageRoom === current })
        
        if (messageRoom === current) {
          // 現在のチャンネルのメッセージなので表示に追加（messageイベントが届かない場合のフォールバック）
          console.log('new_message is for current channel, adding to messages')
          setMessages(m => {
            // 重複チェック: 既に同じIDのメッセージがある場合は追加しない
            const exists = m.find(existing => existing.id === msg.id)
            if (exists) {
              console.log('Message already exists in new_message handler, skipping:', msg.id)
              return m
            }
            console.log('Adding new message from new_message event. Current count:', m.length)
            return [...m, { 
              ...msg, 
              createdAt: new Date(msg.ts),
              editedAt: msg.editedAt ? new Date(msg.editedAt) : null
            }]
          })
        } else {
          // 別チャンネルのメッセージなので未読としてマーク
          console.log('Marking as unread for channel:', messageRoom)
          setUnreadChannels(prev => ({
            ...prev,
            [messageRoom]: {
              unread: (prev[messageRoom]?.unread || 0) + 1,
              mentions: (prev[messageRoom]?.mentions || 0) + (isMention ? 1 : 0)
            }
          }))
        }
        return current // currentChannelは変更しない
      })
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
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [])


  const send = (e) => {
    e?.preventDefault()
    if (!socketRef.current || !content.trim()) {
      console.log('Cannot send message:', { socketExists: !!socketRef.current, hasContent: !!content.trim() })
      return
    }
    console.log('Sending message:', { room: currentChannel, content: content.trim(), socketConnected: socketRef.current?.connected, socketId: socketRef.current?.id })
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
    const message = messages.find(m => m.id === messageId)
    if (message) {
      setDeleteModal(message)
    }
  }

  const confirmDelete = () => {
    if (!socketRef.current || !deleteModal) return
    socketRef.current.emit('delete_message', { 
      room: currentChannel, 
      messageId: deleteModal.id 
    })
    setDeleteModal(null)
  }

  const cancelDelete = () => {
    setDeleteModal(null)
  }

  // チャンネル管理関数
  const handleChannelContextMenu = (event, channel) => {
    event.preventDefault()
    event.stopPropagation()
    setChannelContextMenu({
      mouseX: event.clientX - 20,
      mouseY: event.clientY - 6,
      channel: channel
    })
  }

  const closeChannelContextMenu = () => {
    setChannelContextMenu(null)
  }

  const createChannel = () => {
    setChannelCreateModal(true)
    closeChannelContextMenu()
  }

  const editChannel = (channel) => {
    setChannelEditModal(channel)
    closeChannelContextMenu()
  }

  const deleteChannel = (channel) => {
    // チャンネル削除の実装
    console.log('Delete channel:', channel)
    closeChannelContextMenu()
  }

  const handleCreateChannel = () => {
    if (newChannelName.trim()) {
      // チャンネル作成の実装
      console.log('Create channel:', newChannelName)
      setNewChannelName('')
      setChannelCreateModal(false)
    }
  }

  const handleEditChannel = () => {
    if (newChannelName.trim()) {
      // チャンネル編集の実装
      console.log('Edit channel:', channelEditModal, 'to', newChannelName)
      setNewChannelName('')
      setChannelEditModal(null)
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
    
    const viewportHeight = window.innerHeight
    const menuHeight = 200 // メニューの推定高さ
    
    // 右クリック時はマウス位置に表示（どこでもいい位置）
    let mouseX = event.clientX - 20 // マウス位置から少し左に
    let mouseY = event.clientY - 6 // マウス位置から少し上に
    
    // 画面の下に近い場合は上に表示
    if (event.clientY + menuHeight > viewportHeight) {
      mouseY = event.clientY - menuHeight - 6
    }
    
    setContextMenu({
      mouseX: mouseX,
      mouseY: mouseY,
      message: message
    })
  }

  const handleMenuButtonClick = (event, message) => {
    event.preventDefault()
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const menuHeight = 200 // メニューの推定高さ
    
    // 本家Discordと同じ位置：メッセージの右端に密着、上端と同じ高さ
    let mouseX = rect.right + 5 // メッセージの右端から5px離れた位置（密着）
    let mouseY = rect.top // メッセージの上端と同じ高さ
    
    // 画面の右端にはみ出る場合は左側に表示
    if (mouseX + 200 > window.innerWidth) {
      mouseX = rect.left - 200 - 5 // メッセージの左側に配置
    }
    
    // 画面の下にはみ出る場合は上に表示
    if (mouseY + menuHeight > viewportHeight) {
      mouseY = rect.bottom - menuHeight
    }
    
    setContextMenu({
      mouseX: mouseX,
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

  // メニューの位置を動的に調整（簡素化）
  React.useEffect(() => {
    if (contextMenu && contextMenuRef.current) {
      const menu = contextMenuRef.current
      const rect = menu.getBoundingClientRect()
      const viewportWidth = window.innerWidth
      const viewportHeight = window.innerHeight
      
      let newX = contextMenu.mouseX
      let newY = contextMenu.mouseY
      
      // 右端にはみ出る場合
      if (rect.right > viewportWidth) {
        newX = viewportWidth - rect.width - 10
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
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', px: 2, py: 1 }}>
              <Typography 
                variant="caption" 
                color="text.secondary"
                sx={{ 
                  textTransform: 'uppercase',
                  fontWeight: 'bold',
                  letterSpacing: 0.5
                }}
              >
                TEXT CHANNELS
              </Typography>
              <IconButton
                size="small"
                onClick={createChannel}
                sx={{
                  color: 'text.secondary',
                  '&:hover': {
                    color: 'text.primary',
                    bgcolor: 'rgba(255, 255, 255, 0.1)'
                  }
                }}
                title="チャンネルを作成"
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Box>
            <List dense>
              {channels.map(channel => (
                <ListItem key={channel} disablePadding>
                  <ListItemButton
                    selected={currentChannel === channel}
                    onClick={() => switchChannel(channel)}
                    onContextMenu={(e) => handleChannelContextMenu(e, channel)}
                    disabled={isConnecting}
                    sx={{
                      borderRadius: 1,
                      mx: 1,
                      '&.Mui-selected': {
                        bgcolor: 'rgba(114, 137, 218, 0.1)',
                        '&:hover': {
                          bgcolor: 'rgba(114, 137, 218, 0.2)',
                        }
                      },
                      // 未読メッセージがあるチャンネルのハイライト
                      ...(unreadChannels[channel] && currentChannel !== channel && {
                        bgcolor: unreadChannels[channel].mentions > 0 
                          ? 'rgba(237, 66, 69, 0.15)' // メンションがある場合は赤っぽく
                          : 'rgba(255, 255, 255, 0.08)',
                        animation: 'pulse 2s ease-in-out infinite',
                        '@keyframes pulse': {
                          '0%, 100%': {
                            bgcolor: unreadChannels[channel].mentions > 0 
                              ? 'rgba(237, 66, 69, 0.15)'
                              : 'rgba(255, 255, 255, 0.08)',
                          },
                          '50%': {
                            bgcolor: unreadChannels[channel].mentions > 0 
                              ? 'rgba(237, 66, 69, 0.25)'
                              : 'rgba(255, 255, 255, 0.15)',
                          },
                        },
                        '&:hover': {
                          bgcolor: unreadChannels[channel].mentions > 0 
                            ? 'rgba(237, 66, 69, 0.20)'
                            : 'rgba(255, 255, 255, 0.12)',
                        }
                      })
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
                    {/* 未読数とメンション数の表示 */}
                    {unreadChannels[channel] && currentChannel !== channel && (
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mr: 1 }}>
                        {unreadChannels[channel].mentions > 0 ? (
                          <Chip
                            label={unreadChannels[channel].mentions}
                            size="small"
                            sx={{
                              bgcolor: 'error.main',
                              color: 'white',
                              height: 18,
                              minWidth: 18,
                              fontSize: '0.7rem',
                              fontWeight: 'bold',
                              '& .MuiChip-label': {
                                px: 0.5
                              }
                            }}
                          />
                        ) : unreadChannels[channel].unread > 0 ? (
                          <Box
                            sx={{
                              bgcolor: 'rgba(255, 255, 255, 0.2)',
                              color: 'text.primary',
                              borderRadius: '50%',
                              width: 18,
                              height: 18,
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '0.7rem',
                              fontWeight: 'bold'
                            }}
                          >
                            {unreadChannels[channel].unread > 99 ? '99+' : unreadChannels[channel].unread}
                          </Box>
                        ) : null}
                      </Box>
                    )}
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
                {messages.map((m) => (
                  <Box 
                    key={m.id || `msg-${m.createdAt?.getTime() || Date.now()}`} 
                    sx={{ 
                      mb: 2, 
                      display: 'flex', 
                      gap: 2,
                      p: 1,
                      borderRadius: 1,
                      '&:hover': {
                        bgcolor: 'rgba(255, 255, 255, 0.02)',
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
                            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
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
                              
                              {/* メニューボタン（ホバー時に表示、右端に固定） */}
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
            minWidth: 140,
            maxWidth: 160,
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

      {/* Discord風削除確認モーダル */}
      {deleteModal && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={cancelDelete}
        >
          <Box
            sx={{
              bgcolor: 'background.paper',
              borderRadius: 2,
              p: 3,
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* ヘッダー */}
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
              <WarningIcon sx={{ color: 'error.main', mr: 1 }} />
              <Typography variant="h6" color="text.primary" sx={{ fontWeight: 'bold' }}>
                メッセージを削除
              </Typography>
            </Box>

            {/* 確認メッセージ */}
            <Typography variant="body1" color="text.primary" sx={{ mb: 3 }}>
              メッセージを削除します。よろしいですか？
            </Typography>

            {/* 削除対象メッセージのプレビュー */}
            <Box sx={{ 
              bgcolor: 'rgba(255, 255, 255, 0.05)', 
              borderRadius: 1, 
              p: 2, 
              mb: 3,
              border: '1px solid',
              borderColor: 'divider'
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                <Avatar sx={{ width: 24, height: 24, fontSize: '0.75rem' }}>
                  {deleteModal.username?.charAt(0) || '?'}
                </Avatar>
                <Typography variant="body2" color="text.primary" sx={{ fontWeight: 'bold' }}>
                  {deleteModal.username}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {deleteModal.createdAt ? 
                    deleteModal.createdAt.toLocaleTimeString('ja-JP', { 
                      hour: '2-digit', 
                      minute: '2-digit' 
                    }) : 
                    '時刻不明'
                  }
                </Typography>
              </Box>
              <Typography variant="body2" color="text.primary">
                {deleteModal.content}
              </Typography>
            </Box>

            {/* アドバイス */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontWeight: 'bold', mb: 1 }}>
                アドバイス:
              </Typography>
              <Typography variant="caption" color="text.secondary">
                シフトを押しながらメッセージを削除をクリックすることで、確認なしに即メッセージを削除できます。
              </Typography>
            </Box>

            {/* ボタン */}
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <Box
                sx={{
                  px: 3,
                  py: 1,
                  bgcolor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.2)'
                  }
                }}
                onClick={cancelDelete}
              >
                <Typography variant="body2" color="text.primary">
                  キャンセル
                </Typography>
              </Box>
              <Box
                sx={{
                  px: 3,
                  py: 1,
                  bgcolor: 'error.main',
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: 'error.dark'
                  }
                }}
                onClick={confirmDelete}
              >
                <Typography variant="body2" color="white">
                  削除
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* チャンネルコンテキストメニュー */}
      {channelContextMenu && (
        <Box
          sx={{
            position: 'fixed',
            top: channelContextMenu.mouseY,
            left: channelContextMenu.mouseX,
            bgcolor: 'background.paper',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            minWidth: 180,
            maxWidth: 200,
            py: 0.5,
            zIndex: 1000
          }}
          onClick={closeChannelContextMenu}
        >
          <Box 
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              px: 2, 
              py: 1, 
              cursor: 'pointer',
              '&:hover': { bgcolor: 'rgba(255, 255, 255, 0.05)' }
            }}
            onClick={() => editChannel(channelContextMenu.channel)}
          >
            <EditIcon sx={{ fontSize: 16, mr: 2, color: 'text.secondary' }} />
            <Typography variant="body2" color="text.primary">チャンネルを編集</Typography>
          </Box>
          
          <Box 
            sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              px: 2, 
              py: 1, 
              cursor: 'pointer',
              '&:hover': { bgcolor: 'rgba(244, 67, 54, 0.1)' }
            }}
            onClick={() => deleteChannel(channelContextMenu.channel)}
          >
            <DeleteIcon sx={{ fontSize: 16, mr: 2, color: 'error.main' }} />
            <Typography variant="body2" color="error.main">チャンネルを削除</Typography>
          </Box>
        </Box>
      )}

      {/* チャンネル作成モーダル */}
      {channelCreateModal && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={() => setChannelCreateModal(false)}
        >
          <Box
            sx={{
              bgcolor: 'background.paper',
              borderRadius: 2,
              p: 3,
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Typography variant="h6" color="text.primary" sx={{ fontWeight: 'bold', mb: 2 }}>
              チャンネルを作成
            </Typography>
            
            <TextField
              fullWidth
              label="チャンネル名"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder="例: general"
              sx={{ mb: 3 }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleCreateChannel()
                }
              }}
            />
            
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <Box
                sx={{
                  px: 3,
                  py: 1,
                  bgcolor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.2)'
                  }
                }}
                onClick={() => setChannelCreateModal(false)}
              >
                <Typography variant="body2" color="text.primary">
                  キャンセル
                </Typography>
              </Box>
              <Box
                sx={{
                  px: 3,
                  py: 1,
                  bgcolor: 'primary.main',
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: 'primary.dark'
                  }
                }}
                onClick={handleCreateChannel}
              >
                <Typography variant="body2" color="white">
                  作成
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>
      )}

      {/* チャンネル編集モーダル */}
      {channelEditModal && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            bgcolor: 'rgba(0, 0, 0, 0.8)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999
          }}
          onClick={() => setChannelEditModal(null)}
        >
          <Box
            sx={{
              bgcolor: 'background.paper',
              borderRadius: 2,
              p: 3,
              maxWidth: 400,
              width: '90%',
              boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <Typography variant="h6" color="text.primary" sx={{ fontWeight: 'bold', mb: 2 }}>
              チャンネルを編集
            </Typography>
            
            <TextField
              fullWidth
              label="チャンネル名"
              value={newChannelName}
              onChange={(e) => setNewChannelName(e.target.value)}
              placeholder={channelEditModal}
              sx={{ mb: 3 }}
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleEditChannel()
                }
              }}
            />
            
            <Box sx={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
              <Box
                sx={{
                  px: 3,
                  py: 1,
                  bgcolor: 'rgba(255, 255, 255, 0.1)',
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: 'rgba(255, 255, 255, 0.2)'
                  }
                }}
                onClick={() => setChannelEditModal(null)}
              >
                <Typography variant="body2" color="text.primary">
                  キャンセル
                </Typography>
              </Box>
              <Box
                sx={{
                  px: 3,
                  py: 1,
                  bgcolor: 'primary.main',
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': {
                    bgcolor: 'primary.dark'
                  }
                }}
                onClick={handleEditChannel}
              >
                <Typography variant="body2" color="white">
                  保存
                </Typography>
              </Box>
            </Box>
          </Box>
        </Box>
      )}
    </ThemeProvider>
  )
}

