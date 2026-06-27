import type { UseMutationResult } from '@tanstack/react-query'
import { ALLOWED_TRANSITIONS, TODAY } from '@/constants'
import { TodoAddForm } from '@/components/detail/TodoAddForm'
import type { TaskOut, TodoOut, TaskUpdate, StatusChange, LogCreate, LogOut, TodoCreate, TodoUpdate } from '@/types'
import type { ModalConfig } from '@/context/ModalContext'

interface Mutations {
  updateTask: UseMutationResult<TaskOut, Error, TaskUpdate>
  changeStatus: UseMutationResult<TaskOut, Error, StatusChange>
  cancelTask: UseMutationResult<TaskOut, Error, void>
  createLog: UseMutationResult<LogOut, Error, LogCreate>
  deleteLog: UseMutationResult<unknown, Error, number>
  createTodo: UseMutationResult<TodoOut, Error, TodoCreate>
  updateTodo: UseMutationResult<TodoOut, Error, { todoId: number; data: TodoUpdate }>
  completeTodo: UseMutationResult<TodoOut, Error, number>
  abandonTodo: UseMutationResult<TodoOut, Error, number>
  deleteTodo: UseMutationResult<unknown, Error, number>
}

interface UseTaskModalsArgs {
  task: TaskOut
  todos: TodoOut[]
  mutations: Mutations
  openModal: (opts: ModalConfig) => void
  closeModal: () => void
  showToast: (msg: string, type?: string) => void
}

