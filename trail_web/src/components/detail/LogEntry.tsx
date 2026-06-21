import { useState } from 'react'
import type { TaskOut, LogOut, TodoOut } from '@/types'
import { isSealed } from '@/constants'
import { LogCompose } from './LogCompose'
import { ContentViewer } from '@/components/shared/ContentViewer'
import { useConfirm } from '@/utils/confirm'
import { useUpdateLog } from '@/api/logs'
import { useDeleteAttachment } from '@/api/attachments'
import styles from './Logbook.module.css'

/** 从 markdown 内容中提取附件链接 */
function extractAttachments(content: string): Array<{ name: string; url: string; id: number }> {
  const re = /\[([^\]]+)\]\((\/api\/attachments\/(\d+))\)/g
  const out: Array<{ name: string; url: string; id: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    out.push({ name: m[1], url: m[2], id: Number(m[3]) })
  }
  return out
}

interface LogEntryProps {
  task: TaskOut
  log: LogOut
  todos: TodoOut[]
  /** 全局任务列表（用于 @ 任务引用） */
  tasks?: TaskOut[]
  isEditing: boolean
  onEdit: () => void
  onDelete: () => void
  onSaveEdit: (data: { log_date: string; content: string; phase: string; hours: number; todo_ids: number[]; task_ids: number[] }) => Promise<void>
  onCancelEdit: () => void
}

