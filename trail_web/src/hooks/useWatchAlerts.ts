import { useEffect } from 'react'
import { useChatContext } from '@/context/ChatContext'

interface WatchAlertPayload {
  type: 'watch_alert'
  taskId: number
  title: string
  idleDays: number
  taskPath: string
}

const STORAGE_KEY = 'trail_watch_alerts'

function loadState(): { ignored: Record<number, string> } {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') } catch {}
  return { ignored: {} }
}

function saveState(s: { ignored: Record<number, string> }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

function todayStr() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function isSuppressed(taskId: number): boolean {
  const state = loadState()
  return state.ignored?.[taskId] === todayStr()
}

function buildAlertMessage(p: WatchAlertPayload): string {
  return `**${p.title}** 特别关注预警：\n\n该任务已 **${p.idleDays} 天**未记录日志，请关注进展。\n\n[查看任务详情](${p.taskPath})　　[今日忽略](action:ignore:${p.taskId})`
}

// ── 模块级单例：脱离 React 生命周期 ──
type AlertCallback = (content: string) => void
let es: EventSource | null = null
let callback: AlertCallback | null = null
const recentAlerts = new Map<number, number>() // taskId → last shown timestamp
const DEDUP_MS = 10_000

function startSse() {
  if (es && es.readyState !== EventSource.CLOSED) return
  es = new EventSource('/api/watch-alerts/stream')

  es.addEventListener('watch_alert', (event: MessageEvent) => {
    let payload: WatchAlertPayload
    try { payload = JSON.parse(event.data) } catch { return }
    if (isSuppressed(payload.taskId)) return

    const now = Date.now()
    const last = recentAlerts.get(payload.taskId) ?? 0
    if (now - last < DEDUP_MS) return
    recentAlerts.set(payload.taskId, now)

    callback?.(buildAlertMessage(payload))
  })

  es.onerror = () => {
    es?.close()
    es = null
    // 浏览器会自动重连 EventSource，这里 30s 后手动重建避免频繁重试
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
