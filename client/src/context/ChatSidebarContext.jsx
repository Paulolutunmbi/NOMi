import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createChat, listAllChats } from '../api/nomiClient'

const ChatSidebarContext = createContext(null)

/**
 * Owns the chat list shown in NOMI's single sidebar (desktop: always
 * visible; mobile: a hamburger-triggered drawer with the same content).
 * Previously this list lived inside Workspace.jsx while AppShell rendered
 * an entirely separate "Chat / Settings" navigation sidebar — two sidebars
 * competing for the same space. Lifting the chat list here lets AppShell
 * render one, and lets any page (not just Workspace) start a new chat or
 * jump to an existing one.
 *
 * Note: this provider sits ABOVE the <Routes> that declare `chat/:chatId`
 * (AppShell renders its sidebar alongside the routed page, not inside it),
 * so it cannot read that param with useParams() itself. Instead, whichever
 * routed page knows the current chatId (Workspace) reports it up via
 * setSelectedChatId so the sidebar can highlight the active chat.
 */
export function ChatSidebarProvider({ children }) {
  const navigate = useNavigate()
  const [selectedChatId, setSelectedChatId] = useState(null)
  const [chats, setChats] = useState([])
  const [listError, setListError] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [refreshToken, setRefreshToken] = useState(0)

  const refreshChats = useCallback(() => setRefreshToken((token) => token + 1), [])

  useEffect(() => {
    let active = true
    listAllChats()
      .then(({ chats: items }) => {
        if (active) {
          setChats(items || [])
          setListError(false)
        }
      })
      .catch(() => { if (active) setListError(true) })
    return () => { active = false }
  }, [refreshToken])

  const newChat = useCallback(async () => {
    try {
      const { chat } = await createChat('home')
      setChats((prev) => [chat, ...prev.filter((item) => item.id !== chat.id)])
      setMobileOpen(false)
      navigate(`/app/chat/${chat.id}`)
      return chat
    } catch {
      setListError(true)
      return null
    }
  }, [navigate])

  const goToChat = useCallback((targetChatId) => {
    setMobileOpen(false)
    navigate(`/app/chat/${targetChatId}`)
  }, [navigate])

  return (
    <ChatSidebarContext.Provider
      value={{ chats, listError, selectedChatId, setSelectedChatId, newChat, goToChat, mobileOpen, setMobileOpen, refreshChats }}
    >
      {children}
    </ChatSidebarContext.Provider>
  )
}

export function useChatSidebar() {
  const ctx = useContext(ChatSidebarContext)
  if (!ctx) throw new Error('useChatSidebar must be used within a ChatSidebarProvider')
  return ctx
}
