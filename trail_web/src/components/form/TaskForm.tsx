import { useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TaskOut, ContactIn, ContactOut } from '@/types'
import { TODAY } from '@/constants'
import { useCreateTask, useUpdateTask } from '@/api/tasks'
import { usePolish, LLM_AVAILABLE } from '@/api/llm'
import { usePlaceholders, DEFAULT_PLACEHOLDERS } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { FormField } from './FormField'
import { ContactRow } from './ContactRow'
import { DescriptionEditorWithMode as DescriptionEditor, type EditorMode } from '@/components/shared/DescriptionEditorWithMode'
import { ModeToggleButton } from '@/components/shared/ModeToggleButton'
import polishIcon from '@/icons/polish.svg'
import styles from './TaskForm.module.css'

interface TaskFormProps {
  mode: 'new' | 'edit'
  task?: TaskOut
}

/** ContactOut → ContactIn（去除 id/task_id/created_at） */
function toContactIn(c: ContactOut): ContactIn {
  return { kind: c.kind, channel: c.channel, name: c.name, target: c.target || undefined, note: c.note || undefined }
}

function emptyContact(): ContactIn {
  return { kind: 'person', channel: 'wechat', name: '' }
}

const STAMP_CLASS: Record<string, string> = {
  '未开始': 'stamp--ns',
  '进行中': 'stamp--ip',
  '已完成': 'stamp--dn',
  '已作废': 'stamp--cn',
}
function statusToStampClass(s: string): string {
  return STAMP_CLASS[s] || 'stamp--ns'
}

const NATURE_BADGE_CLASS: Record<string, string> = {
  '长期': 'nature-badge--lt',
  '临时': 'nature-badge--tp',
  '维护': 'nature-badge--mt',
}
function natureToBadgeClass(n: string): string {
  return NATURE_BADGE_CLASS[n] || 'nature-badge--tp'
}

