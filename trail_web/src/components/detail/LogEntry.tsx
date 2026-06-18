import type { TaskOut, LogOut, TodoOut } from '@/types'
import { isSealed } from '@/constants'
import { LogCompose } from './LogCompose'
import { ContentViewer } from '@/components/shared/ContentViewer'
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
