import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { LogOut, LogCreate, LogUpdate } from '@/types'

export function useLogs(taskId: number) {
  return useQuery({
    queryKey: ['logs', taskId],
    queryFn: () => api.get<LogOut[]>(`/api/tasks/${taskId}/logs`),
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
    },
  })
}

export function useUpdateLog(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ logId, data }: { logId: number; data: LogUpdate }) =>
      api.put<LogOut>(`/api/tasks/${taskId}/logs/${logId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs', taskId] })
    },
  })
}

export function useDeleteLog(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (logId: number) => api.del(`/api/tasks/${taskId}/logs/${logId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['logs', taskId] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}
