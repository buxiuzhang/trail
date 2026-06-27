import { useState, useRef } from 'react'
import {
  useSkills, useCreateSkill, useUpdateSkill, useDeleteSkill,
  type Skill, type SkillSaveRequest,
} from '@/api/skills'
import { useConfirm } from '@/utils/confirm'
import { useToastContext } from '@/context/ToastContext'
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer'
import { SkillOptimizeDialog } from './SkillOptimizeDialog'
import EditIcon from '@/icons/edit.svg'
import DeleteIcon from '@/icons/delete.svg'
import styles from './SkillsSection.module.css'

const SCOPE_OPTIONS = [
  { value: 'chat',         label: '工作对话' },
  { value: 'draft',        label: '草稿生成' },
  { value: 'polish_log',   label: '日报润色' },
  { value: 'polish_task',  label: '任务描述润色' },
  { value: 'polish_todo',  label: '待办润色' },
]

interface FormState {
  name: string
  description: string
  system_prompt: string
  scope: string[]
}

const EMPTY_FORM: FormState = { name: '', description: '', system_prompt: '', scope: ['chat'] }

function parseScope(raw: string | undefined): string[] {
  if (!raw) return ['chat']
  try { return JSON.parse(raw) } catch { return ['chat'] }
}

function skillToForm(s: Skill): FormState {
  const validScopes = SCOPE_OPTIONS.map(o => o.value)
  return {
    name: s.name,
    description: s.description ?? '',
    system_prompt: s.system_prompt,
    scope: parseScope(s.scope).filter(v => validScopes.includes(v)),
  }
}

function ScopeBadges({ scope }: { scope: string }) {
  const parsed = parseScope(scope)
  return (
    <>
      {parsed.map(s => {
        const opt = SCOPE_OPTIONS.find(o => o.value === s)
        if (!opt) return null
        return (
          <span key={s} className={`${styles.scopeBadge} ${styles[`scopeBadge_${s}`] ?? ''}`}>
            {opt.label}
          </span>
        )
      })}
    </>
  )
}

