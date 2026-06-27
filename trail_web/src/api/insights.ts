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
    staleTime: 30_000,
  })
}

export interface RelatedTodo { id?: number; title: string }

export interface LogByDateItem {
  id: number
  task_id: number
  task_title: string
  log_date: string
  phase: string
  ordinal: number
  content: string
  polished_content: string | null
  hours: number
  attachment_count: number
  related_todos?: RelatedTodo[]
}

export function useLogsByDate(date: string) {
  return useQuery({
    queryKey: ['logs', 'by-date', date],
    queryFn: () => api.get<LogByDateItem[]>(`/api/logs/by-date?date=${date}`),
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

export interface HeatmapCell {
  task_id: number
  task_title: string
  date: string
  count: number
  hours: number
}

export interface TaskItem { id: number; title: string; status: string }

export function useAllTasks() {
  return useQuery({
    queryKey: ['all-tasks-heatmap'],
    queryFn: () => api.get<{ items: TaskItem[] }>('/api/tasks?limit=9999').then(r => r.items),
    staleTime: 60_000,
  })
}

export function useLogHeatmap(start: string, end: string) {
  return useQuery({
    queryKey: ['logs', 'heatmap', start, end],
    queryFn: () => api.get<HeatmapCell[]>(`/api/logs/heatmap?start=${start}&end=${end}`),
    staleTime: 60_000,
    enabled: !!start && !!end,
  })
}

