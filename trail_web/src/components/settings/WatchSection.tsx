import { useState, useEffect } from 'react'
import { useLLMSettings, useSaveLLMSettings, DEFAULT_WATCH_SETTINGS } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { DescriptionEditorWithMode, type EditorMode } from '@/components/shared/DescriptionEditorWithMode'
import { CronEditor } from '@/components/shared/CronEditor'
import styles from '@/pages/SettingsPage.module.css'

export function WatchSection() {
  const { showToast } = useToastContext()
  const { data: settings, isLoading } = useLLMSettings({ enabled: true })
  const saveLLM = useSaveLLMSettings()

  const [watchIdleHotDays, setWatchIdleHotDays] = useState(String(DEFAULT_WATCH_SETTINGS.watch_idle_hot_days))
  const [watchIdleWarnDays, setWatchIdleWarnDays] = useState(String(DEFAULT_WATCH_SETTINGS.watch_idle_warn_days))
  const [watchCron, setWatchCron] = useState(DEFAULT_WATCH_SETTINGS.watch_cron)
  const [watchAlertTemplate, setWatchAlertTemplate] = useState(DEFAULT_WATCH_SETTINGS.watch_alert_template)
  const [watchAlertTemplateMode, setWatchAlertTemplateMode] = useState<EditorMode>('preview')

  useEffect(() => {
    if (!settings) return
    setWatchIdleHotDays(settings.watch_idle_hot_days || String(DEFAULT_WATCH_SETTINGS.watch_idle_hot_days))
    setWatchIdleWarnDays(settings.watch_idle_warn_days || String(DEFAULT_WATCH_SETTINGS.watch_idle_warn_days))
    setWatchCron(settings.watch_cron || DEFAULT_WATCH_SETTINGS.watch_cron)
    setWatchAlertTemplate(settings.watch_alert_template || DEFAULT_WATCH_SETTINGS.watch_alert_template)
  }, [settings])

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault()
    try {
      await saveLLM.mutateAsync({
        watch_idle_hot_days: watchIdleHotDays,
        watch_idle_warn_days: watchIdleWarnDays,
        watch_cron: watchCron.trim(),
        watch_alert_template: watchAlertTemplate,
      })
      showToast('已保存')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  return (
    <section id="interface-watch" className={styles.section}>
      <h2 className={styles.sectionTitle}>特别关注推送配置</h2>
      <p className={styles.sectionHint}>侧边栏「特别关注」区块用颜色区分任务活跃程度，根据最近一条日报距今天数判断。</p>
      {isLoading ? (
        <p className={styles.sectionHint}>载入中...</p>
      ) : (
        <form onSubmit={handleSave}>
          <div className="field">
            <div className="field__label">
              <span>活跃天数</span>
              <span className="field__hint" style={{ color: 'var(--green)' }}>绿色 · {watchIdleHotDays} 天内</span>
            </div>
            <input
              type="range"
              min="1"
              max="7"
              value={watchIdleHotDays}
              onChange={e => setWatchIdleHotDays(e.target.value)}
              className={styles.slider}
            />
            <p className={styles.fieldHint}>最近一条日报在此天数内，闲置标签显示为绿色（近期活跃）。</p>
          </div>
          <div className="field">
            <div className="field__label">
              <span>预警天数</span>
              <span className="field__hint" style={{ color: '#e07b39' }}>橙色 · {watchIdleWarnDays} 天以上</span>
            </div>
            <input
              type="range"
              min="8"
              max="30"
              value={watchIdleWarnDays}
              onChange={e => setWatchIdleWarnDays(e.target.value)}
              className={styles.slider}
            />
            <p className={styles.fieldHint}>最近一条日报超过此天数，闲置标签显示为橙色（需要关注）。</p>
          </div>
          <div className="field">
            <div className="field__label"><span>推送计划</span></div>
            <CronEditor value={watchCron} onChange={setWatchCron} />
            <p className={styles.fieldHint}>设置特别关注预警的推送时间。支持 cron 表达式（分 时 日 月 周），保存后立即生效。</p>
          </div>
          <div className="field">
            <div className="field__label"><span>消息模板</span></div>
            <DescriptionEditorWithMode
              value={watchAlertTemplate}
              onChange={setWatchAlertTemplate}
              mode={watchAlertTemplateMode}
              onModeChange={setWatchAlertTemplateMode}
              minHeight={120}
              textareaClassName="field__textarea"
              autoGrow
              maxHeight={300}
            />
            <p className={styles.fieldHint}>
              支持占位符：<code>{'${task_title}'}</code> 任务标题、<code>{'${idle_days}'}</code> 闲置天数<br />
              系统会自动在消息末尾追加「查看任务」和「今日忽略」链接。
            </p>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => {
                setWatchIdleHotDays(String(DEFAULT_WATCH_SETTINGS.watch_idle_hot_days))
                setWatchIdleWarnDays(String(DEFAULT_WATCH_SETTINGS.watch_idle_warn_days))
                setWatchCron(DEFAULT_WATCH_SETTINGS.watch_cron)
                setWatchAlertTemplate(DEFAULT_WATCH_SETTINGS.watch_alert_template)
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
