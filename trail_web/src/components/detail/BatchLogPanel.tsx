import { useState, useEffect, useRef, useMemo } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTasks } from '@/api/tasks'
import { useCreateLog } from '@/api/logs'
import { useTodos } from '@/api/todos'
import { useAttachmentsByIds } from '@/api/attachments'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import { usePolishContent } from '@/hooks/usePolishContent'
import { useDraftLog, LLM_AVAILABLE } from '@/api/llm'
import { usePlaceholders, DEFAULT_PLACEHOLDERS } from '@/api/settings'
import polishIcon from '@/icons/polish.svg'
import draftIcon from '@/icons/draft.svg'
import { api } from '@/api/client'
import type { TaskOut } from '@/types'
import { DescriptionEditorWithMode, type EditorMode } from '@/components/shared/DescriptionEditorWithMode'
import { Select } from '@/components/shared/Select'
import { TaskSelectorRow } from '@/components/shared/TaskSelectorRow'
import styles from './BatchLogPanel.module.css'
import logStyles from './Logbook.module.css'

interface ParsedEntry {
  task_title: string | null
  content: string
  hours: number
  phase: string
  log_date: string
  taskId?: number | null
}

interface Props {
  defaultDate: string
  onClose: () => void
  onSubmitted: () => void
}

interface EntryCardProps {
  index: number
  entry: ParsedEntry
  tasks: TaskOut[]
  mode: EditorMode
  placeholder: string
  onUpdate: (patch: Partial<ParsedEntry>) => void
  onRemove: () => void
  onModeChange: (m: EditorMode) => void
}

