import { useMemo, useState } from 'react'
import type { TaskOut, LogOut, TodoOut } from '@/types'
import { isSealed } from '@/constants'
import { LogCompose } from './LogCompose'
import { ContentViewer } from '@/components/shared/ContentViewer'
import { useConfirm } from '@/utils/confirm'
import { useModalContext } from '@/context/ModalContext'
import { useQueryClient } from '@tanstack/react-query'
import { useUpdateLog } from '@/api/logs'
import { useDeleteAttachment, useAttachmentsByIds } from '@/api/attachments'
import { api } from '@/api/client'
import styles from './Logbook.module.css'

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
  const { openModal } = useModalContext()
  const qc = useQueryClient()
  const updateLog = useUpdateLog(task.id)
  const deleteAttachment = useDeleteAttachment()
  const [ctxMenu, setCtxMenu] = useState<{
    x: number; y: number
    att: { name: string; url: string; id: number; mime: string }
  } | null>(null)

  const attIds = log.attachment_ids ?? []
  const { data: attList = [] } = useAttachmentsByIds(attIds)

  const attachmentMap = useMemo(() => {
    const m = new Map<number, { name: string; mime: string }>()
    for (const a of attList) {
      m.set(a.id, { name: a.original_name || `文件 #${a.id}`, mime: a.mime })
    }
    return m
  }, [attList])

  async function handleDeleteAttachment(att: { name: string; url: string; id: number }) {
    const ok = await confirm({
      level: 'critical',
      title: '删除附件？',
      body: <p>将永久删除「{att.name}」，并从日报中移除引用，无法恢复。</p>,
      confirmLabel: '删除',
    })
    if (!ok) return
    await deleteAttachment.mutateAsync(att.id)
    // 从 content 中移除 @file:ID token
    const newContent = (log.content ?? '')
      .replace(new RegExp(`@file:${att.id}\\s?`, 'g'), '')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
    await updateLog.mutateAsync({ logId: log.id, data: { content: newContent } })
  }

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
        {attIds.length > 0 && (
          <div className={styles.attachments}>
            {attIds.map((id, i) => {
              const att = attachmentMap.get(id)
              const name = att?.name ?? `文件 #${id}`
              const mime = att?.mime ?? ''
              const isImage = mime.startsWith('image/')
              const url = `/api/attachments/${id}`
              return (
                <div
                  key={id}
                  className={styles.attachmentRow}
                  onContextMenu={e => {
                    e.preventDefault()
                    setCtxMenu({ x: e.clientX, y: e.clientY, att: { name, url, id, mime } })
                  }}
                >
                  <span className={styles.attachmentSeq}>{i + 1}.</span>
                  <span className={styles.attachmentIcon}>{isImage ? '🖼' : '📎'}</span>
                  <span className={styles.attachmentName}>{name}</span>
                  <button
                    type="button"
                    className={styles.attachmentDel}
                    onClick={e => { e.stopPropagation(); handleDeleteAttachment({ name, url, id }) }}
                    title="删除附件"
                  >×</button>
                </div>
              )
            })}
          </div>
        )}
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
                onClick={() => {
                  const att = ctxMenu.att
                  setCtxMenu(null)
                  let newName = att.name
                  openModal({
                    eyebrow: '重命名',
                    title: '修改文件名',
                    titleMode: 'zh',
                    body: (
                      <div>
                        <input
                          type="text"
                          defaultValue={newName}
                          autoFocus
                          onChange={e => { newName = e.target.value }}
                          style={{
                            width: '100%', fontFamily: 'var(--mono)', fontSize: 14,
                            border: 'none', borderBottom: '0.5px solid var(--ink)',
                            padding: '6px 0', background: 'transparent', color: 'var(--ink)',
                            outline: 'none',
                          }}
                        />
                      </div>
                    ),
                    buttons: [
                      { label: '取消', className: 'btn btn--ghost', action: () => {} },
                      {
                        label: '确认', className: 'btn btn--primary',
                        action: async () => {
                          const trimmed = newName.trim()
                          if (!trimmed) return
                          await api.put(`/api/attachments/${att.id}`, { originalName: trimmed })
                          // 重命名只改 DB original_name，content 里是 @file:ID 不含名字
                          qc.invalidateQueries({ queryKey: ['attachments'] })
                        },
                      },
                    ],
                  })
                }}
              >
                重命名
              </div>
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
          <button
            type="button"
            disabled={sealed}
            onClick={async () => {
              const ok = await confirm({
                level: 'moderate',
                title: '软删此条日报？',
                body: <p>日报将被标记为已删除，可在任务详情中查看历史记录。</p>,
                confirmLabel: '软删',
              })
              if (ok) onDelete()
            }}
          >软删</button>
        </div>
      </div>
    </div>
  )
}
