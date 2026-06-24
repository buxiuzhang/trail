import { createContext, useContext, useState, type ReactNode } from 'react'

type WorkbenchPanel = 'quick-log' | 'dashboard' | null

interface WorkbenchContextType {
  panel: WorkbenchPanel
  setPanel: (p: WorkbenchPanel, targetDate?: string) => void
  switchCount: number
  targetDate: string | null
  clearTargetDate: () => void
}

const WorkbenchContext = createContext<WorkbenchContextType | null>(null)

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [panel, setPanelState] = useState<WorkbenchPanel>('dashboard')
  const [switchCount, setSwitchCount] = useState(0)
  const [targetDate, setTargetDate] = useState<string | null>(null)

  function setPanel(p: WorkbenchPanel, date?: string) {
    setTargetDate(date ?? null)
    setPanelState(p)
    setSwitchCount(c => c + 1)
  }

  function clearTargetDate() {
    setTargetDate(null)
  }

  return (
    <WorkbenchContext.Provider value={{ panel, setPanel, switchCount, targetDate, clearTargetDate }}>
      {children}
    </WorkbenchContext.Provider>
  )
}

export function useWorkbench() {
  const ctx = useContext(WorkbenchContext)
  if (!ctx) throw new Error('useWorkbench must be used within WorkbenchProvider')
  return ctx
}
