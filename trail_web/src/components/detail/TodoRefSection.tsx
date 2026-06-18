import type { TodoOut, TaskOut } from '@/types'
import styles from './TodoRefSection.module.css'

interface TodoRefSectionProps {
  /** 当前任务的待办列表（完整） */
  todos: TodoOut[]
  /** 已关联的待办 ID */
  selectedTodoIds: number[]
  onChangeTodo: (ids: number[]) => void
  /** 全局任务列表（完整） */
  tasks: TaskOut[]
  /** 已关联的任务 ID */
  selectedTaskIds: number[]
  onChangeTask: (ids: number[]) => void
}

export function TodoRefSection({
  todos,
  selectedTodoIds,
  onChangeTodo,
  tasks,
  selectedTaskIds,
  onChangeTask,
}: TodoRefSectionProps) {
  const selectedTodos = selectedTodoIds
    .map(id => todos.find(t => t.id === id))
    .filter((t): t is TodoOut => !!t)
  const selectedTasks = selectedTaskIds
    .map(id => tasks.find(t => t.id === id))
    .filter((t): t is TaskOut => !!t)

  if (selectedTodos.length === 0 && selectedTasks.length === 0) return null

  return (
    <div className={styles.section}>
      <div className={styles.selectedList}>
        {selectedTodos.map(todo => (
          <div key={`todo-${todo.id}`} className={styles.selectedItem}>
            <span className={styles.tag}>待办</span>
            <span className={styles.selectedTitle}>{todo.title}</span>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => onChangeTodo(selectedTodoIds.filter(id => id !== todo.id))}
              title="移除关联"
            >
              ×
            </button>
          </div>
        ))}
        {selectedTasks.map(task => (
          <div key={`task-${task.id}`} className={`${styles.selectedItem} ${styles.taskItem}`}>
            <span className={`${styles.tag} ${styles.taskTag}`}>任务</span>
            <span className={styles.selectedTitle}>{task.title}</span>
            <button
              type="button"
              className={styles.removeBtn}
              onClick={() => onChangeTask(selectedTaskIds.filter(id => id !== task.id))}
              title="移除关联"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
