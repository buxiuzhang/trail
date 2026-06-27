import { useEffect } from 'react'
import { useChatContext } from '@/context/ChatContext'

interface AlertPayload {
  type: 'watch_alert' | 'todo_alert'
  taskId: number
  title: string
  idleDays: number
  taskPath: string
  message: string
}

const STORAGE_KEY = 'trail_watch_alerts'

function loadState(): { ignored: Record<number, string> } {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch { /* ignore parse errors */ }
  return { ignored: {} }
}

function saveState(s: { ignored: Record<number, string> }) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* storage blocked */ }
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function isSuppressed(id: number): boolean {
  const state = loadState()
  return state.ignored?.[id] === todayStr()
}

// ── 模块级单例：脱离 React 生命周期 ──
type AlertCallback = (content: string) => void
let es: EventSource | null = null
let callback: AlertCallback | null = null
const recentAlerts = new Map<number, number>()
const DEDUP_MS = 10_000

function handleEvent(event: MessageEvent) {
  let payload: AlertPayload
  try { payload = JSON.parse(event.data) } catch { return }
  if (isSuppressed(payload.taskId)) return

  const now = Date.now()
  const last = recentAlerts.get(payload.taskId) ?? 0
  if (now - last < DEDUP_MS) return
  recentAlerts.set(payload.taskId, now)

  callback?.(payload.message)
}

function startSse() {
  if (es && es.readyState !== EventSource.CLOSED) return
  es = new EventSource('/api/watch-alerts/stream')
  es.addEventListener('watch_alert', handleEvent)
  es.addEventListener('todo_alert', handleEvent)
  es.onerror = () => {
    es?.close()
    es = null
    setTimeout(startSse, 30_000)
  }
}
// ──────────────────────────────────────

export function useWatchAlerts() {
  const { pushAlert } = useChatContext()
  useEffect(() => {
    callback = pushAlert
    startSse()
    return () => { callback = null }
  }, [pushAlert])
}

export function ignoreAlert(taskId: number) {
  const state = loadState()
  if (!state.ignored) state.ignored = {}
  state.ignored[taskId] = todayStr()
  saveState(state)
}
