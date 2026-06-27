import { useState, useRef, useEffect, useCallback, type FormEvent } from 'react'
import { useChatContext, type Message } from '@/context/ChatContext'
import { useChat } from '@/api/chat'
import { usePolishDialog } from '@/api/polishDialog'
import { useToastContext } from '@/context/ToastContext'
import { useLLMSettings } from '@/api/settings'
import { useSpeechRecognition } from '@/hooks/useSpeechRecognition'
import { ignoreAlert } from '@/hooks/useWatchAlerts'
import { MessageContent } from './MessageContent'
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer'
import CopyIcon from './copy.svg'
import CopiedIcon from './copied.svg'
import CloseCircleIcon from './close-circle.svg'
import FullscreenIcon from '@/icons/fullscreen.svg'
import styles from './ChatWindow.module.css'

const MAX_HISTORY = 20
const TYPEWRITER_MS = 30

const TOOL_NAMES: Record<string, string> = {
  get_api_docs: '查询接口',
  call_api: '执行操作',
}

const POLISH_TYPE_LABEL: Record<string, string> = {
  log:       '日报润色',
  todo:      '待办润色',
  task_desc: '任务描述润色',
}

/** 从文本中提取【建议版本】后的代码块内容 */
function extractSuggestion(text: string): string | null {
  const marker = '【建议版本】'
  const idx = text.indexOf(marker)
  if (idx === -1) return null
  const after = text.slice(idx + marker.length)
  const codeMatch = after.match(/```[\s\S]*?\n([\s\S]*?)```/)
  if (codeMatch) return codeMatch[1].trim()
  return after.trim() || null
}

function splitAssistantContent(text: string): { body: string; suggestion: string | null } {
  const marker = '【建议版本】'
  const idx = text.indexOf(marker)
  if (idx === -1) return { body: text, suggestion: null }
  return { body: text.slice(0, idx).trim(), suggestion: extractSuggestion(text) }
}

