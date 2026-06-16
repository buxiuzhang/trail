import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useTask, useUpdateTask, useChangeTaskStatus, useCancelTask } from '@/api/tasks'
import { useLogs, useCreateLog, useUpdateLog, useDeleteLog } from '@/api/logs'
import { useTodos, useCreateTodo, useUpdateTodo, useCompleteTodo, useAbandonTodo, useDeleteTodo } from '@/api/todos'
import { usePlaceholders, DEFAULT_PLACEHOLDERS } from '@/api/settings'
import { usePolish, LLM_AVAILABLE } from '@/api/llm'
import { useModalContext } from '@/context/ModalContext'
import { useToastContext } from '@/context/ToastContext'
import { ALLOWED_TRANSITIONS } from '@/constants'
import { Crumbs } from '@/components/shared/Crumbs'
import { EmptyState } from '@/components/detail/EmptyState'
import { DetailHeader } from '@/components/detail/DetailHeader'
import { MetaPane } from '@/components/detail/MetaPane'
import { Logbook } from '@/components/detail/Logbook'
import { TodoSection } from '@/components/detail/TodoSection'
import { DescriptionEditorWithMode as DescriptionEditor, type EditorMode } from '@/components/shared/DescriptionEditorWithMode'
import { ModeToggleButton } from '@/components/shared/ModeToggleButton'
import polishIcon from '@/icons/polish.svg'
import type { LogOut, TodoOut } from '@/types'

/** 添加/编辑待办弹窗内的表单子组件。
 *  "保存" → 提交后关闭弹窗；"保存并继续添加" → 提交后清空表单继续。
 *  initialTitle/initialDescription 用于编辑模式，填充初始值。 */
function TodoAddForm({ onSubmit, onClose, initialTitle = '', initialDescription = '' }: {
  onSubmit: (data: { title: string; description?: string }) => Promise<void>
  onClose: () => void
  initialTitle?: string
  initialDescription?: string
}) {
  const { data: placeholders } = usePlaceholders()
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [polishedFrom, setPolishedFrom] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [hoverClose, setHoverClose] = useState(false)
  const [hoverContinue, setHoverContinue] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('preview')

  const polishMutation = usePolish()
  const { showToast } = useToastContext()

  const interactive = !submitting && title.trim()

  async function handlePolish() {
    const raw = description.trim()
    if (!raw) { showToast('先写点内容再润色'); return }
    if (polishedFrom !== null) {
      setDescription(polishedFrom)
      setPolishedFrom(null)
      return
    }
    try {
      const result = await polishMutation.mutateAsync({ content: raw, type: 'todo' })
      setPolishedFrom(raw)
      setDescription(result.polished)
    } catch (err: any) {
      const hint = err.status === 503
        ? '（未配置 LLM）'
        : err.status === 502 ? '（调用失败）' : ''
      showToast('润色失败：' + err.message + hint)
    }
  }

  async function handleSubmit(andContinue: boolean) {
    if (!title.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ title: title.trim(), description: description.trim() || undefined })
      if (andContinue) {
        setTitle('')
        setDescription('')
        setPolishedFrom(null)
        const input = document.getElementById('todo-add-form')?.querySelector('input')
        input?.focus()
      } else {
        onClose()
      }
    } catch {
      // onSubmit 回调已负责 toast 错误提示，此处仅吞掉异常
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form
      id="todo-add-form"
      onSubmit={e => e.preventDefault()}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div className="field" style={{ marginBottom: 0 }}>
        <div className="field__label">
          <span>待办标题</span>
          <span className="field__hint">必填</span>
        </div>
        <input
          className="field__input"
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder="例：对接 XX 平台 API"
          autoFocus
          required
        />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <div className="field__label">
          <span>补充说明</span>
          <span className="field__hint">可选</span>
          <ModeToggleButton mode={editorMode} onModeChange={setEditorMode} style={{ marginLeft: 'auto' }} />
          <button
            type="button"
            onClick={handlePolish}
            disabled={!LLM_AVAILABLE || polishMutation.isPending}
            title={LLM_AVAILABLE ? (polishedFrom !== null ? '撤销润色' : 'AI 润色') : 'LLM 暂未接入'}
            style={{
              background: 'none',
              border: 'none',
              padding: '0 0 0 8px',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              opacity: LLM_AVAILABLE ? 1 : 0.3,
            }}
          >
            <img
              src={polishIcon}
              alt=""
              style={{
                width: 16,
                height: 16,
                opacity: polishedFrom !== null ? 0.85 : 0.4,
              }}
            />
          </button>
        </div>
        <DescriptionEditor
          mode={editorMode}
          onModeChange={setEditorMode}
          hideInlineToggle
          value={description}
          onChange={setDescription}
          placeholder={placeholders?.todo_note || DEFAULT_PLACEHOLDERS.todo_note}
          rows={4}
          minHeight={80}
        />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--ink-ghost)' }}>
          — 添加后可在列表中勾选或废弃 —
        </span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button
            type="button"
            disabled={!interactive}
            onClick={() => handleSubmit(true)}
            onMouseEnter={() => setHoverContinue(true)}
            onMouseLeave={() => setHoverContinue(false)}
            style={{
              fontFamily: 'var(--body)',
              fontSize: hoverContinue ? '14.5px' : '14px',
              fontStyle: 'italic',
              color: !interactive ? 'var(--ink-ghost)' : hoverContinue ? 'var(--green-ink)' : 'var(--ink)',
              background: !interactive ? 'transparent' : hoverContinue ? 'var(--card)' : 'var(--card-deep)',
              border: 'none',
              borderRadius: '3px',
              padding: '8px 18px',
              cursor: interactive ? 'pointer' : 'default',
              transition: 'font-size 250ms ease, background 250ms ease, color 250ms ease',
            }}
          >
            {submitting ? '添加中…' : '继续添加'}
          </button>
          <button
            type="button"
            disabled={!interactive}
            onClick={() => handleSubmit(false)}
            onMouseEnter={() => setHoverClose(true)}
            onMouseLeave={() => setHoverClose(false)}
            style={{
              fontFamily: 'var(--body)',
              fontSize: hoverClose ? '14.5px' : '14px',
              fontStyle: 'italic',
              color: !interactive ? 'var(--ink-ghost)' : hoverClose ? 'var(--ink)' : 'var(--ink-faded)',
              background: 'none',
              border: 'none',
              padding: '6px 0',
              cursor: interactive ? 'pointer' : 'default',
              transition: 'font-size 250ms ease, color 250ms ease',
            }}
          >
            {submitting ? '添加中…' : '保存并关闭'}
          </button>
        </div>
      </div>
    </form>
  )
}

