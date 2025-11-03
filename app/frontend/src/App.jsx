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
  const [isLoadingMessages, setIsLoadingMessages] = React.useState(false)
  const messagesContainerRef = React.useRef(null)
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
  
  // メンションサジェスト関連のstate
  const [mentionSuggestions, setMentionSuggestions] = React.useState({
    show: false,
    query: '',
    startIndex: 0,
    endIndex: 0
  })
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = React.useState(0)
  const inputRef = React.useRef(null)

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
    if (isConnecting || currentChannel === channelName) return
    
    console.log(`Switching to channel: ${channelName}`)
    setIsConnecting(true)
    
    // 切り替えたチャンネルの未読をクリア
    setUnreadChannels(prev => {
      const next = { ...prev }
      delete next[channelName]
      return next
    })
    
    // メッセージを先にクリア（これによりリアルタイムイベントの重複を防ぐ）
    setMessages([])
    setIsLoadingMessages(true)
    
    // チャンネルを先に更新（イベントハンドラが正しいチャンネルを参照するため）
    setCurrentChannel(channelName)
    
    // Socket.IO接続を確立または更新
    if (!socketRef.current || !socketRef.current.connected) {
      console.log(`Connecting to channel before loading messages: ${channelName}`)
      await connectToChannel(channelName, username, userPicture)
    } else {
      console.log('Switching room without disconnecting socket')
      // 既存の接続がある場合は、roomを切り替えるだけ（切断しない）
      // チャンネルは既に更新済みなので、イベントハンドラは正しいチャンネルを参照する
      const joinData = { room: channelName, username: username, picture: userPicture }
      socketRef.current.emit('join', joinData)
      console.log('Emitted join event for new room:', channelName)
      
      // joinイベントが処理されるのを少し待つ（サーバー側でroomに参加するまで）
      await new Promise(resolve => setTimeout(resolve, 100))
    }
    
    // メッセージ履歴を読み込む
    try {
      const historyRes = await fetch(`/api/channels/${channelName}/messages`)
      const history = await historyRes.json()
      const mappedHistory = history.map(msg => ({
        id: msg.id,
        username: msg.username,
        content: msg.content,
        picture: msg.picture,
        createdAt: new Date(msg.ts),
        editedAt: msg.editedAt ? new Date(msg.editedAt) : null,
        mentions: msg.mentions || []
      }))
      // メッセージは読み込むが、スケルトンは表示し続ける
      setMessages(mappedHistory)
      console.log(`Loaded ${history.length} messages for channel: ${channelName}`)
      
      // DOMに反映され、レイアウトが完了するまで待つ
      // メッセージ要素が実際にDOMに存在することを確認
      let frameCount = 0
      let lastScrollHeight = 0
      let stableCount = 0
      
      const waitForRender = () => {
        requestAnimationFrame(() => {
          const container = messagesContainerRef.current
          if (container) {
            // メッセージ要素が存在するか確認（messagesEndRefがあることを確認）
            const messagesExist = mappedHistory.length === 0 || container.querySelector('[data-message-container]') || container.scrollHeight > container.clientHeight
            
            const currentScrollHeight = container.scrollHeight
            
            // スクロール高さが安定し、メッセージが存在することを確認
            if (currentScrollHeight === lastScrollHeight && messagesExist) {
              stableCount++
              if (stableCount >= 3) {
                // レイアウトが安定し、メッセージが存在することを確認したら、最下部にスクロール
                const targetScrollTop = container.scrollHeight - container.clientHeight
                container.scrollTop = targetScrollTop
                
                // スクロールが完了したことを確認
                const checkScrollComplete = () => {
                  const checkContainer = messagesContainerRef.current
                  if (checkContainer) {
                    const distanceToBottom = checkContainer.scrollHeight - checkContainer.scrollTop - checkContainer.clientHeight
                    const isAtBottom = distanceToBottom < 5
                    if (isAtBottom) {
                      // 最下部に到達したことを確認したら、少し待ってからスケルトンを非表示
                      setTimeout(() => {
                        setIsLoadingMessages(false)
                      }, 150)
                    } else {
                      // まだ最下部に到達していない場合は再スクロールとチェック
                      checkContainer.scrollTop = checkContainer.scrollHeight - checkContainer.clientHeight
                      requestAnimationFrame(checkScrollComplete)
                    }
                  } else {
                    setIsLoadingMessages(false)
                  }
                }
                
                // スクロール完了チェックを開始（少し待ってから）
                setTimeout(() => {
                  checkScrollComplete()
                }, 50)
                return
              }
            } else {
              lastScrollHeight = currentScrollHeight
              stableCount = 0
            }
            
            frameCount++
            // 最大100フレーム（約1.6秒）まで待つ
            if (frameCount < 100) {
              waitForRender()
            } else {
              // タイムアウトした場合は強制的に最下部にスクロールしてスケルトンを解除
              container.scrollTop = container.scrollHeight - container.clientHeight
              setTimeout(() => {
                setIsLoadingMessages(false)
              }, 150)
            }
          } else {
            setIsLoadingMessages(false)
          }
        })
      }
      
      // 最初のフレーム待機を開始（少し長めに待つ）
      setTimeout(() => {
        waitForRender()
      }, 50)
    } catch (error) {
      console.error('Error loading message history:', error)
      setIsLoadingMessages(false)
    }
    
    setIsConnecting(false)
    console.log(`Successfully switched to channel: ${channelName}`)
  }

  const connectToChannel = async (channelName, userName = username, userPic = userPicture) => {
    // 既存のSocket.IO接続がある場合は、イベントハンドラを再登録しない
    if (socketRef.current && socketRef.current.connected) {
      console.log('Socket already connected, just joining new room')
      const joinData = { room: channelName, username: userName, picture: userPic }
      socketRef.current.emit('join', joinData)
      // 履歴は既にswitchChannelでロード済みのため、ここではロードしない
      // 注意: この場合、currentChannelはswitchChannelで更新される
      return
    }

    // 初回接続時: Socket.IO接続を先に確立してからメッセージ履歴を読み込む
    setIsLoadingMessages(true)
    
    // Socket.IO接続を確立（Promiseで接続完了を待つ）
    const socket = io({ path: '/socket.io', query: { username: userName } })
    console.log('Socket.IO client connecting with username:', userName)
    
    // 接続時にチャンネルを設定（クロージャーでchannelNameを保持）
    const targetChannel = channelName
    
    // イベントハンドラを接続確立前に登録（接続直後に発生するイベントをキャッチするため）
    socket.on('system', msg => {
      setMessages(m => [...m, { system: true, content: msg }])
    })
    socket.on('message', msg => {
      // messageイベントはio.to(room).emitで送信されるので、このsocketが参加しているroomのメッセージ
      // 現在のチャンネルと一致することを確認してから追加
      console.log('[message event] Received message event:', { id: msg.id, room: msg.room, username: msg.username, content: msg.content?.substring(0, 20) })
      
      // 現在のチャンネルを確認（状態更新関数内で最新値を取得）
      setCurrentChannel(current => {
        // メッセージのroomが現在のチャンネルと一致する場合のみ追加
        if (msg.room === current) {
          setMessages(m => {
            // 重複チェック: 既に同じIDのメッセージがある場合は追加しない
            const exists = m.find(existing => existing.id === msg.id)
            if (exists) {
              console.log('[message event] Message already exists, skipping:', msg.id)
              return m
            }
            console.log('[message event] Adding new message to list. Current count:', m.length)
            return [...m, { 
              ...msg, 
              createdAt: new Date(msg.ts),
              editedAt: msg.editedAt ? new Date(msg.editedAt) : null,
              mentions: msg.mentions || [] // メンション情報を含める
            }]
          })
        } else {
          console.log('[message event] Message room does not match current channel, ignoring:', { messageRoom: msg.room, currentChannel: current })
        }
        return current // currentChannelは変更しない
      })
    })
    
    // 全チャンネルの新規メッセージ通知（未読マーク用 + 現在のチャンネルのメッセージ表示）
    socket.on('new_message', msg => {
      console.log('[new_message event] Received new_message event:', { id: msg.id, room: msg.room, username: msg.username, content: msg.content?.substring(0, 20) })
      const messageRoom = msg.room
      if (!messageRoom) {
        console.log('[new_message event] new_message has no room, ignoring')
        return // roomがない場合は無視
      }
      
      // メンション判定: mentions配列に現在のユーザー名が含まれているか確認
      const isMention = Array.isArray(msg.mentions) && msg.mentions.includes(username)
      
      // 現在のチャンネルと比較
      setCurrentChannel(current => {
        console.log('[new_message event] Processing new_message:', { messageRoom, currentChannel: current, isCurrent: messageRoom === current })
        
        if (messageRoom === current) {
          // 現在のチャンネルのメッセージなので表示に追加（messageイベントが届かない場合のフォールバック）
          console.log('[new_message event] new_message is for current channel, adding to messages as fallback')
          setMessages(m => {
            // 重複チェック: 既に同じIDのメッセージがある場合は追加しない
            const exists = m.find(existing => existing.id === msg.id)
            if (exists) {
              console.log('[new_message event] Message already exists in new_message handler, skipping:', msg.id)
              return m
            }
            console.log('[new_message event] Adding new message from new_message event (fallback). Current count:', m.length)
            return [...m, { 
              ...msg, 
              createdAt: new Date(msg.ts),
              editedAt: msg.editedAt ? new Date(msg.editedAt) : null,
              mentions: msg.mentions || [] // メンション情報を含める
            }]
          })
        } else {
          // 別チャンネルのメッセージなので未読としてマーク
          console.log('[new_message event] Marking as unread for channel:', messageRoom)
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
      console.log('[online_users event] Received online users:', users)
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
    
    const connectPromise = new Promise((resolve) => {
      socket.on('connect', () => {
        console.log('Socket.IO client connected successfully, joining room:', targetChannel)
        // 接続時にcurrentChannelを更新
        setCurrentChannel(targetChannel)
        const joinData = { room: targetChannel, username: userName, picture: userPic }
        console.log('Emitting join event with data:', joinData)
        socket.emit('join', joinData)
        console.log('Join event emitted')
        
        // joinイベントが処理されるのを少し待つ
        setTimeout(() => {
          resolve()
        }, 200)
      })
      
      socket.on('connect_error', (error) => {
        console.error('Socket.IO connection error:', error)
        resolve() // エラーでも続行
      })
    })
    
    // socketRefを設定（イベントハンドラが正しく動作するため）
    socketRef.current = socket
    
    // メッセージ履歴を読み込む（接続確立後）
    try {
      // Socket.IO接続が確立されるまで待つ
      await connectPromise
      
      const historyRes = await fetch(`/api/channels/${channelName}/messages`)
      const history = await historyRes.json()
      const mappedHistory = history.map(msg => ({
        id: msg.id,
        username: msg.username,
        content: msg.content,
        picture: msg.picture,
        createdAt: new Date(msg.ts),
        editedAt: msg.editedAt ? new Date(msg.editedAt) : null,
        mentions: msg.mentions || []
      }))
      // メッセージは読み込むが、スケルトンは表示し続ける
      setMessages(mappedHistory)
      console.log(`Loaded ${history.length} messages for channel: ${channelName}`)
      
      // DOMに反映され、レイアウトが完了するまで待つ
      // メッセージ要素が実際にDOMに存在することを確認
      let frameCount = 0
      let lastScrollHeight = 0
      let stableCount = 0
      
      const waitForRender = () => {
        requestAnimationFrame(() => {
          const container = messagesContainerRef.current
          if (container) {
            // メッセージ要素が存在するか確認（messagesEndRefがあることを確認）
            const messagesExist = mappedHistory.length === 0 || container.querySelector('[data-message-container]') || container.scrollHeight > container.clientHeight
            
            const currentScrollHeight = container.scrollHeight
            
            // スクロール高さが安定し、メッセージが存在することを確認
            if (currentScrollHeight === lastScrollHeight && messagesExist) {
              stableCount++
              if (stableCount >= 3) {
                // レイアウトが安定し、メッセージが存在することを確認したら、最下部にスクロール
                const targetScrollTop = container.scrollHeight - container.clientHeight
                container.scrollTop = targetScrollTop
                
                // スクロールが完了したことを確認
                const checkScrollComplete = () => {
                  const checkContainer = messagesContainerRef.current
                  if (checkContainer) {
                    const distanceToBottom = checkContainer.scrollHeight - checkContainer.scrollTop - checkContainer.clientHeight
                    const isAtBottom = distanceToBottom < 5
                    if (isAtBottom) {
                      // 最下部に到達したことを確認したら、少し待ってからスケルトンを非表示
                      setTimeout(() => {
                        setIsLoadingMessages(false)
                      }, 150)
                    } else {
                      // まだ最下部に到達していない場合は再スクロールとチェック
                      checkContainer.scrollTop = checkContainer.scrollHeight - checkContainer.clientHeight
                      requestAnimationFrame(checkScrollComplete)
                    }
                  } else {
                    setIsLoadingMessages(false)
                  }
                }
                
                // スクロール完了チェックを開始（少し待ってから）
                setTimeout(() => {
                  checkScrollComplete()
                }, 50)
                return
              }
            } else {
              lastScrollHeight = currentScrollHeight
              stableCount = 0
            }
            
            frameCount++
            // 最大100フレーム（約1.6秒）まで待つ
            if (frameCount < 100) {
              waitForRender()
            } else {
              // タイムアウトした場合は強制的に最下部にスクロールしてスケルトンを解除
              container.scrollTop = container.scrollHeight - container.clientHeight
              setTimeout(() => {
                setIsLoadingMessages(false)
              }, 150)
            }
          } else {
            setIsLoadingMessages(false)
          }
        })
      }
      
      // 最初のフレーム待機を開始（少し長めに待つ）
      setTimeout(() => {
        waitForRender()
      }, 50)
    } catch (error) {
      console.error('Error loading message history:', error)
      setIsLoadingMessages(false)
    }
  }

  React.useEffect(() => {
    return () => {
      if (socketRef.current) {
        socketRef.current.disconnect()
      }
    }
  }, [])


  // メッセージからメンションを抽出する関数
  const extractMentions = (text) => {
    // @username 形式のメンションを検出（日本語ユーザー名にも対応）
    // @の後に続く文字列を取得（空白、改行、句読点まで）
    const mentionRegex = /@([^\s@\.,!?;:]+)/g
    const mentions = []
    let match
    while ((match = mentionRegex.exec(text)) !== null) {
      mentions.push(match[1]) // username部分を取得
    }
    return [...new Set(mentions)] // 重複を除去
  }

  // @入力時のサジェスト処理
  const handleContentChange = (e) => {
    const newContent = e.target.value
    const cursorPosition = e.target.selectionStart
    
    setContent(newContent)
    
    // カーソル位置より前のテキストを取得
    const textBeforeCursor = newContent.substring(0, cursorPosition)
    
    // 最後の@の位置を探す
    const lastAtIndex = textBeforeCursor.lastIndexOf('@')
    
    // @が見つかり、かつ@の後が空白や句読点でない場合
    if (lastAtIndex !== -1) {
      const afterAt = textBeforeCursor.substring(lastAtIndex + 1)
      // @の後に空白や改行、句読点がない場合はサジェストを表示
      if (!afterAt.match(/[\s\n\.,!?;:]/)) {
        const query = afterAt.toLowerCase()
        setMentionSuggestions({
          show: true,
          query: query,
          startIndex: lastAtIndex,
          endIndex: cursorPosition
        })
        setSelectedSuggestionIndex(0)
        return
      }
    }
    
    // サジェストを非表示
    setMentionSuggestions(prev => ({ ...prev, show: false }))
  }

  // サジェストされたユーザーリストを取得
  const getSuggestedUsers = () => {
    if (!mentionSuggestions.show || !mentionSuggestions.query) {
      return onlineUsers.filter(u => u.username !== username) // 自分以外
    }
    
    const query = mentionSuggestions.query.toLowerCase()
    return onlineUsers
      .filter(user => 
        user.username !== username && // 自分以外
        user.username.toLowerCase().includes(query) // クエリに一致
      )
      .sort((a, b) => {
        // 前方一致を優先
        const aStarts = a.username.toLowerCase().startsWith(query)
        const bStarts = b.username.toLowerCase().startsWith(query)
        if (aStarts && !bStarts) return -1
        if (!aStarts && bStarts) return 1
        return a.username.localeCompare(b.username)
      })
  }

  // サジェストからユーザー名を挿入
  const insertMention = (selectedUser) => {
    if (!selectedUser) return
    
    const beforeMention = content.substring(0, mentionSuggestions.startIndex)
    const afterMention = content.substring(mentionSuggestions.endIndex)
    const newContent = `${beforeMention}@${selectedUser.username} ${afterMention}`
    
    setContent(newContent)
    setMentionSuggestions(prev => ({ ...prev, show: false }))
    setSelectedSuggestionIndex(0)
    
    // カーソル位置を@usernameの後に設定
    setTimeout(() => {
      if (inputRef.current) {
        const newCursorPos = beforeMention.length + selectedUser.username.length + 2 // @ + username + スペース
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos)
        inputRef.current.focus()
      }
    }, 0)
  }

  // キーボードナビゲーション
  const handleInputKeyDown = (e) => {
    // Ctrl+Enter（またはCmd+Enter on Mac）でメッセージ送信
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault()
      send(e)
      return
    }

    // メンションサジェストが表示されている場合の処理
    if (mentionSuggestions.show) {
      const suggestedUsers = getSuggestedUsers()
      
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setSelectedSuggestionIndex(prev => 
            prev < suggestedUsers.length - 1 ? prev + 1 : 0
          )
          break
        case 'ArrowUp':
          e.preventDefault()
          setSelectedSuggestionIndex(prev => 
            prev > 0 ? prev - 1 : suggestedUsers.length - 1
          )
          break
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (suggestedUsers.length > 0) {
            insertMention(suggestedUsers[selectedSuggestionIndex])
          }
          break
        case 'Escape':
          e.preventDefault()
          setMentionSuggestions(prev => ({ ...prev, show: false }))
          setSelectedSuggestionIndex(0)
          break
      }
      return
    }

    // 通常のEnterキーは改行として扱う（デフォルト動作を許可）
    // Ctrl+Enterは上で処理済み
  }

  // メッセージ本文をメンション付きでレンダリングする関数（改行も処理）
  const renderMessageWithMentions = (content, mentions = []) => {
    if (!content) return ''
    
    // まず改行で分割し、各行を処理する
    const lines = content.split('\n')
    const result = []
    
    lines.forEach((line, lineIndex) => {
      // 各行内の@username形式を全て検出してハイライト表示
      const parts = []
      let lastIndex = 0
      const mentionRegex = /@([^\s@\.,!?;:]+)/g
      let match
      
      while ((match = mentionRegex.exec(line)) !== null) {
        // メンション前のテキスト
        if (match.index > lastIndex) {
          parts.push(line.substring(lastIndex, match.index))
        }
        
        // メンション部分
        const mentionedUsername = match[1]
        // 自分へのメンションかどうかを判定
        const isSelfMention = mentionedUsername === username
        
        parts.push(
          <Box
            key={`${lineIndex}-${match.index}`}
            component="span"
            sx={{
              bgcolor: isSelfMention 
                ? 'rgba(250, 168, 26, 0.2)' // 自分へのメンションは黄色っぽく
                : 'rgba(88, 101, 242, 0.15)', // それ以外は青色
              color: isSelfMention 
                ? 'rgba(250, 168, 26, 1)' // 自分へのメンションは黄色
                : 'primary.main', // それ以外は青色
              fontWeight: 'medium',
              fontSize: '0.85em', // メンション部分を少し小さく
              px: 0.5,
              borderRadius: 0.5,
              mx: 0.25,
              display: 'inline-block',
              verticalAlign: 'baseline' // テキストのベースラインに合わせる
            }}
          >
            @{mentionedUsername}
          </Box>
        )
        lastIndex = match.index + match[0].length
      }
      
      // 残りのテキスト
      if (lastIndex < line.length) {
        parts.push(line.substring(lastIndex))
      }
      
      // 行を追加（最後の行以外は改行を追加）
      if (parts.length > 0 || line === '') {
        result.push(
          <React.Fragment key={lineIndex}>
            {parts.length > 0 ? parts : (line === '' ? '\u00A0' : line)}
          </React.Fragment>
        )
      }
      
      // 最後の行以外は改行を追加
      if (lineIndex < lines.length - 1) {
        result.push(<br key={`br-${lineIndex}`} />)
      }
    })
    
    return result.length > 0 ? result : content
  }

  const send = (e) => {
    e?.preventDefault()
    if (!socketRef.current || !content.trim()) {
      console.log('[send] Cannot send message:', { socketExists: !!socketRef.current, hasContent: !!content.trim() })
      return
    }
    const trimmedContent = content.trim()
    const mentions = extractMentions(trimmedContent)
    console.log('[send] Sending message:', { room: currentChannel, content: trimmedContent, mentions, socketConnected: socketRef.current?.connected, socketId: socketRef.current?.id })
    socketRef.current.emit('message', { room: currentChannel, content: trimmedContent, mentions })
    setContent('')
    // サジェストも閉じる
    setMentionSuggestions(prev => ({ ...prev, show: false }))
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
    // メッセージ読み込み中はスクロール処理をスキップ（スケルトン表示中は別途処理）
    if (isLoadingMessages) {
      return
    }
    
    // メッセージ読み込み完了後、または新規メッセージ受信時にスクロール
    if (messagesEndRef.current && messages.length > 0) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isLoadingMessages])

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

  // ローディング画面（スケルトン表示）
  if (isLoading) {
    return (
      <ThemeProvider theme={discordTheme}>
        <CssBaseline />
        <Box sx={{ 
          display: 'flex', 
          height: '100vh', 
          bgcolor: 'background.default',
          overflow: 'hidden'
        }}>
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
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton variant="text" width={120} height={24} />
            </Box>
            <Box sx={{ p: 1 }}>
              <Skeleton variant="text" width={100} height={16} sx={{ mb: 1 }} />
              <Skeleton variant="rectangular" width="100%" height={40} sx={{ mb: 0.5, borderRadius: 1 }} />
              <Skeleton variant="rectangular" width="100%" height={40} sx={{ mb: 0.5, borderRadius: 1 }} />
              <Skeleton variant="rectangular" width="100%" height={40} sx={{ borderRadius: 1 }} />
            </Box>
            <Box sx={{ mt: 'auto', p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Skeleton variant="circular" width={32} height={32} />
                <Box sx={{ flex: 1 }}>
                  <Skeleton variant="text" width={80} height={16} />
                  <Skeleton variant="text" width={60} height={12} />
                </Box>
              </Box>
            </Box>
          </Paper>

          {/* メインエリア */}
          <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            {/* チャンネルヘッダー */}
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider', minHeight: 64 }}>
              <Skeleton variant="text" width={120} height={24} />
            </Box>

            {/* メッセージエリア */}
            <Box sx={{ flex: 1, overflow: 'auto', p: 2 }}>
              {[...Array(8)].map((_, index) => (
                <Box key={index} sx={{ mb: 2, display: 'flex', gap: 2 }}>
                  <Skeleton variant="circular" width={40} height={40} />
                  <Box sx={{ flex: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                      <Skeleton variant="text" width={120} height={20} />
                      <Skeleton variant="text" width={60} height={16} />
                    </Box>
                    <Skeleton variant="text" width="80%" height={20} />
                    <Skeleton variant="text" width="60%" height={20} />
                  </Box>
                </Box>
              ))}
            </Box>

            {/* 入力エリア */}
            <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
              <Skeleton variant="rectangular" width="100%" height={40} sx={{ borderRadius: 1 }} />
            </Box>
          </Box>

          {/* 右サイドバー */}
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
            <Box sx={{ p: 2, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Skeleton variant="text" width={80} height={20} />
            </Box>
            <Box sx={{ p: 1 }}>
              {[...Array(3)].map((_, index) => (
                <Box key={index} sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Skeleton variant="circular" width={32} height={32} />
                  <Box sx={{ flex: 1 }}>
                    <Skeleton variant="text" width={100} height={16} />
                    <Skeleton variant="text" width={60} height={12} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Paper>
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
                      // 未読メッセージがあるチャンネルのハイライト（メンションがある場合のみ）
                      ...(unreadChannels[channel] && currentChannel !== channel && unreadChannels[channel].mentions > 0 && {
                        bgcolor: 'rgba(237, 66, 69, 0.15)', // メンションがある場合のみ赤っぽく
                        animation: 'pulse 2s ease-in-out infinite',
                        '@keyframes pulse': {
                          '0%, 100%': {
                            bgcolor: 'rgba(237, 66, 69, 0.15)',
                          },
                          '50%': {
                            bgcolor: 'rgba(237, 66, 69, 0.25)',
                          },
                        },
                        '&:hover': {
                          bgcolor: 'rgba(237, 66, 69, 0.20)',
                        }
                      }),
                      // メンションがない未読チャンネルは控えめに（Discord風）
                      ...(unreadChannels[channel] && currentChannel !== channel && unreadChannels[channel].mentions === 0 && {
                        bgcolor: 'rgba(255, 255, 255, 0.03)', // 非常に控えめなハイライト
                        '&:hover': {
                          bgcolor: 'rgba(255, 255, 255, 0.06)',
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
                    {/* メンション数の表示（メンションがある時だけ赤丸に数字） */}
                    {unreadChannels[channel] && currentChannel !== channel && unreadChannels[channel].mentions > 0 && (
                      <Box sx={{ display: 'flex', alignItems: 'center', mr: 1 }}>
                        <Box
                          sx={{
                            bgcolor: 'error.main',
                            color: 'white',
                            borderRadius: '50%',
                            minWidth: 20,
                            height: 20,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.7rem',
                            fontWeight: 'bold',
                            px: unreadChannels[channel].mentions > 9 ? 0.5 : 0, // 2桁の場合は左右にパディング
                          }}
                        >
                          {unreadChannels[channel].mentions > 99 ? '99+' : unreadChannels[channel].mentions}
                        </Box>
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
          <Box 
            ref={messagesContainerRef}
            sx={{ 
              flex: 1, 
              overflow: isLoadingMessages ? 'hidden' : 'auto', // 読み込み中はスクロールを隠す
              p: 2,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative'
            }}
          >
            {/* スケルトンローディング（メッセージ読み込み中は常に表示、画面いっぱいに表示） */}
            {isLoadingMessages && (
              <Box sx={{ 
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                p: 2,
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-end',
                minHeight: '100%',
                bgcolor: 'background.default',
                zIndex: 1
              }}>
                {[...Array(50)].map((_, index) => (
                  <Box key={index} sx={{ mb: 2, display: 'flex', gap: 2 }}>
                    <Skeleton variant="circular" width={40} height={40} />
                    <Box sx={{ flex: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
                        <Skeleton variant="text" width={120} height={20} />
                        <Skeleton variant="text" width={60} height={16} />
                      </Box>
                      <Skeleton variant="text" width="80%" height={20} />
                      <Skeleton variant="text" width="60%" height={20} />
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
            
            {/* メッセージは常にDOMに存在させるが、ローディング中は透明にする */}
            <Box 
              data-message-container
              sx={{ 
                opacity: isLoadingMessages ? 0 : 1,
                transition: 'opacity 0.15s ease-in-out',
                pointerEvents: isLoadingMessages ? 'none' : 'auto'
              }}
            >
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
                            <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', width: '100%', flexWrap: 'wrap' }}>
                              <Typography 
                                variant="body1" 
                                color="text.primary"
                                sx={{
                                  transition: 'color 0.2s ease-in-out',
                                  '&:hover': {
                                    color: 'text.secondary'
                                  },
                                  whiteSpace: 'pre-wrap', // 改行と空白を保持
                                  wordBreak: 'break-word' // 長い単語を折り返し
                                }}
                                component="div"
                              >
                                {renderMessageWithMentions(m.content, m.mentions || [])}
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
          </Box>

          {/* 入力エリア */}
          <Box sx={{ p: 2, borderTop: '1px solid', borderColor: 'divider' }}>
            <Box 
              component="form" 
              onSubmit={(e) => {
                // フォームのsubmitは無効化（Ctrl+EnterはhandleInputKeyDownで処理）
                e.preventDefault()
              }}
              sx={{ display: 'flex', gap: 1 }}
            >
              <Box sx={{ position: 'relative', width: '100%' }}>
                <TextField
                  inputRef={inputRef}
                  fullWidth
                  value={content}
                  onChange={handleContentChange}
                  onKeyDown={handleInputKeyDown}
                  onBlur={(e) => {
                    // 少し遅延を入れて、サジェストリストのクリックイベントを処理できるようにする
                    setTimeout(() => {
                      setMentionSuggestions(prev => ({ ...prev, show: false }))
                    }, 200)
                  }}
                  placeholder={`#${currentChannel} にメッセージを送信 (Ctrl+Enterで送信)`}
                  variant="outlined"
                  size="small"
                  disabled={isConnecting}
                  multiline
                  maxRows={10}
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
                {/* メンションサジェストドロップダウン */}
                {mentionSuggestions.show && getSuggestedUsers().length > 0 && (
                  <Paper
                    elevation={8}
                    sx={{
                      position: 'absolute',
                      bottom: '100%',
                      left: 0,
                      right: 0,
                      mb: 1,
                      maxHeight: 200,
                      overflow: 'auto',
                      bgcolor: 'background.paper',
                      border: '1px solid',
                      borderColor: 'divider',
                      borderRadius: 1,
                      zIndex: 1000
                    }}
                  >
                    <List dense>
                      {getSuggestedUsers().map((user, index) => (
                        <ListItem
                          key={user.username}
                          disablePadding
                          onClick={() => insertMention(user)}
                          onMouseDown={(e) => {
                            // フォーカスが外れるのを防ぐ
                            e.preventDefault()
                          }}
                          sx={{
                            bgcolor: index === selectedSuggestionIndex 
                              ? 'rgba(114, 137, 218, 0.2)' 
                              : 'transparent',
                            cursor: 'pointer',
                            '&:hover': {
                              bgcolor: 'rgba(114, 137, 218, 0.15)'
                            }
                          }}
                        >
                          <Box sx={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: 1, 
                            p: 1.5, 
                            width: '100%'
                          }}>
                            <Avatar 
                              src={user.picture} 
                              sx={{ width: 28, height: 28, bgcolor: 'primary.main' }}
                            >
                              {getInitials(user.username)}
                            </Avatar>
                            <Box sx={{ flex: 1, minWidth: 0 }}>
                              <Typography 
                                variant="body2" 
                                color="text.primary"
                                sx={{ 
                                  fontWeight: index === selectedSuggestionIndex ? 'bold' : 'normal',
                                  fontSize: '0.875rem'
                                }}
                              >
                                {user.username}
                              </Typography>
                              {user.email && (
                                <Typography 
                                  variant="caption" 
                                  color="text.secondary"
                                  sx={{ fontSize: '0.75rem' }}
                                >
                                  {user.email}
                                </Typography>
                              )}
                            </Box>
                            <Typography 
                              variant="caption" 
                              color="text.secondary"
                              sx={{ fontSize: '0.75rem', ml: 1 }}
                            >
                              Enter
                            </Typography>
                          </Box>
                        </ListItem>
                      ))}
                    </List>
                  </Paper>
                )}
              </Box>
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

