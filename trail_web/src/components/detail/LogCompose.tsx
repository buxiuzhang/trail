import { useState, useRef, useEffect, useMemo } from 'react'
import type { LogOut, TaskOut, TodoOut } from '@/types'
import { TODAY } from '@/constants'
import { useDraftLog, LLM_AVAILABLE } from '@/api/llm'
import { usePolishContent } from '@/hooks/usePolishContent'
import { usePlaceholders, DEFAULT_PLACEHOLDERS } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { useModalContext } from '@/context/ModalContext'
import { useAttachmentsByIds } from '@/api/attachments'
import { Select } from '@/components/shared/Select'
import { DescriptionEditorWithMode as DescriptionEditor } from '@/components/shared/DescriptionEditorWithMode'
import { ModeToggleButton } from '@/components/shared/ModeToggleButton'
import { TodoRefSection } from '@/components/detail/TodoRefSection'
import { extractTodoMentionIds, extractTaskRefIds } from '@/components/shared/richtext-utils'
import polishIcon from '@/icons/polish.svg'
import draftIcon from '@/icons/draft.svg'
import styles from './Logbook.module.css'

interface LogComposeProps {
  task: TaskOut
  todos: TodoOut[]
  /** 全局任务列表（用于 @ 任务引用） */
  tasks?: TaskOut[]
  editing: LogOut | null
  onSave: (data: { log_date: string; content: string; phase: string; hours: number; todo_ids: number[]; task_ids: number[] }) => Promise<void>
  onCancel: () => void
  saveDisabled?: boolean
  saveLabel?: string
  defaultLogDate?: string
  confirmBeforeSave?: boolean
}

