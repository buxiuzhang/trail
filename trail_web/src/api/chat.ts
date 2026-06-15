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

/** 最大重试次数 */
const MAX_RETRIES = 3

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
      onRetry?: () => void,
    ) => {
      let lastError: Error | null = null

      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
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
          // 成功，退出重试循环
          abortRef.current = null
          setIsPending(false)
          return
        } catch (err: any) {
          lastError = err
          // 用户主动停止，不重试
          if (err.name === 'AbortError') break
          // 还有重试机会：通知外层清理部分内容，退避后重试
          if (attempt < MAX_RETRIES - 1) {
            onRetry?.()
            await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
          }
        } finally {
          if (attempt >= MAX_RETRIES - 1) {
            setIsPending(false)
            abortRef.current = null
          }
        }
      }
      setIsPending(false)
      abortRef.current = null
      throw lastError
    },
    [],
  )

  return { send, abort, isPending }
}
