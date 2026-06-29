/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

export interface FilterState {
  status: string   // "all" | 具体状态
  nature: string   // "all" | 具体性质
  tag: string      // "all" | 具体标签
  month: string    // "all" | "YYYY-MM"
}

const DEFAULT_FILTER: FilterState = { status: '进行中', nature: 'all', tag: 'all', month: 'all' }

interface FilterContextValue {
  filter: FilterState
  setStatus: (s: string) => void
  setNature: (n: string) => void
  setTag: (t: string) => void
  setMonth: (m: string) => void
  resetFilter: () => void
}

const FilterContext = createContext<FilterContextValue | null>(null)

export function FilterProvider({ children }: { children: ReactNode }) {
  const [filter, setFilter] = useState<FilterState>(DEFAULT_FILTER)

  const setStatus = useCallback((status: string) => setFilter(f => ({ ...f, status })), [])
  const setNature = useCallback((nature: string) => setFilter(f => ({ ...f, nature })), [])
  const setTag = useCallback((tag: string) => setFilter(f => ({ ...f, tag })), [])
  const setMonth = useCallback((month: string) => setFilter(f => ({ ...f, month })), [])
  const resetFilter = useCallback(() => setFilter(DEFAULT_FILTER), [])

  return (
    <FilterContext.Provider value={{ filter, setStatus, setNature, setTag, setMonth, resetFilter }}>
      {children}
    </FilterContext.Provider>
  )
}

export function useFilterContext() {
  const ctx = useContext(FilterContext)
  if (!ctx) throw new Error('useFilterContext must be used within FilterProvider')
  return ctx
}
