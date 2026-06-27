/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useCallback, useState, type ReactNode } from 'react'

export interface DownloadTask {
  id: string
  fileName: string
  /** 0-100, or -1 when server doesn't send Content-Length */
  progress: number
  status: 'pending' | 'downloading' | 'done' | 'error'
  error?: string
  abortFn?: () => void
}

interface DownloadQueueContextValue {
  tasks: DownloadTask[]
  enqueueDownload: (url: string, fileName?: string) => void
  dismissTask: (id: string) => void
}

const DownloadQueueContext = createContext<DownloadQueueContextValue | null>(null)

export function useDownloadQueue() {
  const ctx = useContext(DownloadQueueContext)
  if (!ctx) throw new Error('useDownloadQueue 必须在 DownloadQueueProvider 内使用')
  return ctx
}

export function DownloadQueueProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<DownloadTask[]>([])

  const updateTask = useCallback((id: string, patch: Partial<DownloadTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  const dismissTask = useCallback((id: string) => {
    setTasks(prev => {
      const task = prev.find(t => t.id === id)
      task?.abortFn?.()
      return prev.filter(t => t.id !== id)
    })
  }, [])

  const enqueueDownload = useCallback((url: string, fileName?: string) => {
    const id = crypto.randomUUID()
    const displayName = fileName || decodeURIComponent(url.split('/').pop() || url)

    const task: DownloadTask = {
      id,
      fileName: displayName,
      progress: -1,
      status: 'pending',
    }
    setTasks(prev => [...prev, task])

    const controller = new AbortController()
    updateTask(id, { status: 'downloading', abortFn: () => controller.abort() })

    ;(async () => {
      try {
        const res = await fetch(url, { signal: controller.signal })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)

        // Derive filename from Content-Disposition if not supplied
        let resolvedName = displayName
        const cd = res.headers.get('content-disposition')
        if (!fileName && cd) {
          const m = cd.match(/filename\*?=(?:UTF-8'')?["']?([^"';\n]+)["']?/i)
          if (m) resolvedName = decodeURIComponent(m[1].trim())
        }

        const total = Number(res.headers.get('content-length')) || 0
        const reader = res.body?.getReader()
        if (!reader) throw new Error('无法读取响应体')

        const chunks: Uint8Array[] = []
        let received = 0

        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          chunks.push(value)
          received += value.length
          if (total > 0) {
            updateTask(id, { progress: Math.round(received / total * 100), fileName: resolvedName })
          } else {
            updateTask(id, { fileName: resolvedName })
          }
        }

        const blob = new Blob(chunks as BlobPart[])
        const blobUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = blobUrl
        a.download = resolvedName
        a.click()
        setTimeout(() => URL.revokeObjectURL(blobUrl), 10000)

        updateTask(id, { status: 'done', progress: 100, abortFn: undefined })
        setTimeout(() => setTasks(prev => prev.filter(t => t.id !== id)), 4000)
      } catch (err: unknown) {
        if ((err as Error)?.name === 'AbortError') {
          setTasks(prev => prev.filter(t => t.id !== id))
        } else {
          updateTask(id, { status: 'error', error: (err as Error)?.message || '下载失败', abortFn: undefined })
        }
      }
    })()
  }, [updateTask])

  return (
    <DownloadQueueContext.Provider value={{ tasks, enqueueDownload, dismissTask }}>
      {children}
    </DownloadQueueContext.Provider>
  )
}