export function ChatWindow() {
  const {
    isOpen, isExpanded, polishConfig,
    messages, closeChat, addMessage, updateLastMessage,
    setIsLoading, clearAlerts, clearMessages,
    expandChat, collapseChat,
  } = useChatContext()
  const { send: sendChat, abort: abortChat, isPending: chatPending } = useChat()
  const { send: sendPolish, abort: abortPolish, isPending: polishPending } = usePolishDialog()
  const { showToast } = useToastContext()
  const [input, setInput] = useState('')
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: llmSettings } = useLLMSettings({ enabled: isOpen })
  const speechDuration = parseInt(llmSettings?.speech_duration || '10', 10)
  const modelName = llmSettings?.model || ''

  // 润色模式：首轮自动发送
  const sentInitial = useRef(false)
  const isPending = polishConfig ? polishPending : chatPending

  const handleAction = useCallback((action: string) => {
    const parts = action.split(':')
    const type = parts[0]
    const id = parseInt(parts[1])
    if (isNaN(id)) return
    if (type === 'ignore') { ignoreAlert(id); showToast('今日不再提醒') }
  }, [showToast])

  useEffect(() => { if (isOpen) clearAlerts() }, [isOpen, clearAlerts])

  const { isListening, progress, start: startSpeech, stop: stopSpeech,
    isSupported: speechSupported, error: speechError } = useSpeechRecognition(
    (text) => setInput(text), speechDuration
  )

  const liveRef = useRef<HTMLDivElement>(null)
  const queueRef = useRef<string[]>([])
  const timerRef = useRef<number | null>(null)
  const [toolStatus, setToolStatus] = useState<{ name: string; input: Record<string, unknown> | null; executing: boolean } | null>(null)
  const [iterationInfo, setIterationInfo] = useState<{ current: number; max: number } | null>(null)

  const scrollToBottom = useCallback(() => {
    if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, scrollToBottom])
  useEffect(() => {
    if (isOpen) { const id = setTimeout(scrollToBottom, 50); return () => clearTimeout(id) }
  }, [isOpen, scrollToBottom])

  const pump = useCallback(() => {
    const q = queueRef.current
    if (q.length === 0) { if (timerRef.current != null) { clearInterval(timerRef.current); timerRef.current = null } return }
    const ch = q.shift()!
    const el = liveRef.current
    if (el) el.textContent = (el.textContent ?? '') + ch
    scrollToBottom()
  }, [scrollToBottom])

  const ensureTimer = useCallback(() => {
    if (timerRef.current == null) timerRef.current = window.setInterval(pump, TYPEWRITER_MS)
  }, [pump])

  const stopTimer = useCallback(() => {
    if (timerRef.current != null) { clearInterval(timerRef.current); timerRef.current = null }
    queueRef.current = []
  }, [])

  const enqueueDelta = useCallback((piece: string) => {
    if (!piece) return
    queueRef.current.push(...Array.from(piece))
    ensureTimer()
  }, [ensureTimer])

  const syncLiveToState = useCallback(() => {
    if (liveRef.current) {
      const rest = queueRef.current.join('')
      if (rest) liveRef.current.textContent = (liveRef.current.textContent ?? '') + rest
      queueRef.current = []
    }
    stopTimer()
    if (liveRef.current) updateLastMessage(liveRef.current.textContent ?? '')
  }, [stopTimer, updateLastMessage])

  useEffect(() => {
    if (isOpen) { const id = setTimeout(() => inputRef.current?.focus(), 350); return () => clearTimeout(id) }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen || !speechSupported) return
    const inputEl = inputRef.current
    if (!inputEl) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !input && !isListening) { e.preventDefault(); startSpeech(); return }
      if (e.code === 'Enter' && isListening) { e.preventDefault(); stopSpeech(); return }
    }
    inputEl.addEventListener('keydown', handleKeyDown)
    return () => inputEl.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, speechSupported, input, isListening, startSpeech, stopSpeech])

  useEffect(() => { if (speechError) showToast(speechError) }, [speechError, showToast])
  useEffect(() => () => { abortChat(); abortPolish(); stopTimer() }, [abortChat, abortPolish, stopTimer])
  useEffect(() => {
    if (isExpanded) {
      document.body.style.overflow = 'hidden'
      return () => { document.body.style.overflow = '' }
    }
  }, [isExpanded])

  // 润色模式首轮自动发送
  useEffect(() => {
    if (!polishConfig || sentInitial.current) return
    sentInitial.current = true
    handleSendPolish(polishConfig.initialContent, polishConfig.contentForLLM)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [polishConfig])

  // polishConfig 变化时重置
  useEffect(() => { sentInitial.current = false }, [polishConfig])

  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null)

  if (!isOpen) return null

  // ——— 润色模式发送 ———
  async function handleSendPolish(text: string, llmText?: string) {
    if (!polishConfig) return
    addMessage('user', text)
    addMessage('assistant', '')
    setIsLoading(true)

    const historyMsgs = messages
      .filter(m => m.content.trim())
      .map(m => ({ role: m.role, content: m.content }))
    historyMsgs.push({ role: 'user', content: llmText ?? text })

    let accum = ''
    try {
      await sendPolish(
        {
          type: polishConfig.type,
          content: polishConfig.contentForLLM ?? polishConfig.initialContent,
          task_id: polishConfig.taskId,
          messages: historyMsgs,
        },
        (delta) => {
          accum += delta
          if (liveRef.current) liveRef.current.textContent = accum
          scrollToBottom()
        },
      )
    } catch (err: unknown) {
      const msg = (err as Error).name === 'AbortError' ? null : (err as Error).message
      if (msg) showToast(msg.includes('未配置') ? 'LLM 未配置，请在设置中配置 API Key' : '请求失败：' + msg)
    } finally {
      syncLiveToState()
      setIsLoading(false)
    }
  }

  // ——— 普通 Chat 发送 ———
  async function handleSend(e?: FormEvent) {
    e?.preventDefault()
    const text = input.trim()
    if (!text || isPending) return
    setInput('')

    if (polishConfig) {
      await handleSendPolish(text)
      return
    }

    addMessage('user', text)
    addMessage('assistant', '')
    setIsLoading(true)
    setToolStatus(null)
    setIterationInfo(null)

    const recent = messages.slice(-MAX_HISTORY)
    const payload = [
      ...recent.filter((m: Message) => m.content.trim().length > 0).map((m: Message) => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: text },
    ]

    try {
      await sendChat(
        { messages: payload },
        enqueueDelta,
        (name, input) => setToolStatus({ name, input, executing: true }),
        (_name, _ok) => setToolStatus(prev => prev ? { ...prev, executing: false } : null),
        (current, max) => setIterationInfo({ current, max }),
        () => { stopTimer(); if (liveRef.current) liveRef.current.textContent = '' },
      )
    } catch (err: unknown) {
      const detail = (err as Error)?.message ?? String(err)
      const status = (err as { status?: number })?.status
      if (detail.includes('503') || detail.includes('未配置') || status === 503) showToast('LLM 未配置，请在设置中配置 API Key')
      else if ((err as Error).name === 'AbortError') { /* 用户停止 */ }
      else if (detail.includes('429') || detail.includes('RateLimit')) showToast('请求过快或套餐限额，请稍后再试')
      else if (detail.includes('502') || status === 502) showToast('LLM 服务暂时异常，请稍后再试')
      else showToast('LLM 服务暂时无法响应，已重试 3 次仍未成功，请稍后再试')
    } finally {
      syncLiveToState()
      setIsLoading(false)
      setToolStatus(null)
      setIterationInfo(null)
    }
  }

  const lastMsg = messages[messages.length - 1]
  const isStreaming = isPending && lastMsg?.role === 'assistant'
  const showTyping = isStreaming && lastMsg?.content === ''

  const headerTitle = polishConfig ? POLISH_TYPE_LABEL[polishConfig.type] ?? '润色对话' : '工作对话'

  const windowContent = (
    <div className={isExpanded ? styles.windowExpanded : styles.window} role="dialog" aria-label={headerTitle}>
      {/* 顶部虚线 */}
      {!isExpanded && <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'repeating-linear-gradient(to right, var(--rule) 0, var(--rule) 2px, transparent 2px, transparent 5px)', opacity: 0.45 }} />}

      {/* 头部 */}
      <div className={styles.header}>
        <span className={styles.title}>{headerTitle}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* Expand / Collapse 按钮 */}
          <button
            className={styles.expandBtn}
            onClick={isExpanded ? collapseChat : expandChat}
            aria-label={isExpanded ? '收缩' : '展开'}
            title={isExpanded ? '收缩' : '展开'}
          >
            <img src={FullscreenIcon} width={16} height={16} alt="" />
          </button>
          <button className={styles.close} onClick={closeChat} aria-label="关闭对话">
            <img src={CloseCircleIcon} width={18} height={18} alt="" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* 消息列表 */}
      <div
        className={styles.body}
        ref={bodyRef}
        onContextMenu={(e) => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY }) }}
        onClick={() => setCtxMenu(null)}
      >
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
              onAction={handleAction}
              isPolishMode={!!polishConfig}
              polishTodos={polishConfig?.todos}
              polishTasks={polishConfig?.tasks}
              onAdopt={polishConfig && isLast ? (suggestion) => { polishConfig.onAdopt(suggestion); closeChat() } : undefined}
            />
          )
        })}
        {toolStatus && (
          <div className={styles.toolStatus}>
            <span className={styles.toolIcon}>⚙</span>
            <span className={styles.toolText}>{TOOL_NAMES[toolStatus.name] || toolStatus.name}{toolStatus.executing ? '...' : ' ✓'}</span>
            {iterationInfo && <span className={styles.iteration}>({iterationInfo.current}/{iterationInfo.max})</span>}
          </div>
        )}
      </div>

      {/* 右键菜单 */}
      {ctxMenu && (
        <ul className={styles.ctxMenu} style={{ left: ctxMenu.x, top: ctxMenu.y }} onMouseLeave={() => setCtxMenu(null)}>
          <li className={styles.ctxItem} onMouseDown={(e) => { e.preventDefault(); clearMessages(); setCtxMenu(null) }}>清空聊天记录</li>
        </ul>
      )}

      {/* 输入区 */}
      <form className={styles.inputRow} onSubmit={handleSend}>
        <input
          ref={inputRef}
          className={styles.input}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={polishConfig ? '回复 AI 的问题，或输入调整要求…' : '询问工作进展…'}
          autoComplete="off"
        />
        {speechSupported && !polishConfig && (
          <div className={styles.micWrapper}>
            <button type="button" className={isListening ? styles.micBtnActive : styles.micBtn}
              onClick={(e) => { e.preventDefault(); isListening ? stopSpeech() : startSpeech() }}
              title={isListening ? '停止录音' : '语音输入'} aria-label={isListening ? '停止录音' : '开始语音输入'}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
                <line x1="12" y1="19" x2="12" y2="23"/>
                <line x1="8" y1="23" x2="16" y2="23"/>
              </svg>
            </button>
            {isListening && (
              <div className={styles.micProgress}>
                <div className={styles.micProgressFill} style={{ width: `${Math.round(progress * 100)}%` }} />
              </div>
            )}
          </div>
        )}
        {isPending ? (
          <button className={styles.sendBtn} type="button" onClick={polishConfig ? abortPolish : abortChat}>停止</button>
        ) : (
          <button className={styles.sendBtn} type="submit" disabled={!input.trim()}>发送</button>
        )}
      </form>
    </div>
  )

  if (isExpanded) {
    return (
      <div className={styles.overlay} onClick={(e) => { if (e.target === e.currentTarget) collapseChat() }}>
        {windowContent}
      </div>
    )
  }
  return windowContent
}

