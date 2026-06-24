import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { OverviewOut, StaleOut } from '@/types'

export function useOverview() {
  return useQuery({
    queryKey: ['overview'],
    queryFn: () => api.get<OverviewOut>('/api/insights/overview'),
    staleTime: 60_000,
  })
}

export function useStaleTasks(idleDays: number = 30) {
  return useQuery({
    queryKey: ['stale', idleDays],
    queryFn: () => api.get<StaleOut[]>(`/api/insights/stale?days=${idleDays}`),
    staleTime: 0,
  })
}

export function useLogsByDate(date: string) {
  return useQuery({
    queryKey: ['logs', 'by-date', date],
    queryFn: () => api.get<Record<string, unknown>[]>(`/api/logs/by-date?date=${date}`),
    staleTime: 30_000,
    enabled: !!date,
  })
}

export interface DayHours { date: string; hours: number; count?: number }

export function useLogsByDateRange(start: string, end: string) {
  return useQuery({
    queryKey: ['logs', 'range', start, end],
    queryFn: () => api.get<DayHours[]>(`/api/logs/by-date-range?start=${start}&end=${end}`),
    staleTime: 60_000,
    enabled: !!start && !!end,
  })
}

export interface TodoStatsOut { new_today: number; followed_today: number }

export function useTodoStats() {
  return useQuery({
    queryKey: ['insights', 'todo-stats'],
    queryFn: () => api.get<TodoStatsOut>('/api/insights/todo-stats'),
    staleTime: 30_000,
  })
}

