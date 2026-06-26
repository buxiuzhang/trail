import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useLogsByDate } from '@/api/insights'
import { useNavigate, useLocation } from 'react-router-dom'

function localToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
import { useTasks, useTask } from '@/api/tasks'
import { useTodos } from '@/api/todos'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import { useModalContext } from '@/context/ModalContext'
import { useWorkbench } from '@/context/WorkbenchContext'
import { LogCompose } from '@/components/detail/LogCompose'
import { BatchLogPanel } from '@/components/detail/BatchLogPanel'
import { TaskSelectorRow } from '@/components/shared/TaskSelectorRow'
import { TODAY } from '@/constants'
import type { TaskOut } from '@/types'
import type { LogOut } from '@/types/log'
import { api } from '@/api/client'
import { useUpdateLog, useCreateLog } from '@/api/logs'
import ExportIcon from '@/icons/export.svg'
import EditIcon from '@/icons/edit.svg'
import DeleteIcon from '@/icons/delete.svg'
import styles from './QuickLogPage.module.css'

// ── 类型 ──────────────────────────────────────────────────────────
interface DraftLog {
  localId: number
  taskId: number
  taskTitle: string
  logDate: string
  phase: string
  hours: number
  content: string
  todo_ids: number[]
  task_ids: number[]
}

let localIdSeq = 1

// ── 占位 task ────────────────────────────────────────────────────
function makePlaceholderTask(): TaskOut {
  return {
    id: 0, title: '', alias: null, description: null,
    start_date: TODAY, processing_date: null, end_date: null,
    status: '进行中', nature: '临时', summary: null,
    maintenance_summary: null, tags: [], original_title: null,
    source: '', pinned_at: null, watched_at: null,
    created_at: TODAY, updated_at: TODAY,
    contacts: [], last_log_date: null, days_idle: 0,
    log_count: 0, log_main_count: 0, total_hours: 0,
    todo_active_count: 0, todo_completed_count: 0, todo_abandoned_count: 0,
  }
}

// ── 浮动填报卡片 ─────────────────────────────────────────────────
function FloatingCard({
  onClose, editingLog, defaultDate,
}: {
  onClose: () => void
  editingLog?: any
  defaultDate?: string
}) {
  const isEdit = !!editingLog
  const { data: tasks = [] } = useTasks()
  const [taskId, setTaskId] = useState<number | null>(isEdit ? editingLog.task_id : null)
  const { data: selectedTask } = useTask(taskId ?? 0)
  const { data: todos = [] } = useTodos(taskId ?? 0)
  const updateLog = useUpdateLog(taskId ?? 0)
  const createLog = useCreateLog(taskId ?? 0)
  const { showToast } = useToastContext()
  const qc = useQueryClient()

  const activeTasks = tasks.filter(t => t.status === '进行中')
  const taskForCompose: TaskOut = selectedTask ?? makePlaceholderTask()

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.floatCard}>
        <TaskSelectorRow
          tasks={activeTasks}
          taskId={taskId}
          onChange={(id) => setTaskId(id)}
        />

        <LogCompose
            key={taskId ?? 'none'}
            task={taskForCompose}
            todos={todos}
            tasks={tasks}
            editing={isEdit ? (editingLog as LogOut) : null}
            saveDisabled={!taskId}
            saveLabel={isEdit ? '保存' : undefined}
            defaultLogDate={defaultDate}
            confirmBeforeSave={!isEdit}
            onSave={async (data) => {
              if (!taskId) return
              if (isEdit) {
                await updateLog.mutateAsync({ logId: editingLog.id, data })
                qc.invalidateQueries({ queryKey: ['logs', 'by-date', TODAY] })
                showToast('日志已更新')
                onClose()
              } else {
                await createLog.mutateAsync(data)
                qc.invalidateQueries({ queryKey: ['logs', 'by-date', TODAY] })
                showToast('日志已落档')
                onClose()
              }
            }}
            onCancel={onClose}
          />
      </div>
    </>
  )
}

// ── 日志行（支持内容展开）────────────────────────────────────────
function resolveMentions(content: string, relatedTodos?: { id?: number; title: string }[]): string {
  if (!relatedTodos?.length) return content
  const map = new Map(relatedTodos.map(t => [t.id, t.title]))
  return content.replace(/@todo:(\d+)/g, (_match, idStr) => {
    const title = map.get(Number(idStr))
    return title ? `「${title}」` : `@todo:${idStr}`
  })
}

