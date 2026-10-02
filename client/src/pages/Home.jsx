import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import Workspace from './Workspace'
import CalendarAgenda from '../components/CalendarAgenda'
import { useChatSidebar } from '../context/ChatSidebarContext'
import { describeWhen } from '../utils/calendarItems'

const PENDING_ASK_KEY = 'nomi.pendingAsk'

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-colors ${active ? 'bg-nomi-orange-tint text-nomi-orange-dark' : 'text-ink-soft hover:bg-surface-sunken hover:text-ink'}`}
    >
      {children}
    </button>
  )
}

export default function Home() {
  const { chatId } = useParams()
  const { newChat } = useChatSidebar()
  const [tab, setTab] = useState('chat') // chat | calendar
  const [calendarVisited, setCalendarVisited] = useState(false)
  const [prefill, setPrefill] = useState(null)

  const openTab = (next) => {
    setTab(next)
    if (next === 'calendar') setCalendarVisited(true)
  }

  // "Ask NOMI" on a calendar item: park the question, make sure a chat exists
  // (creating one navigates, which can remount this page — hence storage),
  // then drop the question into that chat's composer.
  const applyPendingAsk = useCallback(() => {
    try {
      const raw = sessionStorage.getItem(PENDING_ASK_KEY)
      if (!raw) return
      sessionStorage.removeItem(PENDING_ASK_KEY)
      setTab('chat')
      setPrefill({ text: JSON.parse(raw).text, token: `${Date.now()}-${Math.random()}` })
    } catch { /* storage unavailable — the person can just type the question */ }
  }, [])

  useEffect(() => { if (chatId) applyPendingAsk() }, [chatId, applyPendingAsk])

  const askAboutItem = async (item, tz) => {
    const text = `What are the details of my "${item.summary || 'event'}" on ${describeWhen(item, tz)}?`
    try { sessionStorage.setItem(PENDING_ASK_KEY, JSON.stringify({ text })) } catch { /* see above */ }
    if (chatId) applyPendingAsk()
    else await newChat()
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div role="tablist" aria-label="Workspace view" className="flex shrink-0 items-center gap-1 border-b border-line bg-surface px-3 py-2 sm:px-6">
        <TabButton active={tab === 'chat'} onClick={() => openTab('chat')}>Chat</TabButton>
        <TabButton active={tab === 'calendar'} onClick={() => openTab('calendar')}>Calendar</TabButton>
      </div>
      <div className={tab === 'chat' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}>
        <Workspace
          prefill={prefill}
          placeholder="Ask NOMI to find an email, draft a reply, or manage your calendar…"
          emptyTitle="Your NOMI workspace is ready"
          emptyBody="Ask about your email or your calendar in plain language — NOMI will handle the rest, with your approval at each step."
          suggestions={[
            'What\'s on my calendar today?',
            'Find my unread emails from this week',
          ]}
        />
      </div>
      {calendarVisited && (
        <div className={tab === 'calendar' ? 'min-h-0 flex-1 overflow-hidden' : 'hidden'}>
          <CalendarAgenda onAsk={askAboutItem} />
        </div>
      )}
    </div>
  )
}
