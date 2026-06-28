import { useState, useRef } from 'react'
import {
  useReportTemplates, useCreateReportTemplate, useUpdateReportTemplate, useDeleteReportTemplate,
  type ReportTemplate, type ReportTemplateSaveRequest,
} from '@/api/reportTemplates'
import { useConfirm } from '@/utils/confirm'
import { useToastContext } from '@/context/ToastContext'
import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer'
import EditIcon from '@/icons/edit.svg'
import DeleteIcon from '@/icons/delete.svg'
import LockIcon from '@/icons/lock.svg'
import UnlockIcon from '@/icons/unlock.svg'
import styles from '@/components/settings/SkillsSection.module.css'

interface FormState {
  name: string
  description: string
  template: string
}

const EMPTY_FORM: FormState = { name: '', description: '', template: '' }

function templateToForm(t: ReportTemplate): FormState {
  return {
    name: t.name,
    description: t.description ?? '',
    template: t.template,
  }
}

export function ReportTemplatesSection() {
  const { data: templates = [], isLoading } = useReportTemplates()
  const createTemplate = useCreateReportTemplate()
  const updateTemplate = useUpdateReportTemplate()
  const deleteTemplate = useDeleteReportTemplate()
  const confirm = useConfirm()
  const { showToast } = useToastContext()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [templateMode, setTemplateMode] = useState<'source' | 'preview'>('source')
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
    setTemplateMode('source')
    setShowForm(true)
    scrollToForm()
  }

  function openEdit(tpl: ReportTemplate) {
    setEditingId(tpl.id)
    setForm(templateToForm(tpl))
    setTemplateMode('source')
    setShowForm(true)
    scrollToForm()
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload: ReportTemplateSaveRequest = {
      name: form.name,
      description: form.description || undefined,
      template: form.template,
    }
    try {
      if (editingId) {
        await updateTemplate.mutateAsync({ id: editingId, ...payload })
        showToast('模板已更新')
      } else {
        await createTemplate.mutateAsync(payload)
        showToast('模板已添加')
      }
      closeForm()
    } catch (err: unknown) {
      showToast((err as Error).message ?? '保存失败')
    }
  }

  async function handleDelete(tpl: ReportTemplate) {
    const ok = await confirm({
      level: 'dangerous',
      title: `删除「${tpl.name}」？`,
      body: <p>此操作不可撤销，模板配置将被永久删除。</p>,
      confirmLabel: '删除',
    })
    if (!ok) return
    try {
      await deleteTemplate.mutateAsync(tpl.id)
      showToast('已删除')
    } catch (err: unknown) {
      showToast((err as Error).message ?? '删除失败')
    }
  }

  async function handleToggle(tpl: ReportTemplate) {
    try {
      await updateTemplate.mutateAsync({
        id: tpl.id,
        name: tpl.name,
        template: tpl.template,
        enabled: tpl.enabled ? 0 : 1,
      })
    } catch (err: unknown) {
      showToast((err as Error).message ?? '操作失败')
    }
  }

  if (isLoading) return <div className={styles.empty}>加载中…</div>

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        自定义报表模板，在导出时按模板格式生成 Markdown 内容，支持周报、月报、年报等任意格式。
      </p>

      {templates.length === 0 && !showForm && (
        <div className={styles.empty}>暂无模板，点击下方按钮添加第一个</div>
      )}

      <div className={styles.list}>
        {templates.map((tpl, index) => (
          <div key={tpl.id} className={`${styles.card} ${!tpl.enabled ? styles.cardDisabled : ''}`}>
            <span className={styles.cardIndex}>{index + 1}</span>
            <div className={styles.cardMain}>
              <div className={styles.cardInfo}>
                <span className={styles.cardName}>{tpl.name}</span>
              </div>
              <div className={styles.cardActions}>
                <button
                  type="button"
                  className={styles.iconBtn}
                  title={tpl.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
                  onClick={() => handleToggle(tpl)}
                >
                  <img src={tpl.enabled ? UnlockIcon : LockIcon} width={16} height={16} alt={tpl.enabled ? '已启用' : '已禁用'} style={{ opacity: tpl.enabled ? 0.7 : 0.3 }} />
                </button>
                <button type="button" className={styles.iconBtn} onClick={() => openEdit(tpl)} title="编辑">
                  <img src={EditIcon} width={16} height={16} alt="编辑" />
                </button>
                <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleDelete(tpl)} title="删除">
                  <img src={DeleteIcon} width={16} height={16} alt="删除" />
                </button>
              </div>
            </div>
            {tpl.description && (
              <div className={styles.cardDesc}>{tpl.description}</div>
            )}
            <div className={styles.promptPreview}>{tpl.template.slice(0, 120)}{tpl.template.length > 120 ? '…' : ''}</div>
          </div>
        ))}
      </div>

      {showForm && (
        <form ref={formRef} className={`${styles.form} ${editingId ? styles.formActive : ''}`} onSubmit={handleSubmit}>
          {editingId && (
            <img src={EditIcon} width={14} height={14} alt="" aria-hidden="true" className={styles.formEditIcon} />
          )}
          <div className={styles.formTitle}>{editingId ? '编辑模板' : '添加模板'}</div>

          <div className={styles.field}>
            <label className={styles.label}>名称</label>
            <input
              className={styles.input}
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="例：月报、年报、项目总结"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>描述（可选）</label>
            <input
              className={styles.input}
              value={form.description}
              onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
              placeholder="简短描述模板用途"
            />
          </div>

          <div className={styles.field}>
            <div className={styles.promptHeader}>
              <label className={styles.label}>模板格式（Markdown）</label>
              <button
                type="button"
                className={styles.modeToggle}
                onClick={() => setTemplateMode(m => m === 'source' ? 'preview' : 'source')}
              >
                {templateMode === 'source' ? '预览模式' : '源码模式'}
              </button>
            </div>
            {templateMode === 'preview' ? (
              <div className={styles.promptPreviewFull}>
                {form.template
                  ? <MarkdownRenderer text={form.template} />
                  : <span style={{ color: 'var(--ink-ghost)', fontStyle: 'italic' }}>（空）</span>}
              </div>
            ) : (
              <textarea
                className={styles.textarea}
                value={form.template}
                onChange={e => {
                  setForm(p => ({ ...p, template: e.target.value }))
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
                placeholder={'输入 Markdown 模板，AI 会按此格式汇总日志数据…\n例：\n# 月报\n## 本月工作概况\n## 主要成果\n## 下月计划'}
                rows={12}
                required
              />
            )}
          </div>

          <div className={styles.formActions}>
            <button type="button" className={styles.btn} onClick={closeForm}>取消</button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={createTemplate.isPending || updateTemplate.isPending}>
              {editingId ? '保存修改' : '添加'}
            </button>
          </div>
        </form>
      )}

      {!showForm && (
        <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.addBtn}`} onClick={openCreate}>
          + 添加模板
        </button>
      )}
    </div>
  )
}
