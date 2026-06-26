import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TaskOut, TodoOut } from '@/types'
import { useLogsForTodo } from '@/api/todos'
import type { TodoLogItem } from '@/api/todos'
import addTodoIcon from '@/assets/add-todo.svg'
import { ContentViewer } from '@/components/shared/ContentViewer'
import styles from './TodoSection.module.css'

interface TodoSectionProps {
  task: TaskOut
  todos: TodoOut[]
  /** 点 header "＋ 待办" 按钮触发，父级负责弹窗录入表单。 */
  onRequestAdd: () => void
  /** 点 checkbox 触发（不再直接调完成 API，由父级弹窗二次确认）。 */
  onRequestComplete: (todoId: number) => void
  onRequestEdit: (todoId: number) => void
  onAbandon: (todoId: number) => void
  onDelete: (todoId: number) => void
}

const PAGE_SIZE = 5

function truncate(text: string, max = 20): string {
  const plain = text.replace(/@\w+「([^」]*)」/g, '$1').replace(/\s+/g, ' ').trim()
  return plain.length > max ? plain.slice(0, max) + '…' : plain
}

function TodoLogList({ taskId, todoId }: { taskId: number; todoId: number }) {
  const navigate = useNavigate()
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)
  const { data: logs, isLoading } = useLogsForTodo(taskId, todoId, true)

  const total = logs?.length ?? 0
  const visible = logs?.slice(0, visibleCount) ?? []
  const hasMore = visibleCount < total

  function handleLogClick(log: TodoLogItem) {
    navigate(`/task/${log.task_id}#log-${log.id}`)
  }

  return (
    <div className={styles.logsSection}>
      <span className={styles.logsSectionTitle}>
        关联日报{!isLoading && total > 0 && <span className={styles.logsCount}>（{total}）</span>}
      </span>
      {isLoading && <p className={styles.logsLoading}>载入中…</p>}
      {!isLoading && total === 0 && <p className={styles.logsEmpty}>暂无关联日报</p>}
      {visible.length > 0 && (
        <ul className={styles.logList}>
          {visible.map((log: TodoLogItem) => (
            <li key={log.id} className={styles.logItem}>
              <button
                type="button"
                className={styles.logBtn}
                onClick={() => handleLogClick(log)}
              >
                <span className={styles.logContent}>{truncate(log.content)}</span>
                <span className={styles.logMeta}>
                  {log.log_date} · {log.hours}h
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {!isLoading && total > PAGE_SIZE && (
        <button
          type="button"
          className={styles.logsMore}
          disabled={!hasMore}
          onClick={() => setVisibleCount(c => c + PAGE_SIZE)}
        >
          {hasMore ? (
            <>
              <svg className={styles.logsMoreIcon} viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2"/>
                <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              </svg>
              加载更多
            </>
          ) : (
            '已全部加载'
          )}
        </button>
      )}
    </div>
  )
}

export function TodoSection({
  task,
  todos,
  onRequestAdd,
  onRequestComplete,
  onRequestEdit,
  onAbandon,
  onDelete,
}: TodoSectionProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())

  // 封版：与 Logbook.tsx:36 一致
  const isClosed =
    task.status === '已作废' || (task.status === '已完成' && task.nature !== '维护')

  // 计数（按后端排序好的三段：未完成 / 已完成 / 已废弃）
  const activeCount = todos.filter(t => !t.is_completed && !t.is_abandoned).length
  const completedCount = todos.filter(t => t.is_completed).length
  const abandonedCount = todos.filter(t => t.is_abandoned).length

  function toggleExpand(id: number) {
    setExpandedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <h3 className={styles.title}>待办事项</h3>
        <span className={styles.count}>
          {activeCount} 待办 · {completedCount} 已完成 · {abandonedCount} 已废弃
        </span>
        {!isClosed && (
          <button
            type="button"
            className={styles.addBtn}
            onClick={onRequestAdd}
            title="添加新待办"
          >
            <img src={addTodoIcon} alt="" className={styles.addIcon} />
          </button>
        )}
      </header>

      {isClosed && (
        <div className={styles.closedHint}>
          <span className={styles.closedGlyph}>✕</span>
          此任务已封版，不再接受新待办。
        </div>
      )}

      {todos.length > 0 && (
        <ul className={styles.list}>
          {todos.map(t => {
            const expanded = expandedIds.has(t.id)
            const isAbandoned = t.is_abandoned
            const isCompleted = t.is_completed
            const rowCls = [
              styles.row,
              isCompleted ? styles.rowCompleted : '',
              isAbandoned ? styles.rowAbandoned : '',
            ].filter(Boolean).join(' ')
            const titleCls = [
              styles.titleText,
              isAbandoned ? styles.struck : '',
            ].filter(Boolean).join(' ')

            return (
              <li key={t.id} className={rowCls}>
                <div className={styles.rowTop}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={isCompleted}
                    disabled={isAbandoned}
                    onChange={() => {
                      if (!isCompleted) onRequestComplete(t.id)
                    }}
                    title={isCompleted ? '已完成' : '标记为完成'}
                    aria-label={`标记 ${t.title} 为完成`}
                  />
                  <button
                    type="button"
                    className={styles.rowMain}
                    onClick={() => toggleExpand(t.id)}
                    aria-expanded={expanded}
                  >
                    <span className={styles.rowMainText}>
                      <span className={titleCls}>{t.title}</span>
                      {t.created_at && (
                        <span className={styles.todoDate}>
                          {new Date(t.created_at).toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}
                        </span>
                      )}
                    </span>
                  </button>
                </div>
                {expanded && (
                  <div className={styles.descBlock}>
                    {t.description && (
                      <ContentViewer
                        text={t.description}
                        className={styles.descText}
                      />
                    )}
                    <TodoLogList taskId={task.id} todoId={t.id} />
                    {!isCompleted && !isClosed && (
                      <div className={styles.descActions}>
                        {!isAbandoned && (
                          <button
                            type="button"
                            className={styles.btnEdit}
                            onClick={() => onRequestEdit(t.id)}
                          >
                            编辑
                          </button>
                        )}
                        {!isAbandoned && (
                          <button
                            type="button"
                            className={styles.btnAbandonInline}
                            onClick={() => onAbandon(t.id)}
                          >
                            废弃
                          </button>
                        )}
                        <button
                          type="button"
                          className={styles.btnDeleteInline}
                          onClick={() => onDelete(t.id)}
                        >
                          删除
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

