import { useState, useEffect } from 'react'
import { useVectorSettings, useSaveVectorSettings } from '@/api/settings'
import { useVectorInitStatus, useStartVectorInit, useVectorStats } from '@/api/embed'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import styles from '@/pages/SettingsPage.module.css'

export function VectorSection() {
  const { showToast } = useToastContext()
  const { data: vectorSettings } = useVectorSettings({ enabled: true })
  const saveVector = useSaveVectorSettings()

  const [vectorApiKey, setVectorApiKey] = useState('')
  const [vectorBaseUrl, setVectorBaseUrl] = useState('')
  const [vectorModel, setVectorModel] = useState('')
  const [vectorDimensions, setVectorDimensions] = useState('')
  const [vectorApiKeyPlaceholder, setVectorApiKeyPlaceholder] = useState('')
  const [vectorEnabled, setVectorEnabled] = useState(false)

  useEffect(() => {
    if (!vectorSettings) return
    setVectorApiKeyPlaceholder(vectorSettings.api_key_masked || '')
    setVectorApiKey('')
    setVectorBaseUrl(vectorSettings.base_url || '')
    setVectorModel(vectorSettings.model || '')
    setVectorDimensions(vectorSettings.dimensions || '')
    setVectorEnabled(vectorSettings.enabled ?? false)
  }, [vectorSettings])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    try {
      await saveVector.mutateAsync({
        ...(vectorApiKey.trim() ? { api_key: vectorApiKey.trim() } : {}),
        base_url: vectorBaseUrl.trim(),
        model: vectorModel.trim(),
        dimensions: vectorDimensions.trim(),
        enabled: vectorEnabled ? 'true' : 'false',
      })
      setVectorApiKey('')
      showToast('向量模型配置已保存')
    } catch {
      showToast('保存失败')
    }
  }

  const configured = !!(vectorSettings?.api_key_masked)

  return (
    <section id="llm-vector" className={styles.section}>
      <h2 className={styles.sectionTitle}>向量模型</h2>
      <p className={styles.sectionHint}>配置 Embedding 模型，用于向量检索。</p>
      <form onSubmit={handleSave}>
        <div className="field">
          <div className="field__label">
            <span>API Key</span>
            <span className="field__hint">加密保存</span>
          </div>
          <input
            className="field__input"
            type="password"
            value={vectorApiKey}
            onChange={e => setVectorApiKey(e.target.value)}
            placeholder={vectorApiKeyPlaceholder || '留空则保持不变'}
            autoComplete="off"
          />
        </div>
        <div className="field">
          <div className="field__label"><span>Base URL</span></div>
          <input
            className="field__input"
            type="text"
            value={vectorBaseUrl}
            onChange={e => setVectorBaseUrl(e.target.value)}
            placeholder="https://api.openai.com"
          />
        </div>
        <div className="field">
          <div className="field__label"><span>模型</span></div>
          <input
            className="field__input"
            type="text"
            value={vectorModel}
            onChange={e => setVectorModel(e.target.value)}
            placeholder="text-embedding-3-small"
          />
        </div>
        <div className="field">
          <div className="field__label">
            <span>维度</span>
            <span className="field__hint">向量维度数，留空则使用模型默认值</span>
          </div>
          <input
            className="field__input"
            type="number"
            value={vectorDimensions}
            onChange={e => setVectorDimensions(e.target.value)}
            placeholder="1536"
            min={1}
          />
        </div>
        <div className="field">
          <div className="field__label">
            <span>向量检索</span>
            <span className="field__hint">关闭后所有向量相关功能停止运行</span>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              type="button"
              className={vectorEnabled ? 'btn btn--primary' : 'btn btn--ghost'}
              onClick={() => setVectorEnabled(true)}
            >
              启用
            </button>
            <button
              type="button"
              className={!vectorEnabled ? 'btn btn--primary' : 'btn btn--ghost'}
              onClick={() => setVectorEnabled(false)}
            >
              禁用
            </button>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" className="btn btn--primary" disabled={saveVector.isPending}>
            {saveVector.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>

      {configured && <VectorInitPanel />}
    </section>
  )
}

function VectorInitPanel() {
  const { data: status, isLoading } = useVectorInitStatus()
  const { data: stats } = useVectorStats()
  const startInit = useStartVectorInit()
  const confirm = useConfirm()

  async function handleInit(skipExisting: boolean) {
    const ok = await confirm(
      skipExisting
        ? {
            level: 'moderate',
            title: '增量同步向量索引？',
            body: <p>只索引尚未向量化的新增内容，已有向量保持不变。可重复运行。</p>,
            confirmLabel: '开始同步',
          }
        : {
            level: 'dangerous',
            title: '全量重建向量索引？',
            body: (
              <div>
                <p>将重新向量化<strong>所有</strong>任务、日报、待办，耗时较长。</p>
                <p>建议仅在更换向量模型后使用。</p>
              </div>
            ),
            confirmLabel: '确认重建',
          }
    )
    if (!ok) return
    await startInit.mutateAsync(skipExisting)
  }

  if (isLoading) return null

  const s = status?.status ?? 'idle'
  const prog = status?.progress
  const result = status?.result

  return (
    <div style={{ marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontWeight: 500, fontSize: 13 }}>向量索引</span>
        {stats && (
          <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
            当前 {stats.rows} 条
          </span>
        )}
      </div>

      {s === 'running' && prog && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
          {(['tasks', 'logs', 'todos'] as const).map(key => {
            const p = prog[key]
            const pct = p.total > 0 ? Math.round(p.done / p.total * 100) : 0
            const label = { tasks: '任务', logs: '日报', todos: '待办' }[key]
            return (
              <div key={key}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--ink-soft)', marginBottom: 4 }}>
                  <span>{label}</span>
                  <span>{p.done} / {p.total}（{pct}%）</span>
                </div>
                <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--amber)', transition: 'width 0.3s ease', borderRadius: 2 }} />
                </div>
              </div>
            )
          })}
          <p style={{ fontSize: 12, color: 'var(--ink-soft)', margin: 0 }}>索引中，请稍候…</p>
        </div>
      )}

      {s === 'done' && result && (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginBottom: 14, padding: '10px 12px', background: 'var(--bg-alt)', borderRadius: 6 }}>
          <span style={{ color: 'var(--green, #4caf50)', fontWeight: 500 }}>✓ 完成</span>
          {'　'}
          任务 {result.tasks.indexed} · 日报 {result.logs.indexed} · 待办 {result.todos.indexed}
          {'　'}
          <span style={{ color: 'var(--ink-faded)' }}>跳过 {result.tasks.skipped + result.logs.skipped + result.todos.skipped} · 耗时 {(result.duration_ms / 1000).toFixed(1)}s</span>
        </div>
      )}

      {s === 'failed' && (
        <p style={{ fontSize: 12, color: 'var(--red, #e53935)', marginBottom: 14 }}>
          索引失败：{status?.error ?? '未知错误'}
        </p>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          className="btn btn--primary"
          disabled={s === 'running' || startInit.isPending}
          onClick={() => handleInit(true)}
        >
          {s === 'running' ? '索引中…' : '增量同步'}
        </button>
        <button
          className="btn btn--ghost"
          disabled={s === 'running' || startInit.isPending}
          onClick={() => handleInit(false)}
        >
          全量重建
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--ink-faded)', marginTop: 8, marginBottom: 0 }}>
        增量同步只补录新增内容；全量重建重新向量化所有数据，换模型后使用。
      </p>
    </div>
  )
}
