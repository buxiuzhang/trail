import { useParams } from 'react-router-dom'
import { useTask } from '@/api/tasks'
import { TaskForm } from '@/components/form/TaskForm'
import { EmptyState } from '@/components/detail/EmptyState'

export function FormPage() {
  const { id } = useParams<{ id: string }>()
  const mode = id ? 'edit' : 'new'
  const taskId = id ? Number(id) : 0
  const { data: task, isLoading } = useTask(taskId)

  if (mode === 'edit') {
    if (isLoading) return <EmptyState glyph="⋯" title="载入中..." />
    if (!task) return <EmptyState glyph="!" title="未找到条目" subtitle="该任务不存在或已被删除。" />
  }

  return <TaskForm mode={mode} task={mode === 'edit' ? task : undefined} />
}