function catalogOf(id: number, createdAt: string | null): string {
  if (!createdAt) return `#${id}`
  const y = createdAt.slice(0, 4)
  return `${y}-${String(id).padStart(3, '0')}`
}

export function DetailPage() {
  const { id } = useParams<{ id: string }>()
  const taskId = Number(id)
  const navigate = useNavigate()
  const { openModal, closeModal } = useModalContext()
  const { showToast } = useToastContext()

  const { data: task, isLoading, error } = useTask(taskId)
  const { data: logs = [] } = useLogs(taskId)
  const { data: todos = [] } = useTodos(taskId)
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

  if (isLoading) return <EmptyState glyph="⋯" title="调阅中..." subtitle="正在调取档案" />
  if (error || !task) return <EmptyState glyph="!" title="档案不存在" subtitle={(error as Error)?.message || '该任务可能已被删除'} />

  const activeLogs = logs.filter((l: LogOut) => !l.is_deleted)
  const lastLogDate = activeLogs.length > 0 ? activeLogs[activeLogs.length - 1].log_date : null
  const catalog = catalogOf(task.id, task.created_at)

  // ── 日志操作 ──
  async function handleSaveNew(data: { log_date: string; content: string; phase: string; hours: number }) {
    await createLog.mutateAsync(data)
    // 首次记录时自动设置 processing_date
    if (!task!.processing_date) {
      await updateTask.mutateAsync({ processing_date: data.log_date })
    }
    showToast('已落档')
  }

  async function handleSaveEdit(logId: number, data: { log_date: string; content: string; phase: string; hours: number }) {
    await updateLog.mutateAsync({ logId, data })
    showToast('已保存')
  }

  function handleDelete(logId: number) {
    openModal({
      eyebrow: '确认',
      title: '软删此条日志？',
      titleMode: 'zh',
      body: <p>删除后可在后续版本中恢复。日志 № {String(logId).padStart(3, '0')}</p>,
      buttons: [
        { label: '取消', className: 'btn btn--ghost', action: () => {} },
        {
          label: '确认软删',
          className: 'btn btn--danger',
          action: async () => {
            try {
              await deleteLog.mutateAsync(logId)
              showToast('已软删')
            } catch (err: any) {
              showToast('删除失败：' + err.message)
            }
          },
        },
      ],
    })
  }

  // ── 状态变更 ──
  function openStatusModal() {
    // 已完成 + 维护 → 结束维护·封版（nature: 维护 → 长期）
    if (task!.status === '已完成' && task!.nature === '维护') {
      openModal({
        eyebrow: '封版询问',
        title: '结束维护期？',
        titleMode: 'zh',
        body: (
          <div>
            <p>任务 <em>{task!.title}</em> 已完成，当前处于维护期。</p>
            <p>结束后将<em style={{ color: 'var(--oxblood)' }}>封版</em>，不能再添加日志。</p>
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
              } catch (err: any) { showToast('操作失败：' + err.message) }
            },
          },
        ],
      })
      return
    }

    const targets = [...(ALLOWED_TRANSITIONS[task!.status] || new Set())]
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
            <p>将任务 <em>{task!.title}</em> 标记为完成。</p>
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
                await changeStatus.mutateAsync({
                  new_status: '已完成',
                  end_date: new Date().toISOString().slice(0, 10),
                  maintenance: true,
                })
                showToast('已进入维护期')
              } catch (err: any) { showToast('操作失败：' + err.message) }
            },
          },
          {
            label: '不再维护',
            className: 'btn',
            action: async () => {
              try {
                await changeStatus.mutateAsync({
                  new_status: '已完成',
                  end_date: new Date().toISOString().slice(0, 10),
                })
                showToast('任务已完成')
              } catch (err: any) { showToast('操作失败：' + err.message) }
            },
          },
        ],
      })
    } else {
      // 其他转移：让用户选择目标状态
      openModal({
        eyebrow: '状态变更',
        title: '选择新状态',
        titleMode: 'zh',
        body: (
          <ul>
            {targets.map(t => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        ),
        buttons: targets.map(t => ({
          label: t,
          className: t === '已作废' ? 'btn btn--danger' : 'btn',
          action: async () => {
            try {
              await changeStatus.mutateAsync({ new_status: t })
              showToast(`状态已变更为「${t}」`)
            } catch (err: any) { showToast('操作失败：' + err.message) }
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
          <p>此操作将把 <em>{task!.title}</em> 标记为「已作废」。</p>
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
              await cancelTask.mutateAsync(undefined as any)
              showToast('已作废')
            } catch (err: any) { showToast('操作失败：' + err.message) }
          },
        },
      ],
    })
  }

  // ── Todo 操作 ──
  /** 打开「添加待办」弹窗（带 form）。弹窗内用 TodoAddForm 子组件管 state。 */
  function openAddTodoModal() {
    if (task!.status === '已作废' || (task!.status === '已完成' && task!.nature !== '维护')) {
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
          } catch (err: any) {
            showToast('添加失败：' + err.message)
            throw err // 重新抛出，让表单组件恢复 submitting 状态
          }
        }}
        onClose={closeModal}
      />,
      buttons: [],
    })
  }

  /** 编辑待办弹窗。 */
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
          } catch (err: any) {
            showToast('保存失败：' + err.message)
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

  /** 勾选完成 → 弹窗二次确认。 */
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
            } catch (err: any) { showToast('操作失败：' + err.message) }
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
            } catch (err: any) { showToast('操作失败：' + err.message) }
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
            } catch (err: any) { showToast('删除失败：' + err.message) }
          },
        },
      ],
    })
  }

  return (
    <article className="detail">
      <Crumbs items={[{ label: '编年档', href: '/' }, { label: `CAT. № ${catalog}` }]} />

      <DetailHeader
        task={task}
        catalog={catalog}
        logCount={activeLogs.length}
      />

      <TodoSection
        task={task}
        todos={todos}
        onRequestAdd={openAddTodoModal}
        onRequestComplete={openCompleteTodoModal}
        onRequestEdit={openEditTodoModal}
        onAbandon={handleAbandonTodo}
        onDelete={handleDeleteTodo}
      />

      <div className={`detail__body ${metaCollapsed ? 'detail__body--collapsed' : ''}`}>
        <MetaPane
          task={task}
          lastLogDate={lastLogDate}
          collapsed={metaCollapsed}
          onToggleCollapse={() => setMetaCollapsed(!metaCollapsed)}
          onAddLog={() => {
            const ta = document.querySelector('.logbook textarea') as HTMLTextAreaElement
            ta?.focus()
          }}
          onChangeStatus={openStatusModal}
          onCancel={openCancelModal}
        />

        <Logbook
          task={task}
          logs={activeLogs}
          onSaveNew={handleSaveNew}
          onSaveEdit={handleSaveEdit}
          onDelete={handleDelete}
          onAddLogFocus={false}
        />
      </div>
    </article>
  )
}