export function SkillsSection() {
  const { data: skills = [], isLoading } = useSkills()
  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()
  const deleteSkill = useDeleteSkill()
  const confirm = useConfirm()
  const { showToast } = useToastContext()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [promptMode, setPromptMode] = useState<'source' | 'preview'>('source')
  const [optimizingSkill, setOptimizingSkill] = useState<Skill | null>(null)

  const formRef = useRef<HTMLFormElement>(null)

  function scrollToForm() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setPromptMode('source')
    setShowForm(true)
    scrollToForm()
  }

  function openEdit(skill: Skill) {
    setEditingId(skill.id)
    setForm(skillToForm(skill))
    setPromptMode('source')
    setShowForm(true)
    scrollToForm()
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  function toggleScope(value: string) {
    setForm(p => {
      const next = p.scope.includes(value)
        ? p.scope.filter(s => s !== value)
        : [...p.scope, value]
      return { ...p, scope: next.length === 0 ? [value] : next }
    })
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload: SkillSaveRequest = {
      name: form.name,
      description: form.description || undefined,
      system_prompt: form.system_prompt,
      scope: form.scope,
    }
    try {
      if (editingId) {
        await updateSkill.mutateAsync({ id: editingId, ...payload })
        showToast('Skill 已更新')
      } else {
        await createSkill.mutateAsync(payload)
        showToast('Skill 已添加')
      }
      closeForm()
    } catch (err: unknown) {
      showToast((err as Error).message ?? '保存失败')
    }
  }

  async function handleDelete(skill: Skill) {
    const ok = await confirm({
      level: 'dangerous',
      title: `删除「${skill.name}」？`,
      body: <p>此操作不可撤销，Skill 配置将被永久删除。</p>,
      confirmLabel: '删除',
    })
    if (!ok) return
    try {
      await deleteSkill.mutateAsync(skill.id)
      showToast('已删除')
    } catch (err: unknown) {
      showToast((err as Error).message ?? '删除失败')
    }
  }

  async function handleToggle(skill: Skill) {
    try {
      await updateSkill.mutateAsync({
        id: skill.id,
        name: skill.name,
        system_prompt: skill.system_prompt,
        enabled: skill.enabled ? 0 : 1,
      })
    } catch (err: unknown) {
      showToast((err as Error).message ?? '操作失败')
    }
  }

  if (isLoading) return <div className={styles.empty}>加载中…</div>

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        每个 Skill 是一段提示词片段，按作用范围注入到对应的 AI 调用场景。
      </p>

      {skills.length === 0 && !showForm && (
        <div className={styles.empty}>暂无 Skill，点击下方按钮添加第一个</div>
      )}

      <div className={styles.list}>
        {skills.map((skill, index) => (
          <div key={skill.id} className={`${styles.card} ${!skill.enabled ? styles.cardDisabled : ''}`}>
            <span className={styles.cardIndex}>{index + 1}</span>
            <div className={styles.cardMain}>
              <div className={styles.cardInfo}>
                <span className={styles.cardName}>{skill.name}</span>
                <ScopeBadges scope={skill.scope} />
              </div>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.optimizeBtn}
                  onClick={() => setOptimizingSkill(skill)}
                  title="智能优化"
                >✦</button>
                <label className={styles.toggle} title={skill.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}>
                  <input type="checkbox" checked={!!skill.enabled} onChange={() => handleToggle(skill)} />
                  <span className={styles.toggleSlider} />
                </label>
                <button type="button" className={styles.iconBtn} onClick={() => openEdit(skill)} title="编辑">
                  <img src={EditIcon} width={16} height={16} alt="编辑" />
                </button>
                <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleDelete(skill)} title="删除">
                  <img src={DeleteIcon} width={16} height={16} alt="删除" />
                </button>
              </div>
            </div>
            {skill.description && (
              <div className={styles.cardDesc}>{skill.description}</div>
            )}
            <div className={styles.promptPreview}>{skill.system_prompt.slice(0, 120)}{skill.system_prompt.length > 120 ? '…' : ''}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <form ref={formRef} className={`${styles.form} ${editingId ? styles.formActive : ''}`} onSubmit={handleSubmit}>
          {editingId && (
            <img src={EditIcon} width={14} height={14} alt="" aria-hidden="true" className={styles.formEditIcon} />
          )}
          <div className={styles.formTitle}>{editingId ? '编辑 Skill' : '添加 Skill'}</div>

          <div className={styles.field}>
            <label className={styles.label}>名称</label>
            <input
              className={styles.input}
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="例：工作助理"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>描述（可选）</label>
            <input
              className={styles.input}
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="简短描述这个 Skill 的用途"
            />
          </div>

          <div className={styles.field}>
            <div className={styles.promptHeader}>
              <label className={styles.label}>系统提示词</label>
              <button
                type="button"
                className={styles.modeToggle}
                onClick={() => setPromptMode(m => m === 'source' ? 'preview' : 'source')}
              >
                {promptMode === 'source' ? '预览模式' : '源码模式'}
              </button>
            </div>
            {promptMode === 'preview' ? (
              <div className={styles.promptPreviewFull}>
                {form.system_prompt
                  ? <MarkdownRenderer text={form.system_prompt} />
                  : <span style={{ color: 'var(--ink-ghost)', fontStyle: 'italic' }}>（空）</span>}
              </div>
            ) : (
              <textarea
                className={styles.textarea}
                value={form.system_prompt}
                onChange={e => {
                  setForm(p => ({ ...p, system_prompt: e.target.value }))
                  e.target.style.height = 'auto'
                  e.target.style.height = e.target.scrollHeight + 'px'
                }}
                onInput={e => {
                  const el = e.currentTarget
                  el.style.height = 'auto'
                  el.style.height = el.scrollHeight + 'px'
                }}
                ref={el => {
                  if (el) {
                    el.style.height = 'auto'
                    el.style.height = el.scrollHeight + 'px'
                  }
                }}
                placeholder="输入提示词片段，将追加到对应场景的 System Prompt 末尾…"
                rows={10}
                required
              />
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>作用范围</label>
            <div className={styles.scopePolishRow}>
              <span className={styles.scopePolishLabel}>对话与草稿</span>
              <div className={styles.scopeGroup}>
                {SCOPE_OPTIONS.filter(o => !o.value.startsWith('polish')).map(opt => {
                  const checked = form.scope.includes(opt.value)
                  return (
                    <label key={opt.value} className={`${styles.scopeOption} ${checked ? styles.scopeOptionChecked : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleScope(opt.value)} />
                      <span className={styles.scopeCheck}>{checked ? '✓' : ''}</span>
                      <span>{opt.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
            <div className={styles.scopePolishRow}>
              <span className={styles.scopePolishLabel}>润色</span>
              <div className={styles.scopeGroup}>
                {SCOPE_OPTIONS.filter(o => o.value.startsWith('polish')).map(opt => {
                  const checked = form.scope.includes(opt.value)
                  return (
                    <label key={opt.value} className={`${styles.scopeOption} ${checked ? styles.scopeOptionChecked : ''}`}>
                      <input type="checkbox" checked={checked} onChange={() => toggleScope(opt.value)} />
                      <span className={styles.scopeCheck}>{checked ? '✓' : ''}</span>
                      <span>{opt.label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>

          <div className={styles.formActions}>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={createSkill.isPending || updateSkill.isPending}>
              {editingId ? '保存修改' : '添加'}
            </button>
            <button type="button" className={styles.btn} onClick={closeForm}>取消</button>
          </div>
        </form>
      )}

      {!showForm && (
        <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.addBtn}`} onClick={openCreate}>
          + 添加 Skill
        </button>
      )}

      {optimizingSkill && (
        <SkillOptimizeDialog
          skill={optimizingSkill}
          onClose={() => setOptimizingSkill(null)}
        />
      )}
    </div>
  )
}
