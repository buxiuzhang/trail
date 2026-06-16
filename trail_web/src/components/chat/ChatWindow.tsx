import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react'
import { useChatContext, type Message } from '@/context/ChatContext'
import { useChat } from '@/api/chat'
import { useToastContext } from '@/context/ToastContext'
import { useLLMSettings } from '@/api/settings'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { MessageContent } from './MessageContent'
import CopyIcon from './copy.svg'
import CopiedIcon from './copied.svg'
import styles from './ChatWindow.module.css'

/** 最近消息条数上限（防 token 溢出） */
const MAX_HISTORY = 20
/** 打字机速度：每字毫秒数。 */
const TYPEWRITER_MS = 30

/** 工具名称中文映射 */
const TOOL_NAMES: Record<string, string> = {
  get_api_docs: '查询接口',
  call_api: '执行操作',
}

export function ChatWindow() {
  const {
    isOpen,
    messages,
    isLoading,
    closeChat,
    addMessage,
    updateLastMessage,
    setIsLoading,
  } = useChatContext()
  const { send, abort, isPending } = useChat()
  const { showToast } = useToastContext()
  const [input, setInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // 获取 LLM 设置（包含语音时长、模型名称）——只在窗口打开时才请求
  const { data: llmSettings } = useLLMSettings({ enabled: isOpen })
  const speechDuration = parseInt(llmSettings?.speech_duration || '10', 10)
  const modelName = llmSettings?.model || ''

  // 语音识别 - 使用回调方式实时更新输入框
  const {
    isListening,
    progress,
    start: startSpeech,
    stop: stopSpeech,
    isSupported: speechSupported,
    error: speechError,
  } = useSpeechRecognition((text) => {
    // 实时更新输入框（替换而非追加）
    setInput(text)
  }, speechDuration)
  // 流式写入时直接更新最后一条 assistant 消息的 content（不通过 addMessage 走 state path）
  const liveRef = useRef<HTMLDivElement>(null)
  // 待渲染的字符队列。流式期间 appendDelta 把整段推入，由打字机定时器逐字取空。
  const queueRef = useRef<string[]>([])
  const timerRef = useRef<number | null>(null)
  // 工具调用状态
  const [toolStatus, setToolStatus] = useState<{
    name: string
    input: Record<string, unknown> | null
    executing: boolean
  } | null>(null)
  // 迭代次数
  const [iterationInfo, setIterationInfo] = useState<{ current: number; max: number } | null>(null)

  // 启动打字机（如未启动）；取一个字符追加到 DOM。
  const pump = useCallback(() => {
    const q = queueRef.current
    if (q.length === 0) {
      if (timerRef.current != null) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      return
    }
    const ch = q.shift()!
    const el = liveRef.current
    if (el) el.textContent = (el.textContent ?? '') + ch
  }, [])

  // 启动打字机 interval（幂等：已有就不重复启动）
  const ensureTimer = useCallback(() => {
    if (timerRef.current == null) {
      timerRef.current = window.setInterval(pump, TYPEWRITER_MS)
    }
  }, [pump])

  // 停止打字机（流结束 / 卸载 / 中断）
  const stopTimer = useCallback(() => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    queueRef.current = []
  }, [])

  // 把一整段 delta 拆成字符推入队列（中文按字、英文按 grapheme 太复杂，
  // 这里 Array.from 走码点粒度已经够好——标点和 emoji 大多单码点）。
  const enqueueDelta = useCallback(
    (piece: string) => {
      if (!piece) return
      queueRef.current.push(...Array.from(piece))
      ensureTimer()
    },
    [ensureTimer],
  )

  // 把 liveRef DOM 节点里的 partial / 完整文本写回 messages state。
  // 打字机是逐字出，结束时 must 同步一次，否则下一轮发消息时
  // messages 里的 assistant 还是 ""，会被后端 422 拒掉。
  const syncLiveToState = useCallback(() => {
    // 先把队列里剩余的字符瞬间排空（流结束就一次全写）
    if (liveRef.current) {
      const rest = queueRef.current.join('')
      if (rest) liveRef.current.textContent = (liveRef.current.textContent ?? '') + rest
      queueRef.current = []
    }
    stopTimer()
    if (liveRef.current) updateLastMessage(liveRef.current.textContent ?? '')
  }, [stopTimer, updateLastMessage])

  // 自动滚到底部
  useEffect(() => {
    if (bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [messages])

  // 打开时聚焦输入框
  useEffect(() => {
    if (isOpen) {
      const id = setTimeout(() => inputRef.current?.focus(), 350)
      return () => clearTimeout(id)
    }
  }, [isOpen])

  // 快捷键处理
  useEffect(() => {
    if (!isOpen || !speechSupported) return

    const inputEl = inputRef.current
    if (!inputEl) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // 空格键：输入框为空时，开始录音
      if (e.code === 'Space' && !input && !isListening) {
        e.preventDefault()
        startSpeech()
        return
      }

      // 回车键：录音中时停止录音
      if (e.code === 'Enter' && isListening) {
        e.preventDefault()
        stopSpeech()
        return
      }
    }

    inputEl.addEventListener('keydown', handleKeyDown)
    return () => {
      inputEl.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen, speechSupported, input, isListening, startSpeech, stopSpeech])

  // 语音识别错误提示
  useEffect(() => {
    if (speechError) {
      showToast(speechError)
    }
  }, [speechError, showToast])

  // 卸载时取消进行中的流 + 停掉打字机
  useEffect(() => {
    return () => {
      abort()
      stopTimer()
    }
  }, [abort, stopTimer])

  if (!isOpen) return null

  async function handleSend(e?: FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || isPending) return

    setInput('')
    addMessage('user', text)
    // 先插入空 assistant 占位
    addMessage('assistant', '')
    setIsLoading(true)
    // 重置工具状态
    setToolStatus(null)
    setIterationInfo(null)

    const recent = messages.slice(-MAX_HISTORY)
    // 防御性：跳过空 content 的历史消息（占位 / 中断未恢复）。
    // 后端 ChatIn 校验 content min_length=1，空消息会触发 422。
    const payload = [
      ...recent
        .filter((m: Message) => m.content.trim().length > 0)
        .map((m: Message) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: text },
    ]

    try {
      await send(
        { messages: payload },
        enqueueDelta,
        // onToolCall
        (name, input) => {
          setToolStatus({ name, input, executing: true })
        },
        // onToolResult
        (name, ok) => {
          setToolStatus(prev => prev ? { ...prev, executing: false } : null)
        },
        // onIteration
        (current, max) => {
          setIterationInfo({ current, max })
        },
        // onRetry：重试前清空已渲染的 partial 内容
        () => {
          stopTimer()
          if (liveRef.current) liveRef.current.textContent = ''
        },
      )
    } catch (err: any) {
      const detail = err?.message ?? String(err)
      const status = (err as any)?.status
      if (
        detail.includes('503') ||
        detail.includes('未配置') ||
        detail.includes('未设置') ||
        status === 503
      ) {
        showToast('LLM 未配置，请在设置中配置 API Key')
      } else if (err.name === 'AbortError') {
        // 用户主动停止，不弹 toast
      } else if (
        detail.includes('429') ||
        detail.includes('RateLimit') ||
        detail.includes('rate_limit') ||
        detail.includes('限流') ||
        detail.includes('Too Many')
      ) {
        showToast('请求过快或套餐限额，请稍后再试')
      } else if (detail.includes('502') || status === 502) {
        showToast('LLM 服务暂时异常，请稍后再试')
      } else {
        showToast('LLM 服务暂时无法响应，已重试 3 次仍未成功，请稍后再试')
      }
    } finally {
      // 流结束（正常 / 异常 / 中止）时，把队列里剩余字符瞬间排空 + 同步回 state
      syncLiveToState()
      setIsLoading(false)
      setToolStatus(null)
      setIterationInfo(null)
    }
  }

  // 流是否正在进行（用于 liveRef 绑到 DOM 节点 + 渲染 typing dots）
  const lastMsg = messages[messages.length - 1]
  // isStreaming: assistant 正在流式输出（内容会逐字写入 liveRef）
  // 内容为空时显示 typing dots，同时 liveRef 也要绑定
  const isStreaming = isPending && lastMsg?.role === 'assistant'
  // showTyping: 内容为空时显示跳动动画
  const showTyping = isStreaming && lastMsg?.content === ''

  return (
    <div className={styles.window} role="dialog" aria-label="工作对话">
      {/* 头部 */}
      <div className={styles.header}>
        <span className={styles.title}>工作对话</span>
        <button className={styles.close} onClick={closeChat} aria-label="关闭对话">
          ×
        </button>
      </div>

      {/* 消息列表 */}
      <div className={styles.body} ref={bodyRef}>
        {messages.map((msg, i) => {
          const isLast = i === messages.length - 1
          return (
            <ChatMessageRow
              key={msg.id}
              message={msg}
              modelName={modelName}
              liveRef={isLast && isStreaming ? liveRef : undefined}
              isStreaming={isLast && isStreaming}
              showTyping={isLast && showTyping && !toolStatus}
            />
          )
        })}
        {/* 工具调用状态 */}
        {toolStatus && (
          <div className={styles.toolStatus}>
            <span className={styles.toolIcon}>⚙</span>
            <span className={styles.toolText}>
              {TOOL_NAMES[toolStatus.name] || toolStatus.name}
              {toolStatus.executing ? '...' : ' ✓'}
            </span>
            {iterationInfo && (
              <span className={styles.iteration}>
                ({iterationInfo.current}/{iterationInfo.max})
              </span>
            )}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <form className={styles.inputRow} onSubmit={handleSend}>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="询问工作进展…"
          disabled={false}
          autoComplete="off"
        />
        {/* 语音输入按钮 */}
        {speechSupported && (
          <div className={styles.micWrapper}>
            <button
              type="button"
              className={isListening ? styles.micBtnActive : styles.micBtn}
              onClick={(e) => {
                e.preventDefault()
                if (isListening) {
                  stopSpeech()
                } else {
                  startSpeech()
                }
              }}
              title={isListening ? '停止录音' : '语音输入'}
              aria-label={isListening ? '停止录音' : '开始语音输入'}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
            {/* 进度条（在按钮外，不受闪烁影响） */}
            {isListening && (
              <div className={styles.micProgress}>
                <div
                  className={styles.micProgressFill}
                  style={{ width: `${Math.round(progress * 100)}%` }}
                />
              </div>
            )}
          </div>
        )}
        {isPending ? (
          <button
            className={styles.sendBtn}
            type="button"
            onClick={abort}
          >
            停止
          </button>
        ) : (
          <button
            className={styles.sendBtn}
            type="submit"
            disabled={!input.trim()}
          >
            发送
          </button>
        )}
      </form>
    </div>
  )
}

/** 单条消息 */
function ChatMessageRow({
  message,
  modelName,
  liveRef,
  isStreaming,
  showTyping,
}: {
  message: Message
  modelName?: string
  liveRef?: React.RefObject<HTMLDivElement | null>
  isStreaming?: boolean
  showTyping?: boolean
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className={`${styles.msg} ${isUser ? styles.msgUser : styles.msgAssistant}`}>
      <div className={styles.msgBubble}>
        {isUser ? (
          <span className={styles.msgRole}>我</span>
        ) : (
          <div className={styles.msgRoleRow}>
            <span className={styles.msgRole}>Trail</span>
            {modelName && <span className={styles.modelName}>{modelName}</span>}
          </div>
        )}
        {isStreaming && liveRef ? (
          // 流式：纯文本 + 打字机
          <div className={styles.msgContent} ref={liveRef} />
        ) : (
          // 完成：使用 MessageContent 组件解析链接
          <MessageContent content={message.content} />
        )}
        {/* 等待中：右下角显示 typing dots */}
        {showTyping && (
          <div className={styles.typingIndicator}>
            <span className={styles.typingDotSmall} />
            <span className={styles.typingDotSmall} />
            <span className={styles.typingDotSmall} />
          </div>
        )}
        {/* 助手消息完成后显示复制按钮 */}
        {!isUser && !isStreaming && !showTyping && (
          <button
            className={styles.copyBtn}
            onClick={handleCopy}
            title={copied ? '已复制' : '复制'}
            aria-label="复制内容"
          >
            {copied ? (
              <img src={CopiedIcon} alt="" className={styles.copyIcon} />
            ) : (
              <img src={CopyIcon} alt="" className={styles.copyIcon} />
            )}
          </button>
        )}
      </div>
    </div>
  )
}
