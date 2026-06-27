import { useState, useEffect } from 'react'
import { useLLMSettings, useSaveLLMSettings, useMotto, useSaveMotto } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import styles from '@/pages/SettingsPage.module.css'

export function GeneralSection() {
  const { showToast } = useToastContext()
  const confirm = useConfirm()
  const { data: settings } = useLLMSettings({ enabled: true })
  const saveLLM = useSaveLLMSettings()
  const { data: motto } = useMotto({ enabled: true })
  const saveMotto = useSaveMotto()

  const [mottoDraft, setMottoDraft] = useState('')
  const [speechDuration, setSpeechDuration] = useState('10')
  const [maxToolIterations, setMaxToolIterations] = useState('30')

  useEffect(() => {
    if (!settings) return
    setSpeechDuration(settings.speech_duration || '10')
    setMaxToolIterations(settings.max_tool_iterations || '30')
  }, [settings])

  useEffect(() => {
    if (motto !== undefined) setMottoDraft(motto || '')
  }, [motto])

  async function handleSave() {
    if (saveMotto.isPending || saveLLM.isPending) return
    const ok = await confirm({
      level: 'moderate',
      title: '保存界面偏好？',
      body: <p>将保存卷首语、LLM 语音输入时长和 LLM 工具调用次数设置。</p>,
      confirmLabel: '保存',
    })
    if (!ok) return
    try {
      await saveMotto.mutateAsync(mottoDraft.trim())
      await saveLLM.mutateAsync({
        speech_duration: speechDuration.trim(),
        max_tool_iterations: maxToolIterations.trim(),
      })
      showToast('已保存')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  return (
    <section id="interface-general" className={styles.section}>
      <h2 className={styles.sectionTitle}>通用设置</h2>
      <p className={styles.sectionHint}>卷首语、语音输入时长、工具调用次数等通用偏好。</p>

      <div className="field">
        <div className="field__label">
          <span>卷首语</span>
          <span className="field__hint">显示在侧栏底部</span>
        </div>
        <textarea
          className="field__textarea"
          value={mottoDraft}
          onChange={e => setMottoDraft(e.target.value)}
          placeholder="输入卷首语..."
          rows={3}
          style={{ fontSize: '13px', lineHeight: 1.6 }}
        />
      </div>

      <div className="field">
        <div className="field__label">
          <span>LLM 语音输入时长</span>
          <span className="field__hint">{speechDuration} 秒</span>
        </div>
        <input
          type="range"
          min="5"
          max="60"
          value={speechDuration}
          onChange={e => setSpeechDuration(e.target.value)}
          className={styles.slider}
        />
        <p className={styles.fieldHint}>聊天窗口语音输入的最大时长，拖动调整。</p>
      </div>

      <div className="field">
        <div className="field__label">
          <span>LLM 工具调用次数上限</span>
          <span className="field__hint">{maxToolIterations} 次</span>
        </div>
        <input
          type="range"
          min="1"
          max="100"
          value={maxToolIterations}
          onChange={e => setMaxToolIterations(e.target.value)}
          className={styles.slider}
        />
        <p className={styles.fieldHint}>大模型聊天时工具调用的最大迭代次数，防止无限循环。</p>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={async () => {
            const ok = await confirm({
              level: 'dangerous',
              title: '恢复所有默认值？',
              body: <p>卷首语、LLM 语音时长和 LLM 工具调用次数将全部恢复为默认值。</p>,
              confirmLabel: '恢复默认',
            })
            if (ok) {
              setMottoDraft('')
              setSpeechDuration('10')
              setMaxToolIterations('30')
            }
          }}
        >
          恢复默认
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={handleSave}
          disabled={saveMotto.isPending || saveLLM.isPending}
        >
          {(saveMotto.isPending || saveLLM.isPending) ? '保存中...' : '保存'}
        </button>
      </div>
    </section>
  )
}
