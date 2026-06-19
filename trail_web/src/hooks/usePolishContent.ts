import { useState } from 'react'
import { usePolish } from '@/api/llm'
import { useToastContext } from '@/context/ToastContext'

interface PolishArgs {
  task_id?: number
  type?: 'log' | 'todo' | 'task_desc'
}

/**
 * 封装润色逻辑：调用 LLM 润色 + 撤销润色 + 错误提示。
 * 使用方只需调 handlePolish(content, setContent)，
 * 通过 isPolished/isPending 控制按钮状态。
 */
export function usePolishContent(args: PolishArgs = {}) {
  const [polishedFrom, setPolishedFrom] = useState<string | null>(null)
  const mutation = usePolish()
  const { showToast } = useToastContext()

  async function handlePolish(content: string, setContent: (v: string) => void) {
    const raw = content.trim()
    if (!raw) { showToast('先写点内容再润色'); return }
    // 撤销润色
    if (polishedFrom !== null) {
      setContent(polishedFrom)
      setPolishedFrom(null)
      return
    }
    try {
      const result = await mutation.mutateAsync({ content: raw, ...args })
      setPolishedFrom(raw)
      setContent(result.polished)
    } catch (err: any) {
      const hint = err.status === 503 ? '（未配置 LLM）'
                 : err.status === 502 ? '（调用失败）' : ''
      showToast('润色失败：' + err.message + hint)
    }
  }

  function reset() {
    setPolishedFrom(null)
  }

  return {
    handlePolish,
    reset,
    isPolished: polishedFrom !== null,
    isPending: mutation.isPending,
  }
}
