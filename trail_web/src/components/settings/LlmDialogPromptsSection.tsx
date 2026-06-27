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

export function LlmDialogPromptsSection() {
  const { showToast } = useToastContext()
  const confirm = useConfirm()
  const { data: settings, isLoading } = useLLMSettings({ enabled: true })
  const saveLLM = useSaveLLMSettings()

  const [chatPrompt, setChatPrompt] = useState('')
  const [chatPromptMode, setChatPromptMode] = useState<EditorMode>('preview')
  const [batchTagPrompt, setBatchTagPrompt] = useState('')
  const [batchTagPromptMode, setBatchTagPromptMode] = useState<EditorMode>('source')
  const [dailyReportTemplate, setDailyReportTemplate] = useState('')
  const [dailyReportTemplateMode, setDailyReportTemplateMode] = useState<EditorMode>('preview')
  const [weeklyReportTemplate, setWeeklyReportTemplate] = useState('')
  const [weeklyReportTemplateMode, setWeeklyReportTemplateMode] = useState<EditorMode>('preview')

  useEffect(() => {
    if (!settings) return
    setChatPrompt(settings.chat_system_prompt || '')
    setBatchTagPrompt(settings.batch_tag_system_prompt || '')
    setDailyReportTemplate(settings.daily_report_template || '')
    setWeeklyReportTemplate(settings.weekly_report_template || '')
  }, [settings])

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault()
    try {
      await saveLLM.mutateAsync({
        chat_system_prompt: chatPrompt.trim(),
        batch_tag_system_prompt: batchTagPrompt.trim(),
        daily_report_template: dailyReportTemplate.trim(),
        weekly_report_template: weeklyReportTemplate.trim(),
      })
      showToast('已保存')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  return (
    <section id="llm-dialog" className={styles.section}>
      <h2 className={styles.sectionTitle}>对话与报表</h2>
      <p className={styles.sectionHint}>对话提示词、日报/周报模板，留空则使用默认值。</p>
      {isLoading ? (
        <p className={styles.sectionHint}>载入中...</p>
      ) : (
        <form onSubmit={handleSave}>
          <PromptGroup name="对话提示词" desc="AI 角色设定">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置对话提示词？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setChatPrompt('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setChatPromptMode(chatPromptMode === 'source' ? 'preview' : 'source')}>{chatPromptMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>聊天窗口的系统提示，定义 AI 的角色和行为</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={chatPrompt || ''} onChange={setChatPrompt} mode={chatPromptMode} onModeChange={setChatPromptMode} minHeight={120} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
            </div>
          </PromptGroup>
          <PromptGroup name="AI 标注提示词" desc="今日填报">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置 AI 标注提示词？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setBatchTagPrompt('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setBatchTagPromptMode(batchTagPromptMode === 'source' ? 'preview' : 'source')}>{batchTagPromptMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>今日填报「AI 标注」按钮的系统提示，控制如何在文本中插入 @task:ID 标记</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={batchTagPrompt || ''} onChange={setBatchTagPrompt} mode={batchTagPromptMode} onModeChange={setBatchTagPromptMode} minHeight={180} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={400} />
            </div>
          </PromptGroup>
          <PromptGroup name="今日工作模板" desc="日报">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置今日工作模板？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setDailyReportTemplate('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setDailyReportTemplateMode(dailyReportTemplateMode === 'source' ? 'preview' : 'source')}>{dailyReportTemplateMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>聊天说「导出今日工作」时使用</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={dailyReportTemplate || ''} onChange={setDailyReportTemplate} mode={dailyReportTemplateMode} onModeChange={setDailyReportTemplateMode} minHeight={180} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
            </div>
          </PromptGroup>
          <PromptGroup name="本周工作模板" desc="周报">
            <div className={styles.promptLabel}>
              <span className={styles.promptName}>
                <button type="button" onClick={async () => { if (await confirm({ level: 'moderate', title: '重置本周工作模板？', body: <p>将恢复为系统默认值。</p>, confirmLabel: '重置' })) setWeeklyReportTemplate('') }} className={styles.resetBtn}>重置</button>
              </span>
              <button type="button" className={styles.modeToggle} onClick={() => setWeeklyReportTemplateMode(weeklyReportTemplateMode === 'source' ? 'preview' : 'source')}>{weeklyReportTemplateMode === 'source' ? '预览模式' : '源码模式'}</button>
            </div>
            <p className={styles.promptDesc}>聊天说「导出本周工作」时使用</p>
            <div style={{ marginTop: '8px' }}>
              <DescriptionEditorWithMode value={weeklyReportTemplate || ''} onChange={setWeeklyReportTemplate} mode={weeklyReportTemplateMode} onModeChange={setWeeklyReportTemplateMode} minHeight={180} textareaClassName="field__textarea" hideInlineToggle autoGrow maxHeight={300} />
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
