import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface McpServer {
  id: string
  name: string
  type: 'stdio' | 'sse'
  command?: string
  args?: string
  env?: string
  url?: string
  headers?: string
  enabled: number
  created_at: string
}

export interface McpServerSaveRequest {
  name: string
  type: 'stdio' | 'sse'
  command?: string
  args?: string
  env?: string
  url?: string
  headers?: string
}

export interface McpTestResult {
  ok: boolean
  error?: string
  tools?: { name: string; description: string }[]
  count?: number
}

export function useMcpServers() {
  return useQuery({
    queryKey: ['settings', 'mcp'],
    queryFn: () => api.get<McpServer[]>('/api/settings/mcp'),
    staleTime: 30_000,
  })
}

export function useCreateMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: McpServerSaveRequest) =>
      api.post<McpServer>('/api/settings/mcp', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'mcp'] }),
  })
}

export function useUpdateMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...data }: McpServerSaveRequest & { id: string; enabled?: number }) =>
      api.put<McpServer>(`/api/settings/mcp/${id}`, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'mcp'] }),
  })
}

export function useDeleteMcpServer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del(`/api/settings/mcp/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['settings', 'mcp'] }),
  })
}

export function useTestMcpServer() {
  return useMutation({
    mutationFn: (id: string) => api.post<McpTestResult>(`/api/settings/mcp/${id}/test`, {}),
  })
}
