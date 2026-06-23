import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useTasks, useTask } from '@/api/tasks'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import { LogCompose } from '@/components/detail/LogCompose'
import { TODAY } from '@/constants'
import type { TaskOut } from '@/types'
import type { LogOut } from '@/types/log'
import { api } from '@/api/client'
import { useUpdateLog } from '@/api/logs'
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

// ── 指定日期日志 ──────────────────────────────────────────────────
function useLogsByDate(date: string) {
  return useQuery({
    queryKey: ['logs', 'by-date', date],
    queryFn: () => api.get<Record<string, unknown>[]>(`/api/logs/by-date?date=${date}`),
    staleTime: 30_000,
  })
}

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
  onAdd, onClose, editingLog,
}: {
  onAdd: (draft: DraftLog) => void
  onClose: () => void
  editingLog?: any
}) {
  const isEdit = !!editingLog
  const { data: tasks = [] } = useTasks()
  const [taskId, setTaskId] = useState<number | null>(isEdit ? editingLog.task_id : null)
  const [search, setSearch] = useState(isEdit ? editingLog.task_title : '')
  const [focused, setFocused] = useState(false)
  const { data: selectedTask } = useTask(taskId ?? 0)
  const updateLog = useUpdateLog(taskId ?? 0)
  const { showToast } = useToastContext()
  const qc = useQueryClient()

  const filtered = tasks
    .filter(t => t.status === '进行中')
    .filter(t => !search
      || t.title.toLowerCase().includes(search.toLowerCase())
      || (t.alias || '').toLowerCase().includes(search.toLowerCase()))
    .slice(0, 8)

  const taskForCompose: TaskOut = selectedTask ?? makePlaceholderTask()

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.floatCard}>
        <div className={styles.taskRow}>
          <span className={styles.taskLabel}>所属任务</span>
          <div className={styles.taskSelectWrap}>
            <input
              className={styles.taskInput}
              value={taskId && !focused ? (selectedTask?.title ?? '') : search}
              onChange={e => { setSearch(e.target.value); setTaskId(null) }}
              onFocus={() => setFocused(true)}
              onBlur={() => setTimeout(() => setFocused(false), 150)}
              placeholder="搜索并选择任务…"
              autoFocus
            />
            <span
              className={styles.taskArrow}
              onClick={() => { setSearch(''); setFocused(true) }}
            >▼</span>
            {focused && (
              <div className={styles.dropdown}>
                {filtered.map(t => (
                  <div
                    key={t.id}
                    className={styles.dropdownItem}
                    onMouseDown={e => e.preventDefault()}
                    onClick={() => { setTaskId(t.id); setSearch(t.title); setFocused(false) }}
                  >
                    {t.title}
                  </div>
                ))}
                {filtered.length === 0 && (
                  <div className={styles.dropdownEmpty}>无匹配进行中任务</div>
                )}
              </div>
            )}
          </div>
        </div>

        <LogCompose
          task={taskForCompose}
          todos={[]}
          editing={isEdit ? (editingLog as LogOut) : null}
          saveDisabled={!taskId}
          saveLabel={isEdit ? '保存' : undefined}
          onSave={async (data) => {
            if (!taskId) return
            if (isEdit) {
              await updateLog.mutateAsync({ logId: editingLog.id, data })
              qc.invalidateQueries({ queryKey: ['logs', 'by-date', TODAY] })
              showToast('日志已更新')
              onClose()
            } else {
              if (!selectedTask) return
              onAdd({
                localId: localIdSeq++,
                taskId,
                taskTitle: selectedTask.title,
                logDate: data.log_date,
                phase: data.phase,
                hours: data.hours,
                content: data.content,
                todo_ids: data.todo_ids,
                task_ids: data.task_ids,
              })
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
function LogRow({ log, idx, onEdit }: { log: any; idx: number; onEdit: (log: any) => void }) {
  const confirm = useConfirm()
  const { showToast } = useToastContext()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const content: string = log.polished_content || log.content || ''

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
          {content}
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

// ── 主页面 ────────────────────────────────────────────────────────
export function QuickLogPage() {
  const [date, setDate] = useState(TODAY)
  const { data: submitted = [], isLoading } = useLogsByDate(date)
  const [drafts, setDrafts] = useState<DraftLog[]>([])
  const [showCard, setShowCard] = useState(false)
  const [editingLog, setEditingLog] = useState<any>(null)
  const [submitting, setSubmitting] = useState(false)
  const { showToast } = useToastContext()
  const qc = useQueryClient()

  function removeDraft(localId: number) {
    setDrafts(ds => ds.filter(d => d.localId !== localId))
  }

  async function handleSubmitAll() {
    if (drafts.length === 0) return
    setSubmitting(true)
    let ok = 0
    for (const d of drafts) {
      try {
        await api.post(`/api/tasks/${d.taskId}/logs`, {
          log_date: d.logDate,
          content: d.content,
          phase: d.phase,
          hours: d.hours,
          todo_ids: d.todo_ids,
          task_ids: d.task_ids,
        })
        ok++
      } catch {
        showToast(`「${d.taskTitle}」提交失败`, 'error')
      }
    }
    setSubmitting(false)
    if (ok > 0) {
      setDrafts([])
      qc.invalidateQueries({ queryKey: ['logs', 'by-date', TODAY] })
      showToast(`${ok} 条日志已提交`)
    }
  }

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
        <button type="button" className={styles.addBtn} onClick={() => setShowCard(true)}>
          ＋ 添加日志
        </button>
      </div>

      {/* 待提交草稿 */}
      {drafts.length > 0 && (
        <div className={styles.draftSection}>
          <div className={styles.sectionLabel}>
            待提交 <span className={styles.sectionCount}>{drafts.length} 条</span>
          </div>
          <div className={styles.draftList}>
            {drafts.map(d => (
              <div key={d.localId} className={styles.draftItem}>
                <div className={styles.draftItemLeft}>
                  <span className={styles.logTaskName}>{d.taskTitle}</span>
                  <span className={styles.logPhase}>{d.phase === 'main' ? '主体' : '维护'}</span>
                  <span className={styles.logHours}>{d.hours}h</span>
                </div>
                <p className={styles.logContent}>{d.content.slice(0, 80)}{d.content.length > 80 ? '…' : ''}</p>
                <button
                  type="button"
                  className={styles.draftRemove}
                  onClick={() => removeDraft(d.localId)}
                  title="移除"
                >×</button>
              </div>
            ))}
          </div>
          <div className={styles.submitRow}>
            <button
              type="button"
              className={styles.submitBtn}
              onClick={handleSubmitAll}
              disabled={submitting}
            >
              {submitting ? '提交中…' : `提交全部（${drafts.length} 条）`}
            </button>
          </div>
        </div>
      )}

      {/* 已提交 */}
      <div>
        <div className={styles.sectionLabel}>
          已提交 <span className={styles.sectionCount}>{submitted.length} 条</span>
          {submitted.length > 0 && (
            <span className={styles.sectionCount}>
              · {parseFloat(submitted.reduce((sum: number, log: any) => sum + (log.hours || 0), 0).toFixed(1))} 小时
            </span>
          )}
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
      </div>

      {/* 浮动填报卡片 */}
      {(showCard || editingLog) && (
        <FloatingCard
          onAdd={d => setDrafts(ds => [...ds, d])}
          editingLog={editingLog}
          onClose={() => { setShowCard(false); setEditingLog(null) }}
        />
      )}
    </div>
  )
}
