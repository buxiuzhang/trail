import { useState, useEffect } from 'react'
import { usePlaceholders, useSavePlaceholders, DEFAULT_PLACEHOLDERS } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import styles from '@/pages/SettingsPage.module.css'

export function PlaceholdersSection() {
  const { showToast } = useToastContext()
  const confirm = useConfirm()
  const { data: placeholders, isLoading: placeholdersLoading } = usePlaceholders({ enabled: true })
  const savePlaceholders = useSavePlaceholders()

  const [taskDescDraft, setTaskDescDraft] = useState('')
  const [logDraft, setLogDraft] = useState('')
  const [todoNoteDraft, setTodoNoteDraft] = useState('')

  useEffect(() => {
    if (placeholders) {
      setTaskDescDraft(placeholders.task_desc || DEFAULT_PLACEHOLDERS.task_desc)
      setLogDraft(placeholders.log || DEFAULT_PLACEHOLDERS.log)
      setTodoNoteDraft(placeholders.todo_note || DEFAULT_PLACEHOLDERS.todo_note)
    } else if (!placeholdersLoading) {
      setTaskDescDraft(DEFAULT_PLACEHOLDERS.task_desc)
      setLogDraft(DEFAULT_PLACEHOLDERS.log)
      setTodoNoteDraft(DEFAULT_PLACEHOLDERS.todo_note)
    }
  }, [placeholders, placeholdersLoading])

  async function handleSave() {
    const ok = await confirm({
      level: 'moderate',
      title: '保存占位提示语？',
      body: <p>将保存任务描述、工作日报、补充说明的占位提示。</p>,
      confirmLabel: '保存',
    })
    if (!ok) return
    try {
      await savePlaceholders.mutateAsync({
        task_desc: taskDescDraft.trim() || DEFAULT_PLACEHOLDERS.task_desc,
        log: logDraft.trim() || DEFAULT_PLACEHOLDERS.log,
        todo_note: todoNoteDraft.trim() || DEFAULT_PLACEHOLDERS.todo_note,
      })
      showToast('占位提示语已更新')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  const resetStyle: React.CSSProperties = {
    background: 'none', border: 'none', cursor: 'pointer',
    padding: 0, fontFamily: 'inherit', fontSize: 'inherit',
    letterSpacing: 'inherit', textTransform: 'inherit' as const,
    color: 'var(--ink-ghost)',
  }

  return (
    <section id="interface-placeholders" className={styles.section}>
      <h2 className={styles.sectionTitle}>占位提示语</h2>
      <p className={styles.sectionHint}>编辑器输入框为空时显示的灰色提示文字。</p>
      {placeholdersLoading ? (
        <p className={styles.sectionHint}>载入中...</p>
      ) : (
        <>
          <div className="field">
            <div className="field__label">
              <span>任务描述</span>
              <button type="button" onClick={async () => { const ok = await confirm({ level: 'moderate', title: '重置任务描述提示语？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' }); if (ok) setTaskDescDraft(DEFAULT_PLACEHOLDERS.task_desc) }} title="恢复为默认" style={resetStyle}>重置 ↺</button>
            </div>
            <textarea className="field__textarea" value={taskDescDraft} onChange={e => setTaskDescDraft(e.target.value)} rows={2} style={{ fontSize: '13px', lineHeight: 1.6 }} />
          </div>
          <div className="field">
            <div className="field__label">
              <span>工作日报</span>
              <button type="button" onClick={async () => { const ok = await confirm({ level: 'moderate', title: '重置工作日报提示语？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' }); if (ok) setLogDraft(DEFAULT_PLACEHOLDERS.log) }} title="恢复为默认" style={resetStyle}>重置 ↺</button>
            </div>
            <textarea className="field__textarea" value={logDraft} onChange={e => setLogDraft(e.target.value)} rows={2} style={{ fontSize: '13px', lineHeight: 1.6 }} />
          </div>
          <div className="field">
            <div className="field__label">
              <span>补充说明</span>
              <button type="button" onClick={async () => { const ok = await confirm({ level: 'moderate', title: '重置补充说明提示语？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' }); if (ok) setTodoNoteDraft(DEFAULT_PLACEHOLDERS.todo_note) }} title="恢复为默认" style={resetStyle}>重置 ↺</button>
            </div>
            <textarea className="field__textarea" value={todoNoteDraft} onChange={e => setTodoNoteDraft(e.target.value)} rows={2} style={{ fontSize: '13px', lineHeight: 1.6 }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={async () => {
                const ok = await confirm({ level: 'dangerous', title: '重置所有占位提示语？', body: <p>任务描述、工作日报、补充说明的提示语将全部恢复为默认值。</p>, confirmLabel: '全部重置' })
                if (ok) {
                  setTaskDescDraft(DEFAULT_PLACEHOLDERS.task_desc)
                  setLogDraft(DEFAULT_PLACEHOLDERS.log)
                  setTodoNoteDraft(DEFAULT_PLACEHOLDERS.todo_note)
                }
              }}
            >
              全部重置
            </button>
            <button type="button" className="btn btn--primary" onClick={handleSave} disabled={savePlaceholders.isPending}>
              {savePlaceholders.isPending ? '保存中...' : '保存'}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