function LogRow({ log, idx, onEdit }: { log: any; idx: number; onEdit: (log: any) => void }) {
  const confirm = useConfirm()
  const { showToast } = useToastContext()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const content: string = log.polished_content || log.content || ''
  const displayContent = resolveMentions(content, log.related_todos)

  async function handleDelete() {
    const ok = await confirm({
      level: 'dangerous',
      title: `删除此条日志？`,
      body: <p>「{log.task_title}」的日志将被软删除，可在任务详情中恢复。</p>,
      confirmLabel: '删除',
    })
    if (!ok) return
    try {
      await api.del(`/api/tasks/${log.task_id}/logs/${log.id}`)
      qc.invalidateQueries({ queryKey: ['logs', 'by-date', TODAY] })
      showToast('已删除')
    } catch {
      showToast('删除失败', 'error')
    }
  }

  return (
    <tr className={styles.tr}>
      <td className={styles.tdNo}>{idx + 1}</td>
      <td className={styles.td} style={{ whiteSpace: 'nowrap' }}>
        <button
          type="button"
          className={styles.taskLink}
          onClick={() => navigate(`/task/${log.task_id}`)}
        >
          {log.task_title}
        </button>
      </td>
      <td className={styles.td} style={{ whiteSpace: 'nowrap' }}>
        <span
          className={styles.logPhase}
          style={{ color: log.phase === 'main' ? 'var(--green)' : 'var(--gold)' }}
        >
          {log.phase === 'main' ? '主体' : '维护'}
        </span>
      </td>
      <td className={styles.td} style={{ whiteSpace: 'nowrap', minWidth: 60 }}>
        <span className={styles.logHours}>{log.hours}h</span>
      </td>
      <td className={styles.td} style={{ whiteSpace: 'nowrap', textAlign: 'center' }}>
        <span className={styles.logAttach}>
          {log.attachment_count > 0 ? log.attachment_count : '—'}
        </span>
      </td>
      <td className={styles.td} style={{ maxWidth: 0, overflow: 'hidden' }}>
        <span className={styles.logContent}>
          {displayContent}
        </span>
      </td>
      <td className={styles.tdActions}>
        <button type="button" className={styles.iconBtn} title="编辑" onClick={() => onEdit(log)}>
          <img src={EditIcon} width={14} height={14} alt="编辑" />
        </button>
        <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} title="删除" onClick={handleDelete}>
          <img src={DeleteIcon} width={14} height={14} alt="删除" />
        </button>
      </td>
    </tr>
  )
}

// ── 导出弹窗内容 ──────────────────────────────────────────────────
const FORMATS = [
  { value: 'markdown', label: 'Markdown', available: true },
  { value: 'excel',    label: 'Excel',    available: false },
  { value: 'word',     label: 'Word',     available: false },
  { value: 'pdf',      label: 'PDF',      available: false },
]

