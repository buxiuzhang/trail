/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react'

interface ToastContextValue {
  message: string
  visible: boolean
  showToast: (msg: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('')
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const showToast = useCallback((msg: string) => {
    if (timer.current) clearTimeout(timer.current)
    setMessage(msg)
    setVisible(true)
    timer.current = setTimeout(() => setVisible(false), 2500)
  }, [])

  return (
    <ToastContext.Provider value={{ message, visible, showToast }}>
      {children}
    </ToastContext.Provider>
  )
}

export function useToastContext() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToastContext must be used within ToastProvider')
  return ctx
}
