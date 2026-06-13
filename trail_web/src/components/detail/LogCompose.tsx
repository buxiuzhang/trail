import { useState, useRef, useEffect } from 'react'
import type { LogOut, TaskOut } from '@/types'
import { TODAY } from '@/constants'
import { usePolish, LLM_AVAILABLE } from '@/api/llm'
import { usePlaceholders, DEFAULT_PLACEHOLDERS } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { Select } from '@/components/shared/Select'
import { DescriptionEditorWithMode as DescriptionEditor } from '@/components/shared/DescriptionEditorWithMode'
import { ModeToggleButton } from '@/components/shared/ModeToggleButton'
import polishIcon from '@/icons/polish.svg'
import styles from './Logbook.module.css'

interface LogComposeProps {
  task: TaskOut
  editing: LogOut | null
  onSave: (data: { log_date: string; content: string; phase: string }) => Promise<void>
  onCancel: () => void
}

export function LogCompose({ task, editing, onSave, onCancel }: LogComposeProps) {
  // 封版（已完成+非维护 或 已作废）→ 不渲染日志表单
  if (task.status === '已作废' || (task.status === '已完成' && task.nature !== '维护')) return null
  const isEdit = !!editing
  const [logDate, setLogDate] = useState(editing?.log_date || TODAY)
  const [phase, setPhase] = useState(editing?.phase || (task.nature === '维护' ? 'maintenance' : 'main'))
  const [content, setContent] = useState(editing?.content || '')
  const [polishedFrom, setPolishedFrom] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const polishMutation = usePolish()
  const { showToast } = useToastContext()
  const { data: placeholders } = usePlaceholders()

  useEffect(() => {
    if (isEdit && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isEdit])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return
    setSubmitting(true)
    try {
      await onSave({ log_date: logDate, content: trimmed, phase })
      setContent('')
      setPolishedFrom(null)
      if (!isEdit) setLogDate(TODAY)
    } catch {
      // error toasted by parent
    } finally {
      setSubmitting(false)
    }
  }

  async function handlePolish() {
    const raw = content.trim()
    if (!raw) { showToast('先写点内容再润色'); return }
    if (polishedFrom !== null) {
      setContent(polishedFrom)
      setPolishedFrom(null)
      return
    }
    try {
      const result = await polishMutation.mutateAsync({ content: raw, task_id: task.id })
      setPolishedFrom(raw)
      setContent(result.polished)
    } catch (err: any) {
      const hint = err.status === 503
        ? '（未配置 LLM）'
        : err.status === 502 ? '（调用失败）' : ''
      showToast('润色失败：' + err.message + hint)
    }
  }

  return (
    <form className={styles.compose} onSubmit={handleSubmit}>
      <div className={styles.composeRow}>
        <label>日期</label>
        <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)} required />
        <label>阶段</label>
        <Select
          className={styles.phaseSelect}
          value={phase}
          options={[
            { value: 'main', label: 'main · 主体' },
            { value: 'maintenance', label: 'maintenance · 维护' },
          ]}
          onChange={setPhase}
        />
        <ModeToggleButton mode={mode} onModeChange={setMode} style={{ marginLeft: 'auto' }} />
      </div>
      <DescriptionEditor
        ref={textareaRef}
        mode={mode}
        onModeChange={setMode}
        hideInlineToggle
        placeholder={placeholders?.log || DEFAULT_PLACEHOLDERS.log}
        value={content}
        onChange={setContent}
        rows={3}
        minHeight={80}
        textareaClassName=""
      />
      <div className={styles.composeFoot}>
        <span className={styles.composeHint}>
          {isEdit ? `编辑中 · № ${String(editing!.id).padStart(3, '0')}` : '可改 · 可软删'}
        </span>
        <div className={styles.composeActions}>
          {isEdit && (
            <button type="button" className={styles.btnCancel} onClick={onCancel}>
              取消
            </button>
          )}
          <button
            type="button"
            className={styles.btnPolish}
            onClick={handlePolish}
            disabled={!LLM_AVAILABLE || polishMutation.isPending}
            title={LLM_AVAILABLE ? (polishedFrom !== null ? '撤销润色' : undefined) : 'LLM 暂未接入新后端'}
          >
            <img
              src={polishIcon}
              alt=""
              className={`${styles.polishIcon} ${polishedFrom !== null ? styles.polishIconActive : ''}`}
            />
          </button>
          <button type="submit" className={styles.btnSave} disabled={submitting}>
            {isEdit ? '保存' : '落档'}
          </button>
        </div>
      </div>
    </form>
  )
}