export function LogCompose({ task, todos, tasks = [], editing, onSave, onCancel, saveDisabled, saveLabel, defaultLogDate, confirmBeforeSave }: LogComposeProps) {
  // 封版（已完成+非维护 或 已作废）→ 不渲染日志表单
  if (task.status === '已作废' || (task.status === '已完成' && task.nature !== '维护')) return null
  const isEdit = !!editing
  const [logDate, setLogDate] = useState(editing?.log_date || defaultLogDate || TODAY)
  const [phase, setPhase] = useState(editing?.phase || (task.nature === '维护' ? 'maintenance' : 'main'))
  const [hours, setHours] = useState(editing?.hours || 1)
  const [content, setContent] = useState(editing?.content || '')
  const [selectedTodoIds, setSelectedTodoIds] = useState<number[]>(editing?.todo_ids || [])
  const [selectedTaskIds, setSelectedTaskIds] = useState<number[]>(editing?.task_ids || [])
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'preview' | 'source'>('preview')
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftInput, setDraftInput] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const draftInputRef = useRef<HTMLTextAreaElement>(null)
  const polishLog = usePolishContent({ task_id: task.id })
  const draftMutation = useDraftLog(task.id)
  const { showToast } = useToastContext()
  const { openModal, closeModal } = useModalContext()
  const { data: placeholders } = usePlaceholders()

  const fileIds = useMemo(() => {
    const ids: number[] = []
    const re = /@file:(\d+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) ids.push(Number(m[1]))
    return ids
  }, [content])
  const { data: attList = [] } = useAttachmentsByIds(fileIds)
  const attachments = useMemo(() => {
    const map = new Map<number, { name: string; mime: string }>()
    attList.forEach((a: any) => map.set(a.id, { name: a.original_name || `文件 #${a.id}`, mime: a.mime }))
    return map
  }, [attList])

  useEffect(() => {
    if (isEdit && textareaRef.current) {
      textareaRef.current.focus()
    }
  }, [isEdit])

  useEffect(() => {
    if (draftOpen && draftInputRef.current) {
      draftInputRef.current.focus()
      draftInputRef.current.style.height = 'auto'
      draftInputRef.current.style.height = draftInputRef.current.scrollHeight + 'px'
    }
  }, [draftOpen])

  // 内容变化时同步 @ 提及 ID，使 TodoRefSection 与编辑器联动（双向）
  useEffect(() => {
    setSelectedTodoIds(extractTodoMentionIds(content))
    setSelectedTaskIds(extractTaskRefIds(content))
  }, [content])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = content.trim()
    if (!trimmed) return

    // 编辑模式：二次确认
    if (isEdit) {
      openModal({
        eyebrow: '确认',
        title: '保存此编辑？',
        titleMode: 'zh',
        body: <p>日志 № {String(editing!.id).padStart(3, '0')} 的修改将被保存。</p>,
        buttons: [
          { label: '取消', className: 'btn btn--ghost', action: () => {} },
          {
            label: '确认保存',
            className: 'btn btn--primary',
            action: async () => {
              await doSave(trimmed)
            },
          },
        ],
      })
      return
    }

    // 新建模式且需要二次确认
    if (!isEdit && confirmBeforeSave) {
      openModal({
        eyebrow: '确认',
        title: '落档此条日志？',
        titleMode: 'zh',
        body: <p>日志将写入「{task.title}」，落档后可在任务详情中修改或软删。</p>,
        buttons: [
          { label: '取消', className: 'btn btn--ghost', action: () => {} },
          {
            label: '确认落档',
            className: 'btn btn--primary',
            action: async () => { await doSave(trimmed) },
          },
        ],
      })
      return
    }

    // 新建模式：直接保存
    await doSave(trimmed)
  }

  async function doSave(contentToSave: string) {
    setSubmitting(true)
    try {
      const mentionTodoIds = extractTodoMentionIds(contentToSave)
      const mentionTaskIds = extractTaskRefIds(contentToSave)
      const allTodoIds = [...new Set([...mentionTodoIds, ...selectedTodoIds])]
      const allTaskIds = [...new Set([...mentionTaskIds, ...selectedTaskIds])]
      await onSave({ log_date: logDate, content: contentToSave, phase, hours, todo_ids: allTodoIds, task_ids: allTaskIds })
      setContent('')
      polishLog.reset()
      setSelectedTodoIds([])
      setSelectedTaskIds([])
      setDraftInput('')
      setDraftOpen(false)
      if (!isEdit) setLogDate(TODAY)
    } catch {
      // error toasted by parent
    } finally {
      setSubmitting(false)
    }
  }

  async function handleDraftGenerate() {
    if (!draftInput.trim()) { showToast('请先输入几个关键词'); return }
    try {
      const result = await draftMutation.mutateAsync(draftInput.trim())
      setContent(result.polished)
      setDraftOpen(false)
      setDraftInput('')
    } catch (err: any) {
      const hint = err.status === 503 ? '（未配置 LLM）' : err.status === 502 ? '（调用失败）' : ''
      showToast('草稿生成失败：' + err.message + hint)
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
        <label>工时</label>
        <div className={styles.hoursStepper}>
          <button
            type="button"
            className={styles.hoursStepBtn}
            onClick={() => setHours(h => Math.max(0.5, parseFloat((h - 0.5).toFixed(1))))}
            tabIndex={-1}
          >−</button>
          <input
            type="number"
            step="0.5"
            min="0.5"
            max="11.5"
            value={hours}
            onChange={e => setHours(parseFloat(e.target.value) || 1)}
            className={styles.hoursInput}
          />
          <button
            type="button"
            className={styles.hoursStepBtn}
            onClick={() => setHours(h => Math.min(11.5, parseFloat((h + 0.5).toFixed(1))))}
            tabIndex={-1}
          >+</button>
        </div>
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
        minHeight={150}
        autoGrow
        textareaClassName=""
        todos={todos}
        tasks={tasks}
        attachments={attachments}
      />
      {draftOpen && (
        <div className={styles.draftSection}>
          <div className={styles.draftHeader}>
            <span className={styles.draftLabel}>草稿</span>
            <span className={styles.draftHint}>简单描述今天做了什么，LLM 结合任务背景生成日志草稿</span>
            <button
              type="button"
              className={styles.draftClose}
              onClick={() => setDraftOpen(false)}
              title="关闭草稿"
              aria-label="关闭草稿"
            >
              <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className={styles.draftInputRow}>
            <textarea
              ref={draftInputRef}
              className={styles.draftInput}
              placeholder="例：完成了接口联调，修了一个并发 bug，下午开了需求评审会…"
              value={draftInput}
              rows={1}
              onChange={e => {
                setDraftInput(e.target.value)
                const el = e.currentTarget
                el.style.height = 'auto'
                el.style.height = el.scrollHeight + 'px'
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleDraftGenerate()
              }}
            />
          </div>
        </div>
      )}
      {/* 内部 onChange 同时清理编辑器中的 @mention 文本，保持联动 */}
      <TodoRefSection
        todos={todos}
        selectedTodoIds={selectedTodoIds}
        onChangeTodo={(ids) => {
          const removed = selectedTodoIds.filter(id => !ids.includes(id))
          setSelectedTodoIds(ids)
          if (removed.length === 0) return
          setContent(c => {
            let cleaned = c
            for (const id of removed) {
              cleaned = cleaned.replace(new RegExp(`@todo:${id}\\s?`, 'g'), '')
            }
            // 清理残缺引用（无合法整数 ID 的 @todo: 片段）
            cleaned = cleaned.replace(/@todo:(?!\d+(?:\s|$))\S*\s?/g, '')
            return cleaned.trim()
          })
        }}
        tasks={tasks}
        selectedTaskIds={selectedTaskIds}
        onChangeTask={(ids) => {
          const removed = selectedTaskIds.filter(id => !ids.includes(id))
          setSelectedTaskIds(ids)
          if (removed.length === 0) return
          setContent(c => {
            let cleaned = c
            for (const id of removed) {
              cleaned = cleaned.replace(new RegExp(`@task:${id}\\s?`, 'g'), '')
            }
            cleaned = cleaned.replace(/@task:(?!\d+(?:\s|$))\S*\s?/g, '')
            return cleaned.trim()
          })
        }}
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
          {(() => {
            const isGenMode = draftOpen && !!draftInput.trim()
            const isDraftActive = draftOpen && !!content.trim()
            return (
              <button
                type="button"
                className={styles.btnDraft}
                disabled={!LLM_AVAILABLE || draftMutation.isPending}
                data-tooltip={
                  !LLM_AVAILABLE ? 'LLM 暂未接入' :
                  draftMutation.isPending ? '生成中…' :
                  isGenMode ? '⌘Enter 生成草稿' :
                  isDraftActive ? '草稿（已打开）' : '生成日志草稿'
                }
                onClick={() => {
                  if (!draftOpen) {
                    setDraftInput(content.trim())
                    setDraftOpen(true)
                  } else if (isGenMode) {
                    handleDraftGenerate()
                  } else {
                    setDraftOpen(false)
                  }
                }}
              >
                <img
                  src={draftIcon}
                  alt=""
                  className={[
                    styles.draftIcon,
                    isDraftActive ? styles.draftIconActive : '',
                    isGenMode ? styles.draftIconGen : '',
                    draftMutation.isPending ? styles.draftIconPending : '',
                  ].filter(Boolean).join(' ')}
                />
              </button>
            )
          })()}
          <button
            type="button"
            className={styles.btnPolish}
            onClick={() => polishLog.handlePolish(content, setContent)}
            disabled={!LLM_AVAILABLE || polishLog.isPending}
            data-tooltip={LLM_AVAILABLE ? (polishLog.isPolished ? '撤销润色' : '润色') : 'LLM 暂未接入'}
          >
            <img
              src={polishIcon}
              alt=""
              className={`${styles.polishIcon} ${polishLog.isPolished ? styles.polishIconActive : ''}`}
            />
          </button>
          <button type="submit" className={styles.btnSave} disabled={submitting || !content.trim() || saveDisabled}>
            {saveLabel ?? (isEdit ? '保存' : '落档')}
          </button>
        </div>
      </div>
    </form>
  )
}