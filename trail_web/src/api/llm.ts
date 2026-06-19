import { useMutation } from '@tanstack/react-query'
import { api } from './client'

/** LLM 后端可用状态：Java trail_api/ 阶段 2 已实现。 */
export const LLM_AVAILABLE = true

interface PolishIn { content: string; task_id?: number; type?: 'log' | 'todo' }
interface PolishOut { polished: string; mock: boolean }
interface SummarizeOut { text: string }
interface AskMaintenanceOut { suggestion: string }

export function usePolish() {
  return useMutation({
    mutationFn: (data: PolishIn) => api.post<PolishOut>('/api/llm/polish', data),
  })
}

export function usePolishLogged(taskId: number, logId: number) {
  return useMutation({
    mutationFn: () => api.post<PolishOut>(`/api/tasks/${taskId}/logs/${logId}/polish`, {}),
  })
}

export function useSummarize(taskId: number) {
  return useMutation({
    mutationFn: () => api.post<SummarizeOut>(`/api/tasks/${taskId}/summarize`, {}),
  })
}

export function useMaintenanceSummary(taskId: number) {
  return useMutation({
    mutationFn: () => api.post<SummarizeOut>(`/api/tasks/${taskId}/maintenance/summarize`, {}),
  })
}

export function useAskMaintenance(taskId: number) {
  return useMutation({
    mutationFn: () => api.post<AskMaintenanceOut>(`/api/tasks/${taskId}/ask-maintenance`, {}),
  })
}

export function useDraftLog(taskId: number) {
  return useMutation({
    mutationFn: (hint: string) =>
      api.post<PolishOut>(`/api/tasks/${taskId}/logs/draft`, { hint }),
  })
}
