import { useState, useRef, useCallback } from 'react'
import { streamPost } from './client'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

interface ChatIn {
  messages: ChatMessage[]
}

interface ChatChunk {
  delta?: string
  done?: boolean
  error?: string
  // Tool use 事件
  tool_call?: { name: string; input: Record<string, unknown> }
  tool_result?: { name: string; ok: boolean }
  // 迭代次数信息
  iteration?: { current: number; max: number }
}

/** 流式对话 hook。返回 { send, abort, isPending }。 */
export function useChat() {
  const [isPending, setIsPending] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const abort = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setIsPending(false)
  }, [])

  const send = useCallback(
    async (
      body: ChatIn,
      onDelta: (piece: string) => void,
      onToolCall?: (name: string, input: Record<string, unknown>) => void,
      onToolResult?: (name: string, ok: boolean) => void,
      onIteration?: (current: number, max: number) => void,
    ) => {
      abortRef.current = new AbortController()
      setIsPending(true)
      try {
        for await (const chunk of streamPost<ChatChunk>(
          '/api/chat/tools/stream',
          body,
          abortRef.current.signal,
        )) {
          if (chunk.error) throw new Error(chunk.error)
          if (chunk.delta) onDelta(chunk.delta)
          if (chunk.tool_call && onToolCall) {
            onToolCall(chunk.tool_call.name, chunk.tool_call.input)
          }
          if (chunk.tool_result && onToolResult) {
            onToolResult(chunk.tool_result.name, chunk.tool_result.ok)
          }
          if (chunk.iteration && onIteration) {
            onIteration(chunk.iteration.current, chunk.iteration.max)
          }
        }
      } finally {
        setIsPending(false)
        abortRef.current = null
      }
    },
    [],
  )

  return { send, abort, isPending }
}
