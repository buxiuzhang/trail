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

export function LlmDisabledPromptsSection() {
  const { showToast } = useToastContext()
  const confirm = useConfirm()
  const { data: settings, isLoading } = useLLMSettings({ enabled: true })
  const saveLLM = useSaveLLMSettings()

  const [summarizePrompt, setSummarizePrompt] = useState('')
  const [summarizePromptMode, setSummarizePromptMode] = useState<EditorMode>('preview')
  const [summarizeMaintenancePrompt, setSummarizeMaintenancePrompt] = useState('')
  const [summarizeMaintenancePromptMode, setSummarizeMaintenancePromptMode] = useState<EditorMode>('preview')
  const [askMaintenancePrompt, setAskMaintenancePrompt] = useState('')
  const [askMaintenancePromptMode, setAskMaintenancePromptMode] = useState<EditorMode>('preview')

  useEffect(() => {
    if (!settings) return
    setSummarizePrompt(settings.summarize_system_prompt || '')
    setSummarizeMaintenancePrompt(settings.summarize_maintenance_prompt || '')
    setAskMaintenancePrompt(settings.ask_maintenance_prompt || '')
  }, [settings])

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault()
    try {
      await saveLLM.mutateAsync({
        summarize_system_prompt: summarizePrompt.trim(),
        summarize_maintenance_prompt: summarizeMaintenancePrompt.trim(),
        ask_maintenance_prompt: askMaintenancePrompt.trim(),
      })
      showToast('已保存')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  return (
    <section id="llm-disabled" className={styles.section}>
      <h2 className={styles.sectionTitle}>暂不可用</h2>
      <p className={styles.sectionHint}>相关功能开发中，提示词可提前配置。</p>
      {isLoading ? (
        <p className={styles.sectionHint}>载入中...</p>
      ) : (
        <form onSubmit={handleSave}>
          <PromptGroup name="总结提示词" desc="主体阶段">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置总结提示词？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setSummarizePrompt('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setSummarizePromptMode(summarizePromptMode === 'source' ? 'preview' : 'source')}>{summarizePromptMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>主体阶段结束时，基于日报提炼总结</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={summarizePrompt || ''} onChange={setSummarizePrompt} mode={summarizePromptMode} onModeChange={setSummarizePromptMode} minHeight={150} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
            </div>
          </PromptGroup>
          <PromptGroup name="维护期总结" desc="维护阶段">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置维护期总结提示词？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setSummarizeMaintenancePrompt('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setSummarizeMaintenancePromptMode(summarizeMaintenancePromptMode === 'source' ? 'preview' : 'source')}>{summarizeMaintenancePromptMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>维护阶段结束时的总结，侧重偶发问题和对外影响</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={summarizeMaintenancePrompt || ''} onChange={setSummarizeMaintenancePrompt} mode={summarizeMaintenancePromptMode} onModeChange={setSummarizeMaintenancePromptMode} minHeight={150} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
            </div>
          </PromptGroup>
          <PromptGroup name="维护建议" desc="阶段判断">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置维护建议提示词？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setAskMaintenancePrompt('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setAskMaintenancePromptMode(askMaintenancePromptMode === 'source' ? 'preview' : 'source')}>{askMaintenancePromptMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>判断任务是否应进入维护期或直接关闭</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={askMaintenancePrompt || ''} onChange={setAskMaintenancePrompt} mode={askMaintenancePromptMode} onModeChange={setAskMaintenancePromptMode} minHeight={150} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
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
