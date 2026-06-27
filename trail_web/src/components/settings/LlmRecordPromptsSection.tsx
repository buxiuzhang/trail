import { useState, useEffect } from 'react'
import { useLLMSettings, useSaveLLMSettings } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import { DescriptionEditorWithMode, type EditorMode } from '@/components/shared/DescriptionEditorWithMode'
import styles from '@/pages/SettingsPage.module.css'

function PromptGroup({ name, desc, children }: { name: string; desc?: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={styles.promptGroup}>
      <button type="button" className={styles.promptGroupHeader} onClick={() => setOpen(v => !v)}>
        <span className={styles.promptGroupTitle}>{name}</span>
        {desc && <span className={styles.promptGroupBadge}>{desc}</span>}
        <span className={`${styles.promptGroupChevron} ${open ? styles.promptGroupChevronOpen : ''}`}>▾</span>
      </button>
      {open && <div className={styles.promptGroupBody}>{children}</div>}
    </div>
  )
}

export function LlmRecordPromptsSection() {
  const { showToast } = useToastContext()
  const confirm = useConfirm()
  const { data: settings, isLoading } = useLLMSettings({ enabled: true })
  const saveLLM = useSaveLLMSettings()

  const [polishPrompt, setPolishPrompt] = useState('')
  const [polishPromptMode, setPolishPromptMode] = useState<EditorMode>('preview')
  const [polishTodoPrompt, setPolishTodoPrompt] = useState('')
  const [polishTodoPromptMode, setPolishTodoPromptMode] = useState<EditorMode>('preview')
  const [polishTaskDescPrompt, setPolishTaskDescPrompt] = useState('')
  const [polishTaskDescPromptMode, setPolishTaskDescPromptMode] = useState<EditorMode>('preview')

  useEffect(() => {
    if (!settings) return
    setPolishPrompt(settings.polish_system_prompt || '')
    setPolishTodoPrompt(settings.polish_todo_system_prompt || '')
    setPolishTaskDescPrompt(settings.polish_task_desc_system_prompt || '')
  }, [settings])

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault()
    try {
      await saveLLM.mutateAsync({
        polish_system_prompt: polishPrompt.trim(),
        polish_todo_system_prompt: polishTodoPrompt.trim(),
        polish_task_desc_system_prompt: polishTaskDescPrompt.trim(),
      })
      showToast('已保存')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  return (
    <section id="llm-record" className={styles.section}>
      <h2 className={styles.sectionTitle}>工作记录</h2>
      <p className={styles.sectionHint}>润色采用对话式引导：LLM 先分析不足、询问方向，再给出建议版本。留空则使用默认值。</p>
      {isLoading ? (
        <p className={styles.sectionHint}>载入中...</p>
      ) : (
        <form onSubmit={handleSave}>
          <PromptGroup name="日报润色" desc="日报书面化">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置日报润色提示词？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setPolishPrompt('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setPolishPromptMode(polishPromptMode === 'source' ? 'preview' : 'source')}>{polishPromptMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>润色工作日报，使其书面化、正式化。后端自动注入任务标题和描述。</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={polishPrompt || ''} onChange={setPolishPrompt} mode={polishPromptMode} onModeChange={setPolishPromptMode} minHeight={150} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
            </div>
          </PromptGroup>
          <PromptGroup name="待办润色" desc="补充说明">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置待办润色提示词？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setPolishTodoPrompt('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setPolishTodoPromptMode(polishTodoPromptMode === 'source' ? 'preview' : 'source')}>{polishTodoPromptMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>润色待办事项的补充说明，使其更清晰简洁。后端自动注入任务标题和描述。</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={polishTodoPrompt || ''} onChange={setPolishTodoPrompt} mode={polishTodoPromptMode} onModeChange={setPolishTodoPromptMode} minHeight={150} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
            </div>
          </PromptGroup>
          <PromptGroup name="任务描述润色" desc="任务描述">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置任务描述润色提示词？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setPolishTaskDescPrompt('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setPolishTaskDescPromptMode(polishTaskDescPromptMode === 'source' ? 'preview' : 'source')}>{polishTaskDescPromptMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>润色任务描述。后端自动注入任务标题、全部日报摘要（分段）和未完成待办。</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={polishTaskDescPrompt || ''} onChange={setPolishTaskDescPrompt} mode={polishTaskDescPromptMode} onModeChange={setPolishTaskDescPromptMode} minHeight={150} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
            </div>
          </PromptGroup>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="submit" className="btn btn--primary" disabled={saveLLM.isPending}>{saveLLM.isPending ? '保存中...' : '保存'}</button>
          </div>
        </form>
      )}
    </section>
  )
}
