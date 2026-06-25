import { createContext, useContext, useCallback, useState, useRef, useEffect, type ReactNode } from 'react'

function getApiBase(): string {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return 'http://localhost:8765'
  }
  return ''
}

export interface UploadTask {
  id: string
  fileName: string
  progress: number        // 0-100
  status: 'uploading' | 'done' | 'error'
  url?: string
  error?: string
  retryFn?: () => void
}

interface UploadQueueContextValue {
  tasks: UploadTask[]
  uploadFile: (file: File, onDone: (url: string, name: string, mime: string, id: number) => void) => void
  dismissTask: (id: string) => void
}

const UploadQueueContext = createContext<UploadQueueContextValue | null>(null)

export function useUploadQueue() {
  const ctx = useContext(UploadQueueContext)
  if (!ctx) throw new Error('useUploadQueue 必须在 UploadQueueProvider 内使用')
  return ctx
}

export function UploadQueueProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<UploadTask[]>([])
  const inFlightRef = useRef(new Set<string>())

  const updateTask = useCallback((id: string, patch: Partial<UploadTask>) => {
    setTasks(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t))
  }, [])

  const dismissTask = useCallback((id: string) => {
    setTasks(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    const hasUploading = tasks.some(t => t.status === 'uploading')
    if (!hasUploading) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = '有文件正在上传，离开后上传将中断。'
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [tasks])

  const uploadFile = useCallback((file: File, onDone: (url: string, name: string, mime: string, id: number) => void) => {
    const dedupeKey = `${file.name}__${file.size}`
    if (inFlightRef.current.has(dedupeKey)) return

    const id = crypto.randomUUID()
    const task: UploadTask = { id, fileName: file.name, progress: 0, status: 'uploading' }
    setTasks(prev => [...prev, task])
    inFlightRef.current.add(dedupeKey)

    function doUpload() {
      const xhr = new XMLHttpRequest()
      const form = new FormData()
      form.append('file', file)

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          updateTask(id, { progress: Math.round(e.loaded / e.total * 100) })
        }
      }

      xhr.onload = () => {
        inFlightRef.current.delete(dedupeKey)
        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const res = JSON.parse(xhr.responseText)
            const url = res.url || `/api/attachments/${res.id}`
            updateTask(id, { status: 'done', progress: 100, url })
            onDone(url, res.original_name || file.name, res.mime || file.type, res.id as number)
            setTimeout(() => setTasks(prev => prev.filter(t => t.id !== id)), 3000)
          } catch {
            updateTask(id, { status: 'error', error: '解析响应失败' })
          }
        } else {
          updateTask(id, { status: 'error', error: `HTTP ${xhr.status}`, retryFn: doUpload })
        }
      }

      xhr.onerror = () => {
        inFlightRef.current.delete(dedupeKey)
        updateTask(id, { status: 'error', error: '网络错误', retryFn: doUpload })
      }

      xhr.open('POST', getApiBase() + '/api/attachments')
      xhr.send(form)
      updateTask(id, { status: 'uploading', progress: 0, error: undefined, retryFn: undefined })
    }

    doUpload()
  }, [updateTask])

  return (
    <UploadQueueContext.Provider value={{ tasks, uploadFile, dismissTask }}>
      {children}
    </UploadQueueContext.Provider>
  )
}