function EntryCard({ index, entry, tasks, mode, placeholder, onUpdate, onRemove, onModeChange }: EntryCardProps) {
  const [draftOpen, setDraftOpen] = useState(false)
  const [draftInput, setDraftInput] = useState('')
  const draftInputRef = useRef<HTMLTextAreaElement>(null)
  const { showToast } = useToastContext()
  const polishLog = usePolishContent({ task_id: entry.taskId ?? undefined })
  const draftMutation = useDraftLog(entry.taskId ?? 0)
  const { data: todos = [] } = useTodos(entry.taskId ?? 0)

  const fileIds = useMemo(() => {
    const ids: number[] = []
    const re = /@file:(\d+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(entry.content)) !== null) ids.push(Number(m[1]))
    return ids
  }, [entry.content])
  const { data: attList = [] } = useAttachmentsByIds(fileIds)
  const attachments = useMemo(() => {
    const map = new Map<number, { name: string; mime: string }>()
    attList.forEach((a: any) => map.set(a.id, { name: a.original_name || `文件 #${a.id}`, mime: a.mime }))
    return map
  }, [attList])

  useEffect(() => {
    if (draftOpen && draftInputRef.current) {
      draftInputRef.current.focus()
      draftInputRef.current.style.height = 'auto'
      draftInputRef.current.style.height = draftInputRef.current.scrollHeight + 'px'
    }
  }, [draftOpen])

  async function handleDraftGenerate() {
    if (!draftInput.trim()) { showToast('请先输入几个关键词'); return }
    try {
      const result = await draftMutation.mutateAsync(draftInput.trim())
      onUpdate({ content: result.polished })
      setDraftOpen(false)
      setDraftInput('')
    } catch (err: any) {
      const hint = err.status === 503 ? '（未配置 LLM）' : err.status === 502 ? '（调用失败）' : ''
      showToast('草稿生成失败：' + err.message + hint)
    }
  }

  return (
    <div className={`${styles.entryCard} ${!entry.taskId ? styles.entryUnmatched : ''}`}>
      <span className={styles.entryIndex}>{index}</span>
      <button className={styles.removeBtn} onMouseDown={e => e.preventDefault()} onClick={onRemove}>✕</button>
      <TaskSelectorRow
        tasks={tasks}
        taskId={entry.taskId ?? null}
        onChange={(id, task) => onUpdate({ taskId: id, task_title: task?.title ?? null })}
      />
      <div className={`${logStyles.composeRow} ${styles.entryComposeRow}`}>
        <label>日期</label>
        <input
          type="date"
          value={entry.log_date}
          onChange={e => onUpdate({ log_date: e.target.value })}
          required
        />
        <label>阶段</label>
        <Select
          className={styles.phaseSelect}
          value={entry.phase}
          options={[
            { value: 'main', label: 'main · 主体' },
            { value: 'maintenance', label: 'maintenance · 维护' },
          ]}
          onChange={v => onUpdate({ phase: v })}
        />
        <label>工时</label>
        <div className={logStyles.hoursStepper}>
          <button
            type="button"
            className={logStyles.hoursStepBtn}
            onClick={() => onUpdate({ hours: Math.max(0.5, parseFloat((entry.hours - 0.5).toFixed(1))) })}
            tabIndex={-1}
          >−</button>
          <input
            type="number"
            className={logStyles.hoursInput}
            value={entry.hours}
            step={0.5}
            min={0.5}
            max={12}
            onChange={e => onUpdate({ hours: parseFloat(e.target.value) || 1 })}
          />
          <button
            type="button"
            className={logStyles.hoursStepBtn}
            onClick={() => onUpdate({ hours: Math.min(12, parseFloat((entry.hours + 0.5).toFixed(1))) })}
            tabIndex={-1}
          >+</button>
        </div>
      </div>
      <DescriptionEditorWithMode
        value={entry.content}
        onChange={v => onUpdate({ content: v })}
        mode={mode}
        onModeChange={onModeChange}
        placeholder={placeholder}
        minHeight={60}
        autoGrow
        textareaClassName={styles.entryContent}
        todos={todos}
        tasks={tasks}
        attachments={attachments}
      />
      {draftOpen && (
        <div className={logStyles.draftSection}>
          <div className={logStyles.draftHeader}>
            <span className={logStyles.draftLabel}>草稿</span>
            <span className={logStyles.draftHint}>简单描述今天做了什么，LLM 结合任务背景生成日志草稿</span>
            <button type="button" className={logStyles.draftClose} onClick={() => setDraftOpen(false)}>
              <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                <path d="M3 3l10 10M13 3L3 13" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
          <div className={logStyles.draftInputRow}>
            <textarea
              ref={draftInputRef}
              className={logStyles.draftInput}
              placeholder="例：完成了接口联调，修了一个并发 bug…"
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
      <div className={`${logStyles.composeFoot} ${styles.entryFoot}`}>
        <span className={logStyles.composeHint} />
        <div className={logStyles.composeActions}>
          {(() => {
            const isGenMode = draftOpen && !!draftInput.trim()
            const isDraftActive = draftOpen && !!entry.content.trim()
            return (
              <button
                type="button"
                className={logStyles.btnDraft}
                disabled={!LLM_AVAILABLE || !entry.taskId || draftMutation.isPending}
                data-tooltip={
                  !LLM_AVAILABLE ? 'LLM 暂未接入' :
                  !entry.taskId ? '请先选择任务' :
                  draftMutation.isPending ? '生成中…' :
                  isGenMode ? '⌘Enter 生成草稿' :
                  isDraftActive ? '草稿（已打开）' : '生成日志草稿'
                }
                onClick={() => {
                  if (!draftOpen) { setDraftInput(entry.content.trim()); setDraftOpen(true) }
                  else if (isGenMode) handleDraftGenerate()
                  else setDraftOpen(false)
                }}
              >
                <img
                  src={draftIcon}
                  alt=""
                  className={[
                    logStyles.draftIcon,
                    isDraftActive ? logStyles.draftIconActive : '',
                    isGenMode ? logStyles.draftIconGen : '',
                    draftMutation.isPending ? logStyles.draftIconPending : '',
                  ].filter(Boolean).join(' ')}
                />
              </button>
            )
          })()}
          <button
            type="button"
            className={logStyles.btnPolish}
            onClick={() => polishLog.handlePolish(entry.content, v => onUpdate({ content: v }))}
            disabled={!LLM_AVAILABLE || polishLog.isPending || !entry.taskId}
            data-tooltip={
              !LLM_AVAILABLE ? 'LLM 暂未接入' :
              !entry.taskId ? '请先选择任务' :
              polishLog.isPolished ? '撤销润色' : '润色'
            }
          >
            <img
              src={polishIcon}
              alt=""
              className={`${logStyles.polishIcon} ${polishLog.isPolished ? logStyles.polishIconActive : ''}`}
            />
          </button>
        </div>
      </div>
    </div>
  )
}

export function BatchLogPanel({ defaultDate, onClose, onSubmitted }: Props) {
  const { data: tasks = [] } = useTasks()
  const { showToast } = useToastContext()
  const confirm = useConfirm()

  const STORAGE_KEY = 'batch_log_draft'

  function loadDraft() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (!raw) return null
      return JSON.parse(raw) as { step: 'input' | 'review'; rawText: string; entries: ParsedEntry[]; date: string }
    } catch { return null }
  }

  function saveDraft(patch: Partial<{ step: 'input' | 'review'; rawText: string; entries: ParsedEntry[]; date: string }>) {
    try {
      const prev = loadDraft() ?? { step: 'input', rawText: '', entries: [], date: defaultDate }
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...prev, ...patch }))
    } catch {}
  }

  function clearDraft() {
    localStorage.removeItem(STORAGE_KEY)
  }

  const draft = loadDraft()
  const [step, setStepRaw] = useState<'input' | 'review'>(draft?.step ?? 'input')
  const [rawText, setRawTextRaw] = useState(draft?.rawText ?? '')
  const [rawMode, setRawMode] = useState<EditorMode>('preview')
  const [tagging, setTagging] = useState(false)
  const [entries, setEntriesRaw] = useState<ParsedEntry[]>(draft?.entries ?? [])
  const [entryModes, setEntryModes] = useState<EditorMode[]>((draft?.entries ?? []).map(() => 'preview' as EditorMode))
  const [submitting, setSubmitting] = useState(false)
  const [date, setDateRaw] = useState(draft?.date ?? defaultDate)

  function setStep(s: 'input' | 'review') { setStepRaw(s); saveDraft({ step: s }) }
  function setRawText(t: string) { setRawTextRaw(t); saveDraft({ rawText: t }) }
  function setEntries(fn: ParsedEntry[] | ((prev: ParsedEntry[]) => ParsedEntry[])) {
    setEntriesRaw(prev => {
      const next = typeof fn === 'function' ? fn(prev) : fn
      saveDraft({ entries: next })
      return next
    })
  }
  function setDate(d: string) { setDateRaw(d); saveDraft({ date: d }) }

  const activeTasks = tasks.filter(t => t.status === '进行中')
  const { data: placeholders } = usePlaceholders()

  const rawFileIds = useMemo(() => {
    const ids: number[] = []
    const re = /@file:(\d+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(rawText)) !== null) ids.push(Number(m[1]))
    return ids
  }, [rawText])
  const { data: rawAttList = [] } = useAttachmentsByIds(rawFileIds)
  const rawAttachments = useMemo(() => {
    const map = new Map<number, { name: string; mime: string }>()
    rawAttList.forEach((a: any) => map.set(a.id, { name: a.original_name || `文件 #${a.id}`, mime: a.mime }))
    return map
  }, [rawAttList])

  useEffect(() => {
    if (step === 'review') {
      setEntries(prev => prev.map(e => ({ ...e, log_date: date })))
    }
  }, [date])

  async function handleTag() {
    if (!rawText.trim()) return
    setTagging(true)
    try {
      const result = await api.post<{ text: string }>('/api/llm/batch-tag', {
        text: rawText,
        task_ids: activeTasks.map(t => t.id),
      })
      setRawText(result.text)
    } catch {
      showToast('AI 标注失败，请重试', 'error')
    } finally {
      setTagging(false)
    }
  }

  function handleSplit() {
    const segments = rawText.split(/(?=@task:\d+)/g).map(s => s.trim()).filter(Boolean)
    const parsed: ParsedEntry[] = segments.map(seg => {
      const match = seg.match(/^@task:(\d+)\s*\n?([\s\S]*)/)
      if (match) {
        const taskId = Number(match[1])
        const content = match[2].trim()
        const task = activeTasks.find(t => t.id === taskId) ?? null
        return { task_title: task?.title ?? null, content, hours: 1, phase: 'main', log_date: date, taskId: task ? taskId : null }
      }
      return { task_title: null, content: seg, hours: 1, phase: 'main', log_date: date, taskId: null }
    })
    if (!parsed.length) { showToast('未识别到任何条目', 'error'); return }
    setEntries(parsed)
    setEntryModes(parsed.map(() => 'preview' as EditorMode))
    setStep('review')
  }

  async function handleSubmitAll() {
    const valid = entries.filter(e => e.taskId)
    if (!valid.length) { showToast('没有可提交的条目', 'error'); return }
    const ok = await confirm({
      title: `落档 ${valid.length} 条日志？`,
      body: <p>将向 {new Set(valid.map(e => e.taskId)).size} 个任务写入日志，落档后可在任务详情中修改或软删。</p>,
      confirmLabel: '确认落档',
    })
    if (!ok) return
    setSubmitting(true)
    let done = 0
    for (const e of valid) {
      try {
        await api.post(`/api/tasks/${e.taskId}/logs`, {
          log_date: e.log_date,
          content: e.content,
          hours: e.hours,
          phase: e.phase,
        })
        done++
      } catch {
        showToast(`「${e.task_title}」提交失败`, 'error')
      }
    }
    setSubmitting(false)
    if (done > 0) {
      showToast(`已提交 ${done} 条日志`)
      clearDraft()
      onSubmitted()
      onClose()
    }
  }

  function updateEntry(idx: number, patch: Partial<ParsedEntry>) {
    setEntries(prev => prev.map((e, i) => i === idx ? { ...e, ...patch } : e))
  }

  function removeEntry(idx: number) {
    setEntries(prev => prev.filter((_, i) => i !== idx))
    setEntryModes(prev => prev.filter((_, i) => i !== idx))
  }

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <div className={styles.drawer}>
        <div className={styles.drawerHeader}>
          <span className={styles.drawerTitle}>批量填报</span>
          <input
            type="date"
            className={styles.dateInput}
            value={date}
            onChange={e => setDate(e.target.value)}
          />
          <button className={styles.closeBtn} onClick={onClose}>✕</button>
        </div>

        {step === 'input' ? (
          <div className={styles.inputStep}>
            <div className={styles.inputToolbar}>
              <p className={styles.hint}>
                粘贴今日工作内容，用 @ 引用任务，或点击「AI 标注」自动识别。
              </p>
              <button
                className={styles.btnTag}
                onClick={handleTag}
                disabled={tagging || !rawText.trim()}
              >
                {tagging ? '标注中…' : 'AI 标注'}
              </button>
            </div>
            <div className={styles.editorWrap}>
              <DescriptionEditorWithMode
                value={rawText}
                onChange={setRawText}
                mode={rawMode}
                onModeChange={setRawMode}
                placeholder="粘贴今日工作内容…"
                minHeight={200}
                autoGrow
                textareaClassName=""
                tasks={tasks}
                attachments={rawAttachments}
              />
            </div>
            <div className={styles.actions}>
              <button
                className={styles.btnPrimary}
                onClick={handleSplit}
                disabled={!rawText.trim()}
              >
                下一步
              </button>
            </div>
          </div>
        ) : (
          <div className={styles.reviewStep}>
            <div className={styles.reviewHint}>
              共识别 <strong>{entries.length}</strong> 条，请确认任务归属和工时后提交。
            </div>
            <div className={styles.entryList}>
              {entries.map((entry, idx) => (
                <EntryCard
                  key={idx}
                  index={idx + 1}
                  entry={entry}
                  tasks={activeTasks}
                  mode={entryModes[idx] ?? 'preview'}
                  placeholder={placeholders?.log ?? DEFAULT_PLACEHOLDERS.log}
                  onUpdate={patch => updateEntry(idx, patch)}
                  onRemove={() => removeEntry(idx)}
                  onModeChange={m => setEntryModes(prev => prev.map((em, i) => i === idx ? m : em))}
                />
              ))}
            </div>
            <div className={styles.actions}>
              <button className={styles.btnGhost} onClick={() => setStep('input')}>← 重新解析</button>
              <button
                className={styles.btnPrimary}
                onClick={handleSubmitAll}
                disabled={submitting || entries.every(e => !e.taskId)}
              >
                {submitting ? '提交中…' : `提交全部 (${entries.filter(e => e.taskId).length})`}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
