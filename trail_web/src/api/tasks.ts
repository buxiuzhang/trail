import { useQuery, useMutation, useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { PagedResponse, TaskOut, TaskCreate, TaskUpdate, StatusChange } from '@/types'

// ── 查询 ──

/**
 * 拉全量任务（已废弃，Sidebar 统计改用 useOverview）。
 * @deprecated
 */
export function useTasks() {
  return useQuery({
    queryKey: ['tasks'],
    queryFn: () => api.get<PagedResponse<TaskOut>>('/api/tasks').then(r => r.items),
    staleTime: 60_000,
  })
}

export function useTask(id: number) {
  return useQuery({
    queryKey: ['tasks', id],
    queryFn: () => api.get<TaskOut>(`/api/tasks/${id}`),
    enabled: !isNaN(id) && id > 0,
    staleTime: 30_000,
  })
}

/** 任务列表筛选参数（与后端 query param 对齐）。 */
export interface TaskListParams {
  status?: string
  nature?: string
  month?: string
  tag?: string
  search?: string
}

/** 单页条数。首页默认 5 个，滚到底 200px 预拉下一页。 */
export const TASK_PAGE_SIZE = 5

/** 无限滚动任务列表。queryKey 把 params 编进去，切筛选自动重拉首页。 */
export function useInfiniteTasks(params: TaskListParams = {}) {
  const qs = new URLSearchParams()
  qs.set('limit', String(TASK_PAGE_SIZE))
  if (params.status && params.status !== 'all') qs.set('status', params.status)
  if (params.nature && params.nature !== 'all') qs.set('nature', params.nature)
  if (params.month && params.month !== 'all') qs.set('month', params.month)
  if (params.tag && params.tag !== 'all') qs.set('tag', params.tag)
  if (params.search) qs.set('search', params.search)

  return useInfiniteQuery({
    queryKey: ['tasks', 'paged', params],
    queryFn: ({ pageParam }) => {
      const url = `/api/tasks?${qs.toString()}&offset=${pageParam}`
      return api.get<PagedResponse<TaskOut>>(url)
    },
    initialPageParam: 0,
    // 下一页 pageParam = 已加载总数（累加所有 pages 的 items.length）
    // < pageSize 表示最后一页，不再拉
    getNextPageParam: (lastPage, allPages) => {
      const loaded = allPages.reduce((sum, p) => sum + p.items.length, 0)
      return loaded < lastPage.total ? loaded : undefined
    },
    staleTime: 30_000,
  })
}

// ── 变更 ──

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TaskCreate) => api.post<TaskOut>('/api/tasks', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export function useUpdateTask(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TaskUpdate) => api.put<TaskOut>(`/api/tasks/${id}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['tasks', id] })
    },
  })
}

export function useChangeTaskStatus(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: StatusChange) => api.post<TaskOut>(`/api/tasks/${id}/status`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['tasks', id] })
      qc.invalidateQueries({ queryKey: ['logs', id] })
    },
  })
}

export function useCancelTask(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<TaskOut>(`/api/tasks/${id}/cancel`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
      qc.invalidateQueries({ queryKey: ['tasks', id] })
    },
  })
}

export function usePinTask(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<TaskOut>(`/api/tasks/${id}/pin`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export function useUnpinTask(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<TaskOut>(`/api/tasks/${id}/unpin`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}

export function useWatchTask(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<TaskOut>(`/api/tasks/${id}/watch`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['watched-tasks'] })
    },
  })
}

export function useUnwatchTask(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<TaskOut>(`/api/tasks/${id}/unwatch`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['watched-tasks'] })
    },
  })
}

export function useWatchedTasks() {
  return useQuery({
    queryKey: ['watched-tasks'],
    queryFn: () => api.get<TaskOut[]>('/api/tasks/watched'),
    staleTime: 30_000,
  })
}

export function useDeleteTask(id: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.del(`/api/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] })
      qc.invalidateQueries({ queryKey: ['overview'] })
    },
  })
}
