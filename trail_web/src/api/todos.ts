import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { TodoOut, TodoCreate, TodoUpdate } from '@/types'

export function useTodos(taskId: number) {
  return useQuery({
    queryKey: ['todos', taskId],
    queryFn: () => api.get<TodoOut[]>(`/api/tasks/${taskId}/todos`),
    enabled: !isNaN(taskId) && taskId > 0,
  })
}

export function useCreateTodo(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: TodoCreate) => api.post<TodoOut>(`/api/tasks/${taskId}/todos`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos', taskId] })
    },
  })
}

export function useUpdateTodo(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ todoId, data }: { todoId: number; data: TodoUpdate }) =>
      api.put<TodoOut>(`/api/tasks/${taskId}/todos/${todoId}`, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos', taskId] })
    },
  })
}

/** 标记完成（单向终态：已废弃不可再置完成；已完成的允许幂等）。 */
export function useCompleteTodo(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (todoId: number) =>
      api.put<TodoOut>(`/api/tasks/${taskId}/todos/${todoId}/complete`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos', taskId] })
    },
  })
}

/** 标记废弃（单向终态：已完成不可再废弃；已废弃的允许幂等）。 */
export function useAbandonTodo(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (todoId: number) =>
      api.put<TodoOut>(`/api/tasks/${taskId}/todos/${todoId}/abandon`, {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos', taskId] })
    },
  })
}

/** 物理删除（前端不再展示）。 */
export function useDeleteTodo(taskId: number) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (todoId: number) => api.del(`/api/tasks/${taskId}/todos/${todoId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['todos', taskId] })
    },
  })
}

export interface TodoLogItem {
  id: number
  task_id: number
  task_title: string
  log_date: string
  hours: number
  content: string
}

/** 展开待办时懒加载关联日志（enabled=expanded）。 */
export function useLogsForTodo(taskId: number, todoId: number, enabled: boolean) {
  return useQuery({
    queryKey: ['todo-logs', taskId, todoId],
    queryFn: () => api.get<TodoLogItem[]>(`/api/tasks/${taskId}/todos/${todoId}/logs`),
    enabled,
  })
}
