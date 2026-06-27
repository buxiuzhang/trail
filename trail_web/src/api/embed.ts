import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface InitProgress {
  done: number
  total: number
}

export interface InitStatus {
  status: 'idle' | 'running' | 'done' | 'failed'
  progress: {
    tasks: InitProgress
    logs:  InitProgress
    todos: InitProgress
  }
  result?: {
    tasks: { total: number; indexed: number; skipped: number; failed: number }
    logs:  { total: number; indexed: number; skipped: number; failed: number }
    todos: { total: number; indexed: number; skipped: number; failed: number }
    duration_ms: number
  }
  error?: string
}

export interface VectorStats {
  rows: number
  ids: string[]
}

/** 轮询初始化进度：running 时每 2s 刷一次，否则不轮询。 */
export function useVectorInitStatus() {
  return useQuery({
    queryKey: ['embed', 'init-status'],
    queryFn: () => api.get<InitStatus>('/api/embed/init/status'),
    refetchInterval: (query) =>
      query.state.data?.status === 'running' ? 2000 : false,
  })
}

/** 启动全量初始化。 */
export function useStartVectorInit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (skipExisting: boolean) =>
      api.post<{ status: string }>(`/api/embed/init?skip_existing=${skipExisting}`, null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['embed', 'init-status'] })
    },
  })
}

/** 向量库行数统计。 */
export function useVectorStats() {
  return useQuery({
    queryKey: ['embed', 'stats'],
    queryFn: () => api.get<VectorStats>('/api/embed/stats'),
    staleTime: 10_000,
  })
}
