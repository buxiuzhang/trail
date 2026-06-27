import { useState } from 'react'
import { usePlaceholders, DEFAULT_PLACEHOLDERS } from '@/api/settings'
import { LLM_AVAILABLE } from '@/api/llm'
import { usePolish } from '@/hooks/usePolish'
import { DescriptionEditorWithMode as DescriptionEditor, type EditorMode } from '@/components/shared/DescriptionEditorWithMode'
import { ModeToggleButton } from '@/components/shared/ModeToggleButton'
import polishIcon from '@/icons/polish.svg'

interface TodoAddFormProps {
  onSubmit: (data: { title: string; description?: string }) => Promise<void>
  onClose: () => void
  initialTitle?: string
  initialDescription?: string
}

export function TodoAddForm({ onSubmit, onClose, initialTitle = '', initialDescription = '' }: TodoAddFormProps) {
  const { data: placeholders } = usePlaceholders()
  const polish = usePolish()
  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [submitting, setSubmitting] = useState(false)
  const [hoverClose, setHoverClose] = useState(false)
  const [hoverContinue, setHoverContinue] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('preview')

  const interactive = !submitting && title.trim()

  async function handleSubmit(andContinue: boolean) {
    if (!title.trim() || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ title: title.trim(), description: description.trim() || undefined })
      if (andContinue) {
        setTitle('')
        setDescription('')
        const input = document.getElementById('todo-add-form')?.querySelector('input')
        input?.focus()
      } else {
        onClose()
      }
    } catch {
      // onSubmit 回调已负责 toast 错误提示
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form id="todo-add-form" onSubmit={e => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="field" style={{ marginBottom: 0 }}>
        <div className="field__label">
          <span>待办标题</span>
          <span className="field__hint">必填</span>
        </div>
        <input className="field__input" value={title} onChange={e => setTitle(e.target.value)} placeholder="例：对接 XX 平台 API" autoFocus required />
      </div>
      <div className="field" style={{ marginBottom: 0 }}>
        <div className="field__label">
          <span>补充说明</span>
          <span className="field__hint">可选</span>
          <ModeToggleButton mode={editorMode} onModeChange={setEditorMode} style={{ marginLeft: 'auto' }} />
          <button
            type="button"
            onClick={() => polish({
                type: 'todo',
                initialContent: description,
                onAdopt: (suggestion) => setDescription(suggestion),
              })}
            disabled={!LLM_AVAILABLE || !description.trim()}
            title={LLM_AVAILABLE ? 'AI 对话润色' : 'LLM 暂未接入'}
            style={{ background: 'none', border: 'none', padding: '0 0 0 8px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', opacity: LLM_AVAILABLE ? 1 : 0.3 }}
          >
            <img src={polishIcon} alt="" style={{ width: 16, height: 16, opacity: 0.65 }} />
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
        <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--ink-ghost)' }}>— 添加后可在列表中勾选或废弃 —</span>
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          <button type="button" disabled={!interactive} onClick={() => handleSubmit(true)}
            onMouseEnter={() => setHoverContinue(true)} onMouseLeave={() => setHoverContinue(false)}
            style={{ fontFamily: 'var(--body)', fontSize: hoverContinue ? '14.5px' : '14px', fontStyle: 'italic',
              color: !interactive ? 'var(--ink-ghost)' : hoverContinue ? 'var(--green-ink)' : 'var(--ink)',
              background: !interactive ? 'transparent' : hoverContinue ? 'var(--card)' : 'var(--card-deep)',
              border: 'none', borderRadius: '3px', padding: '8px 18px', cursor: interactive ? 'pointer' : 'default',
              transition: 'font-size 250ms ease, background 250ms ease, color 250ms ease' }}>
            {submitting ? '添加中…' : '继续添加'}
          </button>
          <button type="button" disabled={!interactive} onClick={() => handleSubmit(false)}
            onMouseEnter={() => setHoverClose(true)} onMouseLeave={() => setHoverClose(false)}
            style={{ fontFamily: 'var(--body)', fontSize: hoverClose ? '14.5px' : '14px', fontStyle: 'italic',
              color: !interactive ? 'var(--ink-ghost)' : hoverClose ? 'var(--ink)' : 'var(--ink-faded)',
              background: 'none', border: 'none', padding: '6px 0', cursor: interactive ? 'pointer' : 'default',
              transition: 'font-size 250ms ease, color 250ms ease' }}>
            {submitting ? '添加中…' : '保存并关闭'}
          </button>
        </div>
      </div>
    </form>
  )
}