export function LogEntry({ task, log, todos, tasks = [], isEditing, onEdit, onDelete, onSaveEdit, onCancelEdit }: LogEntryProps) {
  const sealed = isSealed(task)
  const confirm = useConfirm()
  const updateLog = useUpdateLog(task.id)
  const deleteAttachment = useDeleteAttachment()
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number
    att: { name: string; url: string; id: number }
  } | null>(null)

  async function handleDeleteAttachment(att: { name: string; url: string; id: number }) {
    const ok = await confirm({
      level: 'critical',
      title: '删除附件？',
      body: <p>将永久删除「{att.name}」，并从日志中移除引用，无法恢复。</p>,
      confirmLabel: '删除',
    })
    if (!ok) return
    // 1. 物理删除附件文件
    await deleteAttachment.mutateAsync(att.id)
    // 2. 从 content 中移除对应 markdown 链接
    const escaped = att.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(`\\[${escaped}\\]\\(${att.url}\\)`, 'g')
    const newContent = (log.content ?? '').replace(re, '').replace(/\n{3,}/g, '\n\n').trim()
    await updateLog.mutateAsync({ logId: log.id, data: { content: newContent } })
  }

  // 编辑态：整条替换为 compose form
  if (isEditing) {
    return (
      <div className={`${styles.entry} ${log.phase === 'maintenance' ? styles.entryMt : ''} ${styles.entryEditing}`}>
        <LogCompose task={task} todos={todos} tasks={tasks} editing={log} onSave={onSaveEdit} onCancel={onCancelEdit} />
      </div>
    )
  }

  const isMt = log.phase === 'maintenance'
  const editedTag = log.updated_at
    ? <span className={styles.edited} title={log.updated_at}>已改 {log.edit_count} 次</span>
    : null

  // 用于渲染 @ 提及的回调
  const getTodoTitle = (id: number) => todos.find(t => t.id === id)?.title
  const getTodoStatus = (id: number) => {
    const t = todos.find(t => t.id === id)
    if (!t) return 'deleted'
    if (t.is_completed) return 'completed'
    if (t.is_abandoned) return 'abandoned'
    return 'active'
  }
  const getTaskTitle = (id: number) => tasks.find(t => t.id === id)?.title

  return (
    <div id={`log-${log.id}`} className={`${styles.entry} ${isMt ? styles.entryMt : ''}`}>
      <div className={styles.date}>
        <span className={styles.dateDay}>{log.log_date.slice(8, 10)}</span>
        <span>{log.log_date.slice(5, 7)}/{log.log_date.slice(2, 4)}</span>
        <span className={styles.dateYr}>{log.log_date.slice(0, 4)}</span>
      </div>
      <span className={styles.dot} aria-hidden="true" />
      <div className={styles.body}>
        <div className={styles.topline}>
          <span className={styles.phase}>{isMt ? 'maintenance' : 'main'}</span>
          <span className={styles.ord}>№ {String(log.id).padStart(3, '0')}</span>
          {editedTag}
          {log.hours && <span className={styles.hours}>{log.hours}h</span>}
        </div>
        <ContentViewer
          text={log.content}
          maxHeight={240}
          previewClassName={styles.content}
          todos={todos}
          tasks={tasks}
        />
        {/* 附件区 */}
        {(() => {
          const attachments = extractAttachments(log.content ?? '')
          if (attachments.length === 0) return null
          return (
            <div className={styles.attachments}>
              {attachments.map((att, i) => (
                <div
                  key={att.id}
                  className={styles.attachmentRow}
                  onContextMenu={e => {
                    e.preventDefault()
                    setCtxMenu({ x: e.clientX, y: e.clientY, att })
                  }}
                >
                  <span className={styles.attachmentSeq}>{i + 1}.</span>
                  <span className={styles.attachmentIcon}>📎</span>
                  <span className={styles.attachmentName}>{att.name}</span>
                  <button
                    type="button"
                    className={styles.attachmentDel}
                    onClick={e => { e.stopPropagation(); handleDeleteAttachment(att) }}
                    title="删除附件"
                  >×</button>
                </div>
              ))}
            </div>
          )
        })()}
        {/* 附件右键菜单 */}
        {ctxMenu && (
          <>
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 999 }}
              onClick={() => setCtxMenu(null)}
            />
            <div
              className={styles.attCtxMenu}
              style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 1000 }}
            >
              <div
                className={styles.attCtxItem}
                onClick={async () => {
                  const att = ctxMenu.att
                  setCtxMenu(null)
                  const ok = await confirm({
                    level: 'moderate',
                    title: '下载附件？',
                    body: <p>将下载「{att.name}」到本地。</p>,
                    confirmLabel: '下载',
                  })
                  if (ok) {
                    const a = document.createElement('a')
                    a.href = att.url
                    a.download = att.name
                    a.click()
                  }
                }}
              >
                下载
              </div>
              <div
                className={styles.attCtxItem}
                onClick={() => {
                  window.open(ctxMenu.att.url, '_blank')
                  setCtxMenu(null)
                }}
              >
                在浏览器中预览
              </div>
            </div>
          </>
        )}
        {/* 关联待办展示 */}
        {log.todo_ids && log.todo_ids.length > 0 && (
          <div className={styles.todoRefs}>
            <span className={styles.todoRefsLabel}>关联待办</span>
            {log.todo_ids.map(id => {
              const todo = todos.find(t => t.id === id)
              if (!todo) {
                return (
                  <span key={id} className={`${styles.todoRefChip} ${styles.todoRefDeleted}`}>
                    [已删除]
                  </span>
                )
              }
              const chipClass = todo.is_completed
                ? styles.todoRefCompleted
                : todo.is_abandoned
                  ? styles.todoRefAbandoned
                  : ''
              return (
                <span key={id} className={`${styles.todoRefChip} ${chipClass}`}>
                  {todo.title}
                  {todo.is_completed && ' ✓'}
                  {todo.is_abandoned && ' ✕'}
                </span>
              )
            })}
          </div>
        )}
        {/* 关联任务展示 */}
        {log.task_ids && log.task_ids.length > 0 && (
          <div className={styles.taskRefs}>
            <span className={styles.taskRefsLabel}>关联任务</span>
            {log.task_ids.map(id => {
              const t = tasks.find(t => t.id === id)
              if (!t) {
                return (
                  <a key={id} href={`#/task/${id}`} className={`${styles.taskRefChip} ${styles.taskRefDeleted}`}>
                    [已删除#{id}]
                  </a>
                )
              }
              return (
                <a key={id} href={`#/task/${id}`} className={styles.taskRefChip}>
                  {t.title}
                </a>
              )
            })}
          </div>
        )}
        {log.polished_content && (
          <div className={styles.polish}>
            <span className={styles.polishLabel}>润色后</span>
            <ContentViewer
              text={log.polished_content}
              maxHeight={240}
              todos={todos}
              tasks={tasks}
            />
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={onEdit} disabled={sealed}>编辑</button>
          <button type="button" onClick={onDelete} disabled={sealed}>软删</button>
        </div>
      </div>
    </div>
  )
}