export function useTaskModals({
  task,
  todos,
  mutations,
  openModal,
  closeModal,
  showToast,
}: UseTaskModalsArgs) {
  const { updateTask, changeStatus, cancelTask, deleteLog, createTodo, updateTodo, completeTodo, abandonTodo, deleteTodo } = mutations

  function openStatusModal() {
    if (task.status === '已完成' && task.nature === '维护') {
      openModal({
        eyebrow: '封版询问',
        title: '结束维护期？',
        titleMode: 'zh',
        body: (
          <div>
            <p>任务 <em>{task.title}</em> 已完成，当前处于维护期。</p>
            <p>结束后将<em style={{ color: 'var(--oxblood)' }}>封版</em>，不能再添加日报。</p>
          </div>
        ),
        buttons: [
          { label: '取消', className: 'btn btn--ghost', action: () => {} },
          {
            label: '结束维护 · 封版',
            className: 'btn btn--primary',
            action: async () => {
              try {
                await updateTask.mutateAsync({ nature: '长期' })
                showToast('已封版')
              } catch (err: unknown) { showToast('操作失败：' + (err as Error).message) }
            },
          },
        ],
      })
      return
    }

    const targets = [...(ALLOWED_TRANSITIONS[task.status] || new Set())]
    if (targets.length === 0) {
      showToast('当前状态无法变更')
      return
    }

    const isCompleting = targets.includes('已完成')

    if (isCompleting) {
      openModal({
        eyebrow: '状态变更',
        title: '完成此任务？',
        titleMode: 'zh',
        body: (
          <div>
            <p>将任务 <em>{task.title}</em> 标记为完成。</p>
            <p>请选择后续模式：</p>
          </div>
        ),
        buttons: [
          { label: '取消', className: 'btn btn--ghost', action: () => {} },
          {
            label: '含维护期',
            className: 'btn btn--primary',
            action: async () => {
              try {
                await changeStatus.mutateAsync({ new_status: '已完成', end_date: TODAY, maintenance: true })
                showToast('已进入维护期')
              } catch (err: unknown) { showToast('操作失败：' + (err as Error).message) }
            },
          },
          {
            label: '不再维护',
            className: 'btn',
            action: async () => {
              try {
                await changeStatus.mutateAsync({ new_status: '已完成', end_date: TODAY })
                showToast('任务已完成')
              } catch (err: unknown) { showToast('操作失败：' + (err as Error).message) }
            },
          },
        ],
      })
    } else {
      openModal({
        eyebrow: '状态变更',
        title: '选择新状态',
        titleMode: 'zh',
        body: (
          <ul>
            {targets.map(t => <li key={t}>{t}</li>)}
          </ul>
        ),
        buttons: targets.map(t => ({
          label: t,
          className: t === '已作废' ? 'btn btn--danger' : 'btn',
          action: async () => {
            try {
              await changeStatus.mutateAsync({ new_status: t })
              showToast(`状态已变更为「${t}」`)
            } catch (err: unknown) { showToast('操作失败：' + (err as Error).message) }
          },
        })),
      })
    }
  }

  function openCancelModal() {
    openModal({
      eyebrow: '确认',
      title: '作废此条目？',
      titleMode: 'zh',
      body: (
        <div>
          <p>此操作将把 <em>{task.title}</em> 标记为「已作废」。</p>
          <p>作废后可在详情页重新激活，不会删除数据。</p>
        </div>
      ),
      buttons: [
        { label: '再想想', className: 'btn btn--ghost', action: () => {} },
        {
          label: '确认作废',
          className: 'btn btn--danger',
          action: async () => {
            try {
              await cancelTask.mutateAsync()
              showToast('已作废')
            } catch (err: unknown) { showToast('操作失败：' + (err as Error).message) }
          },
        },
      ],
    })
  }

  function handleDeleteLog(logId: number) {
    openModal({
      eyebrow: '确认',
      title: '软删此条日报？',
      titleMode: 'zh',
      body: <p>删除后可在后续版本中恢复。日报 № {String(logId).padStart(3, '0')}</p>,
      buttons: [
        { label: '取消', className: 'btn btn--ghost', action: () => {} },
        {
          label: '确认软删',
          className: 'btn btn--danger',
          action: async () => {
            try {
              await deleteLog.mutateAsync(logId)
              showToast('已软删')
            } catch (err: unknown) { showToast('删除失败：' + (err as Error).message) }
          },
        },
      ],
    })
  }

  function openAddTodoModal() {
    if (task.status === '已作废' || (task.status === '已完成' && task.nature !== '维护')) {
      showToast('此任务已封版，不可添加待办')
      return
    }
    openModal({
      eyebrow: '待办 · 新增',
      title: '下一步要做什么？',
      titleMode: 'zh',
      body: <TodoAddForm
        onSubmit={async (data) => {
          try {
            await createTodo.mutateAsync(data)
            showToast('已添加待办')
          } catch (err: unknown) {
            showToast('添加失败：' + (err as Error).message)
            throw err
          }
        }}
        onClose={closeModal}
      />,
      buttons: [],
    })
  }

  function openEditTodoModal(todoId: number) {
    const t = todos.find((x: TodoOut) => x.id === todoId)
    if (!t) return
    openModal({
      eyebrow: '待办 · 编辑',
      title: '修改待办内容',
      titleMode: 'zh',
      body: <TodoAddForm
        onSubmit={async (data) => {
          try {
            await updateTodo.mutateAsync({ todoId, data })
            showToast('已保存')
          } catch (err: unknown) {
            showToast('保存失败：' + (err as Error).message)
            throw err
          }
        }}
        onClose={closeModal}
        initialTitle={t.title}
        initialDescription={t.description || ''}
      />,
      buttons: [],
    })
  }

  function openCompleteTodoModal(todoId: number) {
    const t = todos.find((x: TodoOut) => x.id === todoId)
    if (!t) return
    openModal({
      eyebrow: '待办 · 完成',
      title: '标记此待办为完成？',
      titleMode: 'zh',
      body: (
        <div>
          <p>待办 <em>{t.title}</em> 将标记为「已完成」。</p>
          <p style={{ color: 'var(--ink-faded)', fontSize: '12px' }}>完成后不可再改回，请确认。</p>
        </div>
      ),
      buttons: [
        { label: '再想想', className: 'btn btn--ghost', action: () => {} },
        {
          label: '确认完成',
          className: 'btn btn--primary',
          action: async () => {
            try {
              await completeTodo.mutateAsync(todoId)
              showToast('已完成')
            } catch (err: unknown) { showToast('操作失败：' + (err as Error).message) }
          },
        },
      ],
    })
  }

  function handleAbandonTodo(todoId: number) {
    const t = todos.find((x: TodoOut) => x.id === todoId)
    openModal({
      eyebrow: '确认',
      title: '废弃此待办？',
      titleMode: 'zh',
      body: <p>待办 <em>{t?.title}</em> 将标记为「已废弃」，不再可勾选完成。</p>,
      buttons: [
        { label: '再想想', className: 'btn btn--ghost', action: () => {} },
        {
          label: '确认废弃',
          className: 'btn btn--danger',
          action: async () => {
            try {
              await abandonTodo.mutateAsync(todoId)
              showToast('已废弃')
            } catch (err: unknown) { showToast('操作失败：' + (err as Error).message) }
          },
        },
      ],
    })
  }

  function handleDeleteTodo(todoId: number) {
    const t = todos.find((x: TodoOut) => x.id === todoId)
    openModal({
      eyebrow: '确认',
      title: '删除此待办？',
      titleMode: 'zh',
      body: <p>待办 <em>{t?.title}</em> 将被永久删除，无法恢复。</p>,
      buttons: [
        { label: '取消', className: 'btn btn--ghost', action: () => {} },
        {
          label: '确认删除',
          className: 'btn btn--danger',
          action: async () => {
            try {
              await deleteTodo.mutateAsync(todoId)
              showToast('已删除')
            } catch (err: unknown) { showToast('删除失败：' + (err as Error).message) }
          },
        },
      ],
    })
  }

  return {
    openStatusModal,
    openCancelModal,
    handleDeleteLog,
    openAddTodoModal,
    openEditTodoModal,
    openCompleteTodoModal,
    handleAbandonTodo,
    handleDeleteTodo,
  }
}
