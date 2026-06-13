import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: string
  timestamp: number
}

interface ChatContextValue {
  isOpen: boolean
  messages: Message[]
  isLoading: boolean
  openChat: () => void
  closeChat: () => void
  addMessage: (role: 'user' | 'assistant', content: string) => void
  /** 把最后一条消息的 content 改写为新值（用于流式结束时把 partial 文本写回 state）。 */
  updateLastMessage: (content: string) => void
  clearMessages: () => void
  setIsLoading: (v: boolean) => void
}

const ChatContext = createContext<ChatContextValue | null>(null)

const GREETING = '你好，我是 Trail 工作日志助教。你可以问我今日工作进展、本周情况、任务状态等。有什么想了解的？'

export function ChatProvider({ children }: { children: ReactNode }) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [isLoading, setIsLoading] = useState(false)

  const openChat = useCallback(() => {
    setIsOpen(true)
    // 首次打开时插入问候语
    setMessages(prev => {
      if (prev.length === 0) {
        return [
          {
            id: crypto.randomUUID(),
            role: 'assistant' as const,
            content: GREETING,
            timestamp: Date.now(),
          },
        ]
      }
      return prev
    })
  }, [])

  const closeChat = useCallback(() => {
    setIsOpen(false)
  }, [])

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    setMessages(prev => [
      ...prev,
      {
        id: crypto.randomUUID(),
        role,
        content,
        timestamp: Date.now(),
      },
    ])
  }, [])

  const updateLastMessage = useCallback((content: string) => {
    setMessages(prev => {
      if (prev.length === 0) return prev
      const next = prev.slice()
      next[next.length - 1] = { ...next[next.length - 1], content }
      return next
    })
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  return (
    <ChatContext.Provider
      value={{
        isOpen,
        messages,
        isLoading,
        openChat,
        closeChat,
        addMessage,
        updateLastMessage,
        clearMessages,
        setIsLoading,
      }}
    >
      {children}
    </ChatContext.Provider>
  )
}

export function useChatContext() {
  const ctx = useContext(ChatContext)
  if (!ctx) throw new Error('useChatContext 必须在 ChatProvider 内使用')
  return ctx
}
