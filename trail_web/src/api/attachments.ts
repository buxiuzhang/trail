/**
 * 附件上传 / 下载 / 更新 / 删除 / size 缓存（M10 + M11）。
 *
 * 设计说明：
 *   - 上传不走 `api/client.ts:request()`。request() 强制 `Content-Type: application/json` + `JSON.stringify(body)`，
 *     而上传需要 `multipart/form-data` 且由浏览器自动 boundary 编码。改造 request() 影响 100+ 处调用，
 *     此处单点旁路是合理折中。
 *   - 后端 mime 白名单：image/png、image/jpeg、image/gif、image/webp。
 *   - 后端大小上限：单图 10MB（见 application.yml: spring.servlet.multipart.max-file-size）。
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'

export interface AttachmentOut {
  id: number
  url: string
  mime: string
  byte_size: number
  original_name: string | null
  display_size: number
}

export interface DeleteInUseError {
  error: 'ATTACHMENT_IN_USE'
  refCount: number
  references: Array<{
    sourceType: 'task' | 'log' | 'todo'
    sourceId: number
    column: string
    taskId: number
    title: string | null
    logDate: string | null
    snippet: string | null
  }>
}

export interface AttachmentListItem {
  id: number
  url: string
  mime: string
  byte_size: number
  original_name: string | null
  display_size: number
  created_at: string
  ref_count: number
  active_ref_count: number
}

export function useAttachmentTasks() {
  return useQuery({
    queryKey: ['attachments', 'tasks'],
    queryFn: () => api.get<Array<{ id: number; title: string }>>('/api/attachments/tasks'),
    staleTime: 30_000,
  })
}

export function useAttachmentList(filters: { mimes?: string[]; taskIds?: number[] } = {}) {
  const params = new URLSearchParams()
  filters.mimes?.forEach(m => params.append('mime', m))
  filters.taskIds?.forEach(id => params.append('taskId', String(id)))
  const query = params.toString()
  return useQuery({
    queryKey: ['attachments', 'list', filters.mimes, filters.taskIds],
    queryFn: () => api.get<AttachmentListItem[]>(`/api/attachments${query ? '?' + query : ''}`),
    staleTime: 30_000,
  })
}

export function useUploadAttachment() {
  return useMutation({
    mutationFn: async (file: File): Promise<AttachmentOut> => {
      const form = new FormData()
      form.append('file', file)
      const r = await fetch('/api/attachments', { method: 'POST', body: form })
      if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try {
          const j = await r.json()
          if (j?.detail) detail = j.detail
        } catch { /* 不是 JSON，忽略 */ }
        throw new Error(detail)
      }
      return r.json() as Promise<AttachmentOut>
    },
  })
}

/** 读 attachment 详情（拿到 displaySize）。 */
export function useAttachment(id: number | null) {
  return useQuery({
    queryKey: ['attachment', id],
    queryFn: () => api.get<AttachmentOut>(`/api/attachments/${id}/meta`),
    enabled: id != null,
    staleTime: 60_000,
  })
}

/** 按 ID 列表批量获取附件元数据，用于 @file:N decoration 渲染。 */
export function useAttachmentsByIds(ids: number[]) {
  const key = ids.slice().sort((a, b) => a - b).join(',')
  return useQuery({
    queryKey: ['attachments', 'by-ids', key],
    queryFn: () => {
      if (ids.length === 0) return Promise.resolve([] as AttachmentOut[])
      const params = ids.map(id => `ids=${id}`).join('&')
      return api.get<AttachmentOut[]>(`/api/attachments/by-ids?${params}`)
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
  })
}

/** 拿到 attachments 列表全部记录（用于一次性预热 size 缓存）。当前阶段未用，预留。 */
// export function useAllAttachments() { ... }

/** 更新 displaySize。M11 关键 hook:乐观更新本地 cache。 */
export function useUpdateAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: number; displaySize: number }): Promise<AttachmentOut> => {
      return api.put<AttachmentOut>(`/api/attachments/${input.id}`, { displaySize: input.displaySize })
    },
    onMutate: async ({ id, displaySize }) => {
      const prev = qc.getQueryData<AttachmentOut>(['attachment', id])
      if (prev) qc.setQueryData(['attachment', id], { ...prev, display_size: displaySize })
      return { prev }
    },
    onError: (_err, vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['attachment', vars.id], ctx.prev)
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ['attachment', vars.id] })
    },
  })
}

/** 删除附件。>0 引用时返 409 + ATTACHMENT_IN_USE 错误体（throw 到 onError）。 */
export function useDeleteAttachment() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number): Promise<void> => {
      const r = await fetch(`/api/attachments/${id}`, { method: 'DELETE' })
      if (r.status === 204) return
      if (r.status === 409) {
        const body = (await r.json()) as DeleteInUseError
        const err = new Error(`图片被 ${body.refCount} 处引用`) as Error & { inUse: DeleteInUseError }
        err.inUse = body
        throw err
      }
      if (!r.ok) {
        let detail = `HTTP ${r.status}`
        try {
          const j = await r.json()
          if (j?.detail) detail = j.detail
        } catch { /* 忽略 */ }
        throw new Error(detail)
      }
    },
    onSuccess: (_void, id) => {
      qc.invalidateQueries({ queryKey: ['attachment', id] })
    },
  })
}
