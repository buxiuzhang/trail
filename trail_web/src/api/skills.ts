import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface Skill {
  id: string
  name: string
  description?: string
  system_prompt: string
  enabled: number
  sort_order: number
  scope: string
  created_at: string
}

export interface SkillSaveRequest {
  name: string
  description?: string
  system_prompt: string
  sort_order?: number
  scope?: string[]
}

export function useSkills() {
  return useQuery({
    queryKey: ['settings', 'skills'],
    queryFn: () => api.get<Skill[]>('/api/settings/skills'),
    staleTime: 30_000,
  })
}

export function useCreateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: SkillSaveRequest) =>
      api.post<Skill>('/api/settings/skills', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'skills'] }),
  })
}

export function useUpdateSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: SkillSaveRequest & { id: string; enabled?: number }) =>
      api.put<Skill>(`/api/settings/skills/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'skills'] }),
  })
}

export function useDeleteSkill() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/settings/skills/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'skills'] }),
  })
}
