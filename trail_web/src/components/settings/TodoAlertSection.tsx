import { useState, useEffect } from 'react'
import { useLLMSettings, useSaveLLMSettings, DEFAULT_TODO_SETTINGS } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { DescriptionEditorWithMode, type EditorMode } from '@/components/shared/DescriptionEditorWithMode'
import { CronEditor } from '@/components/shared/CronEditor'
import styles from '@/pages/SettingsPage.module.css'

export function TodoAlertSection() {
  const { showToast } = useToastContext()
  const { data: settings, isLoading } = useLLMSettings({ enabled: true })
  const saveLLM = useSaveLLMSettings()

  const [todoIdleWarnDays, setTodoIdleWarnDays] = useState(String(DEFAULT_TODO_SETTINGS.todo_idle_warn_days))
  const [todoCron, setTodoCron] = useState(DEFAULT_TODO_SETTINGS.todo_cron)
  const [todoAlertTemplate, setTodoAlertTemplate] = useState(DEFAULT_TODO_SETTINGS.todo_alert_template)
  const [todoAlertTemplateMode, setTodoAlertTemplateMode] = useState<EditorMode>('preview')

  useEffect(() => {
    if (!settings) return
    setTodoIdleWarnDays(settings.todo_idle_warn_days || String(DEFAULT_TODO_SETTINGS.todo_idle_warn_days))
    setTodoCron(settings.todo_cron || DEFAULT_TODO_SETTINGS.todo_cron)
    setTodoAlertTemplate(settings.todo_alert_template || DEFAULT_TODO_SETTINGS.todo_alert_template)
  }, [settings])

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault()
    try {
      await saveLLM.mutateAsync({
        todo_idle_warn_days: todoIdleWarnDays,
        todo_cron: todoCron.trim(),
        todo_alert_template: todoAlertTemplate,
      })
      showToast('已保存')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  return (
    <section id="interface-todo-alert" className={styles.section}>
      <h2 className={styles.sectionTitle}>待办事项推送配置</h2>
      <p className={styles.sectionHint}>未完成、未废弃的待办事项超过指定天数未处理时，通过消息推送提醒。</p>
      {isLoading ? (
        <p className={styles.sectionHint}>载入中...</p>
      ) : (
        <form onSubmit={handleSave}>
          <div className="field">
            <div className="field__label">
              <span>超期天数</span>
              <span className="field__hint" style={{ color: '#e07b39' }}>橙色 · {todoIdleWarnDays} 天以上</span>
            </div>
            <input
              type="range"
              min="1"
              max="30"
              value={todoIdleWarnDays}
              onChange={e => setTodoIdleWarnDays(e.target.value)}
              className={styles.slider}
            />
            <p className={styles.fieldHint}>待办事项创建后超过此天数未完成，触发推送提醒。</p>
          </div>
          <div className="field">
            <div className="field__label"><span>推送计划</span></div>
            <CronEditor value={todoCron} onChange={setTodoCron} />
            <p className={styles.fieldHint}>设置待办事项超期预警的推送时间。支持 cron 表达式（分 时 日 月 周），保存后立即生效。</p>
          </div>
          <div className="field">
            <div className="field__label"><span>消息模板</span></div>
            <DescriptionEditorWithMode
              value={todoAlertTemplate}
              onChange={setTodoAlertTemplate}
              mode={todoAlertTemplateMode}
              onModeChange={setTodoAlertTemplateMode}
              minHeight={120}
              textareaClassName="field__textarea"
              autoGrow
              maxHeight={300}
            />
            <p className={styles.fieldHint}>
              支持占位符：<code>{'${task_title}'}</code> 任务标题、<code>{'${todo_title}'}</code> 待办标题、<code>{'${idle_days}'}</code> 超期天数<br />
              系统会自动在消息末尾追加「查看任务」和「今日忽略」链接。
            </p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setTodoIdleWarnDays(String(DEFAULT_TODO_SETTINGS.todo_idle_warn_days))
                setTodoCron(DEFAULT_TODO_SETTINGS.todo_cron)
                setTodoAlertTemplate(DEFAULT_TODO_SETTINGS.todo_alert_template)
              }}
            >
              恢复默认
            </button>
            <button type="submit" className="btn btn--primary" disabled={saveLLM.isPending}>
              {saveLLM.isPending ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
