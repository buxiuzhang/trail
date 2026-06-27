import { useState, useEffect, useRef, useMemo } from 'react'
import { useTasks } from '@/api/tasks'
import { useTodos } from '@/api/todos'
import { useAttachmentsByIds } from '@/api/attachments'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import { usePolishContent } from '@/hooks/usePolishContent'
import { LLM_AVAILABLE } from '@/api/llm'
import { usePlaceholders, DEFAULT_PLACEHOLDERS } from '@/api/settings'
import polishIcon from '@/icons/polish.svg'
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
  const polishLog = usePolishContent({ task_id: entry.taskId ?? undefined })
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
    attList.forEach((a) => map.set(a.id, { name: a.original_name || `文件 #${a.id}`, mime: a.mime }))
    return map
  }, [attList])

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
      <div className={`${logStyles.composeFoot} ${styles.entryFoot}`}>
        <span className={logStyles.composeHint} />
        <div className={logStyles.composeActions}>
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
    } catch { /* localStorage unavailable */ }
  }

  function clearDraft() {
    localStorage.removeItem(STORAGE_KEY)
  }

  const draft = loadDraft()
  const [step, setStepRaw] = useState<'input' | 'review'>(draft?.step ?? 'input')
  const [rawText, setRawTextRaw] = useState(draft?.rawText ?? '')
  const [rawMode, setRawMode] = useState<EditorMode>('preview')
  const [tagging, setTagging] = useState(false)
  const [taggedFrom, setTaggedFrom] = useState<string | null>(null)
  const isProgrammaticRef = useRef(false)
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

  const { data: placeholders } = usePlaceholders()
  const rawEditorRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (step === 'input') {
      setTimeout(() => rawEditorRef.current?.focus(), 50)
    }
  }, [step])

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
    rawAttList.forEach((a) => map.set(a.id, { name: a.original_name || `文件 #${a.id}`, mime: a.mime }))
    return map
  }, [rawAttList])

  useEffect(() => {
    if (step === 'review') {
      setEntries(prev => prev.map(e => ({ ...e, log_date: date })))
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, step])

  async function handleTag() {
    // 已标注时点击撤回
    if (taggedFrom !== null) {
      isProgrammaticRef.current = true
      setRawText(taggedFrom)
      setTaggedFrom(null)
      return
    }
    const text = rawText.trim()
    if (!text) return
    setTagging(true)
    try {
      const result = await api.post<{ text: string }>('/api/llm/batch-tag', { text })
      setTaggedFrom(rawText)
      isProgrammaticRef.current = true
      setRawText(result.text)
    } catch {
      showToast('AI 标注失败，请重试')
    } finally {
      setTagging(false)
    }
  }

  function handleSplit() {
    const currentText = rawText.trim()
    if (!currentText) { showToast('内容为空'); return }
    const segments = currentText.split(/(?=@task:\d+)/g).map(s => s.trim()).filter(Boolean)
    const parsed: ParsedEntry[] = segments.map(seg => {
      const match = seg.match(/^@task:(\d+)\s*\n?([\s\S]*)/)
      if (match) {
        const taskId = Number(match[1])
        const content = match[2].trim()
        const task = tasks.find(t => t.id === taskId) ?? null
        return { task_title: task?.title ?? null, content, hours: 1, phase: 'main', log_date: date, taskId: task ? taskId : null }
      }
      return { task_title: null, content: seg, hours: 1, phase: 'main', log_date: date, taskId: null }
    })
    if (!parsed.length) { showToast('未识别到任何条目'); return }
    setEntries(parsed)
    setEntryModes(parsed.map(() => 'preview' as EditorMode))
    setStep('review')
  }

  async function handleSubmitAll() {
    const valid = entries.filter(e => e.taskId)
    if (!valid.length) { showToast('没有可提交的条目'); return }
    const ok = await confirm({
      title: `落档 ${valid.length} 条日报？`,
      body: <p>将向 {new Set(valid.map(e => e.taskId)).size} 个任务写入日报，落档后可在任务详情中修改或软删。</p>,
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
        showToast(`「${e.task_title}」提交失败`)
      }
    }
    setSubmitting(false)
    if (done > 0) {
      showToast(`已提交 ${done} 条日报`)
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
          <span className={styles.drawerTitle}>今日填报</span>
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
                disabled={tagging || (taggedFrom === null && !rawText.trim())}
              >
                {tagging ? '标注中…' : taggedFrom !== null ? '撤回标注' : 'AI 标注'}
              </button>
            </div>
            <div className={styles.editorWrap}>
              <DescriptionEditorWithMode
                ref={rawEditorRef}
                value={rawText}
                onChange={v => {
                  setRawText(v)
                  if (isProgrammaticRef.current) {
                    isProgrammaticRef.current = false
                  } else if (taggedFrom !== null) {
                    setTaggedFrom(null)
                  }
                }}
                mode={rawMode}
                onModeChange={setRawMode}
                placeholder={placeholders?.log ?? DEFAULT_PLACEHOLDERS.log}
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
              <a href="#/new" className={styles.reviewNewTask} target="_self">+ 新建任务</a>
            </div>
            <div className={styles.entryList}>
              {entries.map((entry, idx) => (
                <EntryCard
                  key={idx}
                  index={idx + 1}
                  entry={entry}
                  tasks={tasks}
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