/** 单条消息 */
function ChatMessageRow({
  message, modelName, liveRef, isStreaming, showTyping, onAction,
  isPolishMode, polishTodos, polishTasks, onAdopt,
}: {
  message: Message
  modelName?: string
  liveRef?: React.RefObject<HTMLDivElement | null>
  isStreaming?: boolean
  showTyping?: boolean
  onAction?: (action: string) => void
  isPolishMode?: boolean
  polishTodos?: { id: number; title: string }[]
  polishTasks?: { id: number; title: string }[]
  onAdopt?: (suggestion: string) => void
}) {
  const isUser = message.role === 'user'
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // 润色模式：分离正文和建议版本
  const { body, suggestion } = isPolishMode && !isUser
    ? splitAssistantContent(message.content)
    : { body: message.content, suggestion: null }

  return (
    <div className={`${styles.msg} ${isUser ? styles.msgUser : styles.msgAssistant}`}>
      <div className={styles.msgBubble}>
        {isUser ? (
          <span className={styles.msgRole}>我</span>
        ) : (
          <div className={styles.msgRoleRow}>
            <span className={styles.msgRole}>Trail</span>
            {modelName && !isPolishMode && <span className={styles.modelName}>{modelName}</span>}
          </div>
        )}

        {isStreaming && liveRef ? (
          <>
            <div className={styles.msgContent} ref={liveRef} />
            {showTyping && (
              <div className={styles.typingIndicator}>
                <span className={styles.typingDotSmall} /><span className={styles.typingDotSmall} /><span className={styles.typingDotSmall} />
              </div>
            )}
          </>
        ) : isPolishMode && !isUser ? (
          <>
            {body && (
              <MarkdownRenderer
                text={body}
                todos={polishTodos}
                tasks={polishTasks}
                className={styles.msgContent}
              />
            )}
            {suggestion && onAdopt && (
              <div className={styles.suggestion}>
                <div className={styles.suggestionHeader}>
                  <span className={styles.suggestionLabel}>建议版本</span>
                  <button className={styles.adoptBtn} onClick={() => onAdopt(suggestion)}>采用</button>
                </div>
                <MarkdownRenderer
                  text={suggestion}
                  todos={polishTodos}
                  tasks={polishTasks}
                  className={styles.suggestionContent}
                />
              </div>
            )}
          </>
        ) : (
          <MessageContent content={message.content} onAction={onAction} />
        )}

        {!isUser && !isStreaming && !showTyping && (
          <button className={styles.copyBtn} onClick={handleCopy} title={copied ? '已复制' : '复制'} aria-label="复制内容">
            {copied ? <img src={CopiedIcon} alt="" className={styles.copyIcon} /> : <img src={CopyIcon} alt="" className={styles.copyIcon} />}
          </button>
        )}
      </div>
    </div>
  )
}
