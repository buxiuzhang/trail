import { useState } from 'react'
import type { TaskOut, TodoOut } from '@/types'
import addTodoIcon from '@/assets/add-todo.svg'
import { RichText } from '@/components/shared/RichText'
import styles from './TodoSection.module.css'

interface TodoSectionProps {
  task: TaskOut
  todos: TodoOut[]
  /** 点 header "＋ 待办" 按钮触发，父级负责弹窗录入表单。 */
  onRequestAdd: () => void
  /** 点 checkbox 触发（不再直接调完成 API，由父级弹窗二次确认）。 */
  onRequestComplete: (todoId: number) => void
  onAbandon: (todoId: number) => void
  onDelete: (todoId: number) => void
}

export function TodoSection({
  task,
  todos,
  onRequestAdd,
  onRequestComplete,
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
                    {t.description && (
                      <span className={styles.toggle}>{expanded ? '▴' : '▾'}</span>
                    )}
                  </button>
                  <div className={styles.actions}>
                    {!isCompleted && !isAbandoned && (
                      <button
                        type="button"
                        className={styles.btnAbandon}
                        onClick={() => onAbandon(t.id)}
                        title="标记为废弃"
                      >
                        废弃
                      </button>
                    )}
                    {!isCompleted && (
                      <button
                        type="button"
                        className={styles.btnDelete}
                        onClick={() => onDelete(t.id)}
                        title="永久删除"
                      >
                        删除
                      </button>
                    )}
                  </div>
                </div>
                {expanded && t.description && (
                  <div className={styles.descBlock}>
                    <RichText text={t.description} className={styles.descText} />
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
