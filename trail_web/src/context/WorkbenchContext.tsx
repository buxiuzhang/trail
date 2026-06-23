import { createContext, useContext, useState, type ReactNode } from 'react'

type WorkbenchPanel = 'quick-log' | null

interface WorkbenchContextType {
  panel: WorkbenchPanel
  setPanel: (p: WorkbenchPanel) => void
}

const WorkbenchContext = createContext<WorkbenchContextType | null>(null)

export function WorkbenchProvider({ children }: { children: ReactNode }) {
  const [panel, setPanel] = useState<WorkbenchPanel>('quick-log')
  return (
    <WorkbenchContext.Provider value={{ panel, setPanel }}>
      {children}
    </WorkbenchContext.Provider>
  )
}

export function useWorkbench() {
  const ctx = useContext(WorkbenchContext)
  if (!ctx) throw new Error('useWorkbench must be used within WorkbenchProvider')
  return ctx
}
