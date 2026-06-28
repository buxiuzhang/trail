import { useState } from 'react'
import { useParams, useLocation } from 'react-router-dom'
import { useTask, useUpdateTask, useChangeTaskStatus, useCancelTask, useTasks } from '@/api/tasks'
import { useInfiniteLogs, useCreateLog, useUpdateLog, useDeleteLog } from '@/api/logs'
import { useTodos, useCreateTodo, useUpdateTodo, useCompleteTodo, useAbandonTodo, useDeleteTodo } from '@/api/todos'
import { useModalContext } from '@/context/ModalContext'
import { useToastContext } from '@/context/ToastContext'
import { useTaskModals } from '@/hooks/useTaskModals'
import { Crumbs } from '@/components/shared/Crumbs'
import { EmptyState } from '@/components/detail/EmptyState'
import { DetailHeader } from '@/components/detail/DetailHeader'
import { MetaPane } from '@/components/detail/MetaPane'
import { Logbook } from '@/components/detail/Logbook'
import { TodoSection } from '@/components/detail/TodoSection'

function catalogOf(id: number, createdAt: string | null): string {
  if (!createdAt) return `#${id}`
  const y = createdAt.slice(0, 4)
  return `${y}-${String(id).padStart(3, '0')}`
}

export function DetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const { hash } = useLocation()
  const { openModal, closeModal } = useModalContext()
  const { showToast } = useToastContext()

  const { data: task, isLoading, error } = useTask(taskId)
  const [logSortOrder, setLogSortOrder] = useState<'asc' | 'desc'>('desc')
  const { data: logsData, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteLogs(taskId, logSortOrder)
  const { data: todos = [] } = useTodos(taskId)
  const { data: allTasks = [] } = useTasks()
  const [metaCollapsed, setMetaCollapsed] = useState(false)

  const updateTask = useUpdateTask(taskId)
  const createLog = useCreateLog(taskId)
  const updateLog = useUpdateLog(taskId)
  const deleteLog = useDeleteLog(taskId)
  const changeStatus = useChangeTaskStatus(taskId)
  const cancelTask = useCancelTask(taskId)
  const createTodo = useCreateTodo(taskId)
  const updateTodo = useUpdateTodo(taskId)
  const completeTodo = useCompleteTodo(taskId)
  const abandonTodo = useAbandonTodo(taskId)
  const deleteTodo = useDeleteTodo(taskId)

  const revealLogId = hash?.startsWith('#log-') ? Number(hash.slice(5)) || undefined : undefined

  const modals = useTaskModals({
    task: task!,
    todos,
    mutations: { updateTask, changeStatus, cancelTask, createLog, deleteLog, createTodo, updateTodo, completeTodo, abandonTodo, deleteTodo },
    openModal,
    closeModal,
    showToast,
  })

  if (isLoading) return <EmptyState glyph="⋯" title="调阅中..." subtitle="正在调取档案" />
  if (error || !task) return <EmptyState glyph="!" title="档案不存在" subtitle={(error as Error)?.message || '该任务可能已被删除'} />

  const activeLogs = logsData?.pages.flatMap(p => p.items) ?? []
  const lastLogDate = activeLogs.length > 0 ? activeLogs[0].log_date : null
  const catalog = catalogOf(task.id, task.created_at)

  async function handleSaveNew(data: { log_date: string; content: string; phase: string; hours: number; todo_ids: number[]; task_ids: number[] }) {
    await createLog.mutateAsync(data)
    if (!task!.processing_date) {
      await updateTask.mutateAsync({ processing_date: data.log_date })
    }
    showToast('已落档')
  }

  async function handleSaveEdit(logId: number, data: { log_date: string; content: string; phase: string; hours: number; todo_ids: number[]; task_ids: number[] }) {
    await updateLog.mutateAsync({ logId, data })
    showToast('已保存')
  }

  return (
    <article className="detail">
      <Crumbs items={[{ label: '任务清单', href: '/archive' }, { label: `CAT. № ${catalog}` }]} />

      <DetailHeader
        task={task}
        catalog={catalog}
        logCount={logsData?.pages[0]?.total ?? 0}
      />

      <TodoSection
        task={task}
        todos={todos}
        onRequestAdd={modals.openAddTodoModal}
        onRequestComplete={modals.openCompleteTodoModal}
        onRequestEdit={modals.openEditTodoModal}
        onAbandon={modals.handleAbandonTodo}
        onDelete={modals.handleDeleteTodo}
      />

      <div className={`detail__body ${metaCollapsed ? 'detail__body--collapsed' : ''}`}>
        <MetaPane
          task={task}
          lastLogDate={lastLogDate}
          collapsed={metaCollapsed}
          onToggleCollapse={() => setMetaCollapsed(!metaCollapsed)}
          onChangeStatus={modals.openStatusModal}
          onCancel={modals.openCancelModal}
        />

        <Logbook
          task={task}
          logs={activeLogs}
          todos={todos}
          tasks={allTasks}
          onSaveNew={handleSaveNew}
          onSaveEdit={handleSaveEdit}
          onDelete={modals.handleDeleteLog}
          revealLogId={revealLogId}
          fetchNextPage={fetchNextPage}
          hasNextPage={hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          sortOrder={logSortOrder}
          onSortChange={setLogSortOrder}
        />
      </div>
    </article>
  )
}
