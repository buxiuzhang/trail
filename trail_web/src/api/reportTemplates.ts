import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface ReportTemplate {
  id: string
  name: string
  description?: string
  template: string
  enabled: number
  sort_order: number
  created_at: string
}

export interface ReportTemplateSaveRequest {
  name: string
  description?: string
  template: string
  sort_order?: number
}

export function useReportTemplates() {
  return useQuery({
    queryKey: ['settings', 'report-templates'],
    queryFn: () => api.get<ReportTemplate[]>('/api/settings/report-templates'),
    staleTime: 30_000,
  })
}

export function useCreateReportTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: ReportTemplateSaveRequest) =>
      api.post<ReportTemplate>('/api/settings/report-templates', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'report-templates'] }),
  })
}

export function useUpdateReportTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: ReportTemplateSaveRequest & { id: string; enabled?: number }) =>
      api.put<ReportTemplate>(`/api/settings/report-templates/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'report-templates'] }),
  })
}

export function useDeleteReportTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/settings/report-templates/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'report-templates'] }),
  })
}
