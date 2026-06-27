import { useState, useEffect } from 'react'
import { useVectorSettings, useSaveVectorSettings } from '@/api/settings'
import { useVectorInitStatus, useStartVectorInit, useVectorStats } from '@/api/embed'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import styles from '@/pages/SettingsPage.module.css'
import LockIcon from '@/icons/lock.svg'
import UnlockIcon from '@/icons/unlock.svg'
import ChevronDownIcon from '@/icons/chevron-down.svg'
import ChevronRightIcon from '@/icons/chevron-right.svg'

const DIM_PRESETS = [0, 64, 128, 256, 512, 768, 1024, 1536, 2048]

export function VectorSection() {
  const { showToast } = useToastContext()
  const { data: vectorSettings } = useVectorSettings({ enabled: true })
  const saveVector = useSaveVectorSettings()

  const [vectorApiKey, setVectorApiKey] = useState('')
  const [vectorBaseUrl, setVectorBaseUrl] = useState('')
  const [vectorModel, setVectorModel] = useState('')
  const [vectorDimensions, setVectorDimensions] = useState(0)
  const [vectorApiKeyPlaceholder, setVectorApiKeyPlaceholder] = useState('')
  const [vectorEnabled, setVectorEnabled] = useState(false)

  useEffect(() => {
    if (!vectorSettings) return
    setVectorApiKeyPlaceholder(vectorSettings.api_key_masked || '')
    setVectorApiKey('')
    setVectorBaseUrl(vectorSettings.base_url || '')
    setVectorModel(vectorSettings.model || '')
    setVectorDimensions(vectorSettings.dimensions ? parseInt(vectorSettings.dimensions) || 0 : 0)
    setVectorEnabled(vectorSettings.enabled ?? false)
  }, [vectorSettings])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    try {
      await saveVector.mutateAsync({
        ...(vectorApiKey.trim() ? { api_key: vectorApiKey.trim() } : {}),
        base_url: vectorBaseUrl.trim(),
        model: vectorModel.trim(),
        dimensions: vectorDimensions > 0 ? String(vectorDimensions) : '',
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
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <h2 className={styles.sectionTitle} style={{ marginBottom: 0, flex: 1 }}>向量模型</h2>
        <button
          type="button"
          title={vectorEnabled ? '向量检索已启用，点击禁用' : '向量检索已禁用，点击启用'}
          onClick={() => setVectorEnabled(v => !v)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', flexShrink: 0 }}
        >
          <img
            src={vectorEnabled ? UnlockIcon : LockIcon}
            width={18}
            height={18}
            alt={vectorEnabled ? '已启用' : '已禁用'}
            style={{ opacity: vectorEnabled ? 0.75 : 0.35, transition: 'opacity 0.15s' }}
          />
        </button>
      </div>
      <p className={styles.sectionHint}>配置 Embedding 模型，用于向量检索。</p>
      <form onSubmit={handleSave}>
        <fieldset disabled={!vectorEnabled} style={{ border: 'none', padding: 0, margin: 0, opacity: vectorEnabled ? 1 : 0.4, transition: 'opacity 0.15s' }}>
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
          <div className="field__label">
            <span>模型</span>
          </div>
          <div style={{ display: 'flex', gap: 24, alignItems: 'flex-end' }}>
            <input
              className="field__input"
              type="text"
              value={vectorModel}
              onChange={e => setVectorModel(e.target.value)}
              placeholder="text-embedding-3-small"
              style={{ flex: 1 }}
            />
            <div className="field" style={{ marginBottom: 0, flexShrink: 0, minWidth: 120 }}>
              <div className="field__label"><span>维度</span><span className="field__hint">留空 = 模型默认</span></div>
              <div style={{ display: 'flex', alignItems: 'flex-end', borderBottom: '0.5px solid var(--rule)', paddingBottom: 8 }}>
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    const idx = DIM_PRESETS.indexOf(vectorDimensions)
                    if (idx > 0) setVectorDimensions(DIM_PRESETS[idx - 1])
                    else if (idx === -1) {
                      const lower = DIM_PRESETS.filter(d => d < vectorDimensions).pop() ?? 0
                      setVectorDimensions(lower)
                    }
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1 }}
                >−</button>
                <input
                  type="number"
                  className={styles.dimInput}
                  value={vectorDimensions || ''}
                  placeholder="默认"
                  min={0}
                  max={4096}
                  onChange={e => setVectorDimensions(parseInt(e.target.value) || 0)}
                />
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => {
                    const idx = DIM_PRESETS.indexOf(vectorDimensions)
                    if (idx !== -1 && idx < DIM_PRESETS.length - 1) setVectorDimensions(DIM_PRESETS[idx + 1])
                    else if (idx === -1) {
                      const higher = DIM_PRESETS.find(d => d > vectorDimensions) ?? DIM_PRESETS[DIM_PRESETS.length - 1]
                      setVectorDimensions(higher)
                    }
                  }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 4px', fontSize: 16, color: 'var(--ink-soft)', lineHeight: 1 }}
                >+</button>
              </div>
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button type="submit" className="btn btn--primary" disabled={saveVector.isPending}>
            {saveVector.isPending ? '保存中…' : '保存'}
          </button>
        </div>
        </fieldset>
      </form>

      {configured && <VectorInitPanel enabled={vectorEnabled} />}
    </section>
  )
}

function VectorInitPanel({ enabled }: { enabled: boolean }) {
  const { data: status, isLoading } = useVectorInitStatus()
  const { data: stats } = useVectorStats()
  const startInit = useStartVectorInit()
  const confirm = useConfirm()
  const [collapsed, setCollapsed] = useState(true)

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
    <div style={{ marginTop: 28, borderTop: '1px solid var(--border)', paddingTop: 20, opacity: enabled ? 1 : 0.4, transition: 'opacity 0.15s', pointerEvents: enabled ? 'auto' : 'none' }}>
      <div
        onClick={() => setCollapsed(v => !v)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: collapsed ? 0 : 12, cursor: 'pointer', userSelect: 'none' }}
      >
        <span style={{ fontWeight: 500, fontSize: 13 }}>向量索引</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {stats && (
            <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>当前 {stats.rows} 条</span>
          )}
          <img
            src={collapsed ? ChevronRightIcon : ChevronDownIcon}
            width={13} height={13}
            alt={collapsed ? '展开' : '收起'}
            style={{ opacity: 0.4 }}
          />
        </div>
      </div>

      {!collapsed && (<>
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
      </>)}
    </div>
  )
}
