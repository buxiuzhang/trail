import { useState, useRef, useCallback } from 'react'
import { streamPost } from './client'

interface PolishChunk {
  delta?: string
  done?: boolean
  error?: string
}

interface PolishDialogIn {
  type: 'log' | 'todo' | 'task_desc'
  content: string
  task_id?: number
  messages: { role: 'user' | 'assistant'; content: string }[]
}

export function usePolishDialog() {
  const [isPending, setIsPending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsPending(false)
  }, [])

  const send = useCallback(
    async (body: PolishDialogIn, onDelta: (piece: string) => void) => {
      abortRef.current = new AbortController()
      setIsPending(true)
      try {
        for await (const chunk of streamPost<PolishChunk>(
          '/api/chat/polish/stream',
          body,
          abortRef.current.signal,
        )) {
          if (chunk.error) throw new Error(chunk.error)
          if (chunk.delta) onDelta(chunk.delta)
        }
      } finally {
        abortRef.current = null
        setIsPending(false)
      }
    },
    [],
  )

  return { send, abort, isPending }
}
