/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

export interface PolishConfig {
  type: 'log' | 'todo' | 'task_desc'
  initialContent: string
  contentForLLM?: string
  taskId?: number
  todos?: { id: number; title: string }[]
  tasks?: { id: number; title: string }[]
  onAdopt: (suggestion: string) => void
}

interface ChatContextValue {
  isOpen: boolean
  isExpanded: boolean
  /** 非 null 时 ChatWindow 进入润色模式 */
  polishConfig: PolishConfig | null
  messages: Message[]
  isLoading: boolean
  alertCount: number
  openChat: () => void
  closeChat: () => void
  expandChat: () => void
  collapseChat: () => void
  /** 以润色模式打开对话框。工作对话已开启时返回 false，否则打开并返回 true */
  openPolish: (config: PolishConfig) => boolean
  addMessage: (role: 'user' | 'assistant', content: string) => void
  updateLastMessage: (content: string) => void
  removeLastMessage: () => void
  clearMessages: () => void
  setIsLoading: (v: boolean) => void
  pushAlert: (content: string) => void
  clearAlerts: () => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

const GREETING = '你好，我是 Trail 工作日报助教。你可以问我今日工作进展、本周情况、任务状态等。有什么想了解的？'

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [isExpanded, setIsExpanded] = useState(false)
  const [polishConfig, setPolishConfig] = useState<PolishConfig | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [alertCount, setAlertCount] = useState(0)

  const openChat = useCallback(() => {
    setPolishConfig(null)
    setIsOpen(true)
    setMessages(prev => {
      if (prev.length === 0) {
        return [{ id: crypto.randomUUID(), role: 'assistant' as const, content: GREETING, timestamp: Date.now() }]
      }
      return prev
    })
  }, [])

  const closeChat = useCallback(() => {
    setIsOpen(false)
    setIsExpanded(false)
    setPolishConfig(null)
  }, [])

  const expandChat = useCallback(() => setIsExpanded(true), [])
  const collapseChat = useCallback(() => setIsExpanded(false), [])

  const openPolish = useCallback((config: PolishConfig): boolean => {
    if (isOpen && polishConfig === null) return false
    setPolishConfig(config)
    setMessages([])
    setIsOpen(true)
    setIsExpanded(true)
    return true
  }, [isOpen, polishConfig])

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    setMessages(prev => [...prev, { id: crypto.randomUUID(), role, content, timestamp: Date.now() }])
  }, [])

  const updateLastMessage = useCallback((content: string) => {
    setMessages(prev => {
      if (prev.length === 0) return prev
      const next = prev.slice()
      next[next.length - 1] = { ...next[next.length - 1], content }
      return next
    })
  }, [])

  const removeLastMessage = useCallback(() => {
    setMessages(prev => prev.length === 0 ? prev : prev.slice(0, -1))
  }, [])

  const clearMessages = useCallback(() => setMessages([]), [])

  const pushAlert = useCallback((content: string) => {
    setMessages(prev => {
      const base = prev.length === 0
        ? [{ id: crypto.randomUUID(), role: 'assistant' as const, content: GREETING, timestamp: Date.now() }]
        : prev
      return [...base, { id: crypto.randomUUID(), role: 'assistant' as const, content, timestamp: Date.now() }]
    })
    setAlertCount(n => n + 1)
  }, [])

  const clearAlerts = useCallback(() => setAlertCount(0), [])

  return (
    <ChatContext.Provider value={{
      isOpen, isExpanded, polishConfig, messages, isLoading, alertCount,
      openChat, closeChat, expandChat, collapseChat, openPolish,
      addMessage, updateLastMessage, removeLastMessage, clearMessages, setIsLoading,
      pushAlert, clearAlerts,
    }}>
      {children}
    </ChatContext.Provider>
  )
}

export function useChatContext() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatContext 必须在 ChatProvider 内使用')
  return ctx
}