const PRESETS = [
  { label: '今天', getRange: () => ({ start: TODAY, end: TODAY }) },
  {
    label: '本周',
    getRange: () => {
      const d = new Date()
      const day = d.getDay() || 7
      const mon = new Date(d)
      mon.setDate(d.getDate() - day + 1)
      return { start: mon.toLocaleDateString('sv-SE'), end: localToday() }
    },
  },
  {
    label: '本月',
    getRange: () => {
      const d = new Date()
      return { start: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`, end: localToday() }
    },
  },
]

function ExportModalBody({ defaultDate, onClose }: { defaultDate: string; onClose: () => void }) {
  const [startDate, setStartDate] = useState(defaultDate)
  const [endDate, setEndDate] = useState(defaultDate)
  const [format, setFormat] = useState('markdown')

  function handleExport() {
    const apiBase = window.location.protocol === 'file:' ? 'http://localhost:8765' : ''
    let url: string
    if (startDate === endDate) {
      url = `${apiBase}/api/reports/daily?date=${startDate}`
    } else {
      url = `${apiBase}/api/reports/weekly?start=${startDate}&end=${endDate}`
    }
    const a = document.createElement('a')
    a.href = url
    a.download = ''
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    onClose()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* 时间范围 */}
      <div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-ghost)', marginBottom: 10 }}>时间范围</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
            style={{ fontFamily: 'var(--mono)', fontSize: 13, background: 'transparent', border: 'none', borderBottom: '0.5px solid var(--rule)', outline: 'none', padding: '4px 0', color: 'var(--ink)' }} />
          <span style={{ color: 'var(--ink-ghost)', fontFamily: 'var(--mono)', fontSize: 11 }}>—</span>
          <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)}
            style={{ fontFamily: 'var(--mono)', fontSize: 13, background: 'transparent', border: 'none', borderBottom: '0.5px solid var(--rule)', outline: 'none', padding: '4px 0', color: 'var(--ink)' }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {PRESETS.map(p => (
            <button key={p.label} type="button"
              onClick={() => { const r = p.getRange(); setStartDate(r.start); setEndDate(r.end) }}
              style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em', color: 'var(--ink-faded)', background: 'none', border: '0.5px solid var(--rule-soft)', padding: '2px 10px', cursor: 'pointer' }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* 导出格式 */}
      <div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-ghost)', marginBottom: 10 }}>导出格式</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          {FORMATS.map(f => (
            <label key={f.value}
              style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: f.available ? 'pointer' : 'not-allowed', opacity: f.available ? 1 : 0.4 }}>
              <input type="radio" name="format" value={f.value}
                checked={format === f.value}
                disabled={!f.available}
                onChange={() => f.available && setFormat(f.value)}
              />
              <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--ink-soft)' }}>
                {f.label}{!f.available && <span style={{ fontSize: 10, color: 'var(--ink-ghost)', marginLeft: 4 }}>开发中</span>}
              </span>
            </label>
          ))}
        </div>
      </div>

      {/* 操作按钮 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
        <button type="button" className="btn btn--ghost" onClick={onClose}>取消</button>
        <button type="button" className="btn btn--primary" onClick={handleExport}>导出</button>
      </div>
    </div>
  )
}

// ── 主页面 ────────────────────────────────────────────────────────
export function QuickLogPage() {
  const [date, setDate] = useState(() => localToday())
  const { data: submitted = [], isLoading } = useLogsByDate(date)
  const { showToast } = useToastContext()
  const { openModal, closeModal } = useModalContext()
  const qc = useQueryClient()
  const [showCard, setShowCard] = useState(false)
  const [editingLog, setEditingLog] = useState<any>(null)
  const [showBatchPanel, setShowBatchPanel] = useState(false)

  const { targetDate, clearTargetDate } = useWorkbench()

  // 组件挂载时读取跳转传入的目标日期
  useEffect(() => {
    if (targetDate) {
      setDate(targetDate)
      clearTargetDate()
    }
  }, [])

  // 每次导航到此页面时同步今日日期（无跳转目标时）
  const location = useLocation()
  useEffect(() => {
    if (!targetDate) setDate(localToday())
  }, [location.pathname])

  function handleExportClick() {
    openModal({
      eyebrow: '导出',
      title: '导出日报',
      titleMode: 'zh',
      body: <ExportModalBody defaultDate={date} onClose={closeModal} />,
      buttons: [],
    })
  }

  async function handleSubmitAll() {
    // 已废弃，直接提交逻辑移至 FloatingCard
  }

  function removeDraft(_localId: number) {}

  return (
    <div className={styles.page}>
      {/* 标题栏 */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <span className={styles.headerTitle}>日报</span>
          <input
            type="date"
            className={styles.headerDate}
            value={date}
            onChange={e => setDate(e.target.value)}
          />
        </div>
        <div className={styles.headerRight}>
          <button
            type="button"
            className={styles.batchBtn}
            onClick={() => setShowBatchPanel(true)}
          >
            今日填报
          </button>
        </div>
      </div>

      {/* 已提交 */}
      <div>
        <div className={styles.sectionLabel}>
          <span>已提交 <span className={styles.sectionCount}>{submitted.length} 条</span>
          {submitted.length > 0 && (() => {
            const hours = parseFloat(submitted.reduce((sum: number, log: any) => sum + (log.hours || 0), 0).toFixed(1))
            const followedTodos = new Set(
              submitted.flatMap((log: any) => (log.related_todos ?? []).map((t: any) => t.id))
            ).size
            return <>
              <span className={styles.sectionCount}>· {hours} 小时</span>
              {followedTodos > 0 && (
                <span className={styles.sectionCount}>· 跟进 {followedTodos} 个待办</span>
              )}
            </>
          })()}</span>
          <button type="button" className={styles.exportBtn} title="导出" onClick={handleExportClick}>
            <img src={ExportIcon} width={14} height={14} alt="导出" />
          </button>
        </div>
        {isLoading ? (
          <div className={styles.empty}>加载中…</div>
        ) : submitted.length === 0 ? (
          <div className={styles.empty}>今日暂无已提交日志</div>
        ) : (
          <div className={styles.tableWrap}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th className={styles.thNo}>#</th>
                  <th className={styles.th}>所属任务</th>
                  <th className={styles.th}>阶段</th>
                  <th className={styles.th}>工时</th>
                  <th className={styles.th} style={{ textAlign: 'center' }}>附件</th>
                  <th className={styles.th} style={{ width: '100%' }}>日志内容</th>
                  <th className={styles.th}>操作</th>
                </tr>
              </thead>
              <tbody>
                {submitted.map((log: any, idx: number) => (
                  <LogRow key={log.id} log={log} idx={idx} onEdit={setEditingLog} />
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button type="button" className={styles.addBtn} onClick={() => setShowCard(true)}>
          ＋ 添加日志
        </button>
      </div>

      {/* 浮动填报卡片 */}
      {(showCard || editingLog) && (
        <FloatingCard
          editingLog={editingLog}
          defaultDate={date}
          onClose={() => { setShowCard(false); setEditingLog(null) }}
        />
      )}

      {/* 批量填报抽屉 */}
      {showBatchPanel && (
        <BatchLogPanel
          defaultDate={date}
          onClose={() => setShowBatchPanel(false)}
          onSubmitted={() => qc.invalidateQueries({ queryKey: ['logs', 'by-date', date] })}
        />
      )}
    </div>
  )
}
