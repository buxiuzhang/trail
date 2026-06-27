import { createContext, useContext } from 'react'

interface SettingsContextType {
  activeSection: string
  setActiveSection: (section: string) => void
}

export const SettingsContext = createContext<SettingsContextType | null>(null)

export function useSettingsContext() {
  return useContext(SettingsContext)
}