export function TaskForm({ mode, task }: TaskFormProps) {
  const navigate = useNavigate()
  const { showToast } = useToastContext()
  const createTask = useCreateTask()
  const updateTask = useUpdateTask(task?.id || 0)
  const polishMutation = usePolish()
  const { data: placeholders } = usePlaceholders()

  const isEdit = mode === 'edit'
  const taskId = task?.id

  // 表单状态
  const [title, setTitle] = useState(task?.title || '')
  const [alias, setAlias] = useState(task?.alias || '')
  const [startDate, setStartDate] = useState(task?.start_date || TODAY)
  const [processingDate, setProcessingDate] = useState(task?.processing_date || '')
  const [description, setDescription] = useState(task?.description || '')
  const [polishedDescFrom, setPolishedDescFrom] = useState<string | null>(null) // 润色撤销用
  const [endDate, setEndDate] = useState(task?.end_date || '')
  const [tagsStr, setTagsStr] = useState((task?.tags || []).join(', '))
  const [contacts, setContacts] = useState<ContactIn[]>(
    task?.contacts?.length ? task.contacts.map(toContactIn) : [emptyContact()]
  )
  const [submitting, setSubmitting] = useState(false)
  const [editorMode, setEditorMode] = useState<EditorMode>('preview')

  // 对接渠道操作
  const handleContactChange = useCallback((index: number, field: keyof ContactIn, value: string) => {
    setContacts(prev => {
      const next = [...prev]
      next[index] = { ...next[index], [field]: value }
      return next
    })
  }, [])

  const handleContactDelete = useCallback((index: number) => {
    setContacts(prev => prev.filter((_, i) => i !== index))
  }, [])

  function addContact() {
    setContacts(prev => [...prev, emptyContact()])
  }

  async function handlePolishDesc() {
    const raw = description.trim()
    if (!raw) { showToast('先写点内容再润色'); return }
    if (polishedDescFrom !== null) {
      setDescription(polishedDescFrom)
      setPolishedDescFrom(null)
      return
    }
    try {
      const result = await polishMutation.mutateAsync({ content: raw, task_id: taskId })
      setPolishedDescFrom(raw)
      setDescription(result.polished)
    } catch (err: any) {
      const hint = err.status === 503
        ? '（未配置 LLM）'
        : err.status === 502 ? '（LLM 调用失败）' : ''
      showToast('润色失败：' + err.message + hint)
    }
  }

  // 提交
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    // 过滤空联系人行
    const validContacts = contacts.filter(c => c.name.trim())
    const tags = tagsStr.split(/[,，、\s]+/).map(s => s.trim()).filter(Boolean)

    setSubmitting(true)
    try {
      if (isEdit && taskId) {
        await updateTask.mutateAsync({
          title: trimmedTitle,
          alias: alias.trim() || undefined,
          description: description.trim() || undefined,
          start_date: startDate || undefined,
          processing_date: processingDate || undefined,
          end_date: task?.status === '已完成' ? (endDate || TODAY) : (endDate || undefined),
          tags,
          contacts: validContacts.length > 0 ? validContacts : undefined,
        })
        // 状态变更统一走详情页的专用按钮+状态机，编辑表单不传 status
        showToast('已保存')
        navigate(`/task/${taskId}`)
      } else {
        const newTask = await createTask.mutateAsync({
          title: trimmedTitle,
          alias: alias.trim() || undefined,
          description: description.trim() || undefined,
          start_date: startDate || undefined,
          processing_date: processingDate || undefined,
          tags,
          contacts: validContacts,
        })
        showToast('已落档')
        navigate(`/task/${newTask.id}`)
      }
    } catch (err: any) {
      showToast((isEdit ? '保存失败：' : '落档失败：') + err.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <article className={styles.formPage}>
      <nav className="crumbs">
        <a href={isEdit ? `#/task/${taskId}` : '#/'}>
          {isEdit ? '返回详情' : '编年档'}
        </a>
        <span className="crumbs__sep">/</span>
        <span>{isEdit ? '编辑条目' : '新建条目'}</span>
      </nav>

      <form className={styles.formCard} onSubmit={handleSubmit}>
        <header className={styles.hd}>
          <h1 className={`${styles.title} ${styles.titleZh}`}>
            {isEdit ? '编辑条目' : '新建条目'}
          </h1>
          <span className={styles.no}>
            {isEdit ? `№ ${String(taskId)}` : '№ 待定'}
          </span>
        </header>

        {/* 身份栏：只读状态 + 性质 */}
        <div className={styles.identityBar}>
          <div className={styles.identityRow}>
            <span className={`stamp ${statusToStampClass(isEdit ? (task?.status || '') : '未开始')}`}>
              {isEdit ? task?.status : '未开始'}
            </span>
            <span className={styles.identityDot}>·</span>
            <span className={`nature-badge ${natureToBadgeClass(isEdit ? (task?.nature || '临时') : '临时')}`}>
              {isEdit ? task?.nature : '临时'}
            </span>
          </div>
          {!isEdit && (
            <div className={styles.identityHint}>
              <span>添加日志后自动转入进行中</span>
              <span className={styles.identityDot}>·</span>
              <span>超过一月自动转长期 · 完成时可含维护期</span>
            </div>
          )}
        </div>

        <FormField label="任务标题" required>
          <input
            className="field__input"
            value={title}
            onChange={e => setTitle(e.target.value)}
            placeholder="例：TDengine 时序数据库整库告警监控"
            required
          />
        </FormField>

        <div className="field-row">
          <FormField label="任务别名" hint="口头沟通用">
            <input
              className="field__input"
              value={alias}
              onChange={e => setAlias(e.target.value)}
              placeholder="例：TDengine告警"
            />
          </FormField>
          <FormField label="任务开始" hint="默认今天">
            <input
              className="field__input"
              type="date"
              value={startDate}
              onChange={e => setStartDate(e.target.value)}
            />
          </FormField>
          <FormField label="开始处理">
            <input
              className="field__input"
              type="date"
              value={processingDate}
              onChange={e => setProcessingDate(e.target.value)}
            />
          </FormField>
        </div>

        <FormField
          label="任务描述"
          labelAction={
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
              <ModeToggleButton mode={editorMode} onModeChange={setEditorMode} />
              <button
                type="button"
                onClick={handlePolishDesc}
                disabled={!LLM_AVAILABLE || polishMutation.isPending}
                title={LLM_AVAILABLE ? (polishedDescFrom !== null ? '撤销润色' : 'AI 润色描述') : 'LLM 暂未接入新后端'}
                className={styles.polishBtn}
              >
                <img
                  src={polishIcon}
                  alt=""
                  className={`${styles.polishIcon} ${polishedDescFrom !== null ? styles.polishIconActive : ''}`}
                />
              </button>
            </div>
          }
        >
          <DescriptionEditor
            mode={editorMode}
            onModeChange={setEditorMode}
            hideInlineToggle
            value={description}
            onChange={setDescription}
            placeholder={placeholders?.task_desc || DEFAULT_PLACEHOLDERS.task_desc}
            minHeight={120}
          />
        </FormField>

        {/* 编辑模式下已完成任务：显示完成时间 */}
        {isEdit && task?.status === '已完成' && (
          <FormField label="完成时间" hint="可手动覆盖">
            <input
              className="field__input"
              type="date"
              value={endDate}
              onChange={e => setEndDate(e.target.value)}
            />
          </FormField>
        )}

        <FormField label="对接渠道" hint="可多行 · 钉钉/微信/elink/邮箱/电话">
          <div className={styles.contactsBlock}>
            {contacts.map((c, i) => (
              <ContactRow
                key={i}
                contact={c}
                index={i}
                onChange={handleContactChange}
                onDelete={handleContactDelete}
              />
            ))}
            <button type="button" className={`btn btn--ghost ${styles.contactsAddBtn}`} onClick={addContact}>
              ＋ 添加对接渠道
            </button>
          </div>
        </FormField>

        <FormField label="标签（逗号 / 顿号 / 空格分隔）">
          <input
            className="field__input"
            value={tagsStr}
            onChange={e => setTagsStr(e.target.value)}
            placeholder="监控, 钉钉, 时序"
          />
        </FormField>

        <div className={styles.foot}>
          <span className={styles.footSig}>
            — {isEdit ? '改即存档' : '入档即正典'} —
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <a
              href={isEdit ? `#/task/${taskId}` : '#/'}
              className="btn btn--ghost"
              style={{ textDecoration: 'none' }}
            >
              取消
            </a>
            <button type="submit" className="btn btn--primary" disabled={submitting}>
              {submitting ? '保存中...' : isEdit ? '保 存' : '落 档'}
            </button>
          </div>
        </div>
      </form>
    </article>
  )
}
