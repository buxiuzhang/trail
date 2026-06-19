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
    queryFn: () => api.get<StaleOut[]>(`/api/insights/stale?idle_days=${idleDays}`),
    staleTime: 60_000,
  })
}
