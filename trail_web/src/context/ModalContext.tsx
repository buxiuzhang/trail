/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface ModalConfig {
  eyebrow: string
  title: string
  titleMode?: 'zh' | 'en'
  body: ReactNode
  buttons: { label: string; className?: string; action: () => void }[]
}

interface ModalContextValue {
  config: ModalConfig | null
  openModal: (cfg: ModalConfig) => void
  closeModal: () => void
}

const ModalContext = createContext<ModalContextValue | null>(null)

export function ModalProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ModalConfig | null>(null)

  const openModal = useCallback((cfg: ModalConfig) => setConfig(cfg), [])
  const closeModal = useCallback(() => setConfig(null), [])

  return (
    <ModalContext.Provider value={{ config, openModal, closeModal }}>
      {children}
    </ModalContext.Provider>
  )
}

export function useModalContext() {
  const ctx = useContext(ModalContext)
  if (!ctx) throw new Error('useModalContext must be used within ModalProvider')
  return ctx
}
