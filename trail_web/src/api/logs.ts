import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { InfiniteData } from '@tanstack/react-query'
import { api } from './client'
import type { LogOut, LogCreate, LogUpdate } from '@/types'

const LOG_PAGE_SIZE = 5

type LogPage = { items: LogOut[]; total: number }
type LogCache = InfiniteData<LogPage, number>

export function useInfiniteLogs(taskId: number, sort: 'asc' | 'desc' = 'desc') {
  return useInfiniteQuery({
    queryKey: ['logs', taskId, sort],
    queryFn: ({ pageParam }) =>
      api.get<LogPage>(
        `/api/tasks/${taskId}/logs?limit=${LOG_PAGE_SIZE}&offset=${pageParam}&sort=${sort}`
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    enabled: !isNaN(taskId) && taskId > 0,
  })
}

export function useCreateLog(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: LogCreate) => api.post<LogOut>(`/api/tasks/${taskId}/logs`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs', taskId] })
      qc.invalidateQueries({ queryKey: ['tasks', taskId] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['watched-tasks'] })
    },
  })
}

export function useUpdateLog(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ logId, data }: { logId: number; data: LogUpdate }) =>
      api.put<LogOut>(`/api/tasks/${taskId}/logs/${logId}`, data),
    onSuccess: (updated) => {
      qc.setQueriesData<LogCache>({ queryKey: ['logs', taskId] }, old => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map(page => ({
            ...page,
            items: page.items.map(item => item.id === updated.id ? updated : item),
          })),
        }
      })
      qc.invalidateQueries({ queryKey: ['todo-logs', taskId] })
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['logs', taskId] })
    },
  })
}

export function useDeleteLog(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (logId: number) => api.del(`/api/tasks/${taskId}/logs/${logId}`),
    onSuccess: (_, logId) => {
      qc.setQueriesData<LogCache>({ queryKey: ['logs', taskId] }, old => {
        if (!old) return old
        return {
          ...old,
          pages: old.pages.map(page => ({
            total: page.total - 1,
            items: page.items.filter(item => item.id !== logId),
          })),
        }
      })
      qc.invalidateQueries({ queryKey: ['todo-logs', taskId] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['watched-tasks'] })
    },
    onError: () => {
      qc.invalidateQueries({ queryKey: ['logs', taskId] })
    },
  })
}
