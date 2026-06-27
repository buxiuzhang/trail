import { useState, useEffect } from 'react'
import { useLLMSettings, useSaveLLMSettings } from '@/api/settings'
import { rsaDecrypt } from '@/api/crypto'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import styles from '@/pages/SettingsPage.module.css'

export function LlmConnectionSection() {
  const { showToast } = useToastContext()
  const confirm = useConfirm()
  const { data: settings, isLoading } = useLLMSettings({ enabled: true })
  const saveLLM = useSaveLLMSettings()

  const [apiKey, setApiKey] = useState('')
  const [apiKeyPlaceholder, setApiKeyPlaceholder] = useState('')
  const [apiKeyEncrypted, setApiKeyEncrypted] = useState('')
  const [apiKeyDecrypted, setApiKeyDecrypted] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [authType, setAuthType] = useState<'bearer' | 'x-api-key'>('bearer')
  const [maxTokens, setMaxTokens] = useState('1000')
  const [minTokens, setMinTokens] = useState('100')
  const [showKey, setShowKey] = useState(false)
  const [isDecrypting, setIsDecrypting] = useState(false)

  useEffect(() => {
    if (!settings) return
    setApiKeyPlaceholder(settings.api_key_masked || '')
    setApiKeyEncrypted(settings.api_key_encrypted || '')
    setApiKeyDecrypted('')
    setApiKey('')
    setBaseUrl(settings.base_url || '')
    setModel(settings.model || '')
    setAuthType((settings.auth_type as 'bearer' | 'x-api-key') || 'bearer')
    setMaxTokens(settings.max_tokens || '1000')
    setMinTokens(settings.min_tokens || '100')
  }, [settings])

  async function handleShowApiKey() {
    if (!apiKeyEncrypted) { showToast('无 API Key'); return }
    setIsDecrypting(true)
    try {
      const decrypted = await rsaDecrypt(apiKeyEncrypted)
      setApiKeyDecrypted(decrypted)
      setShowKey(true)
    } catch (err: unknown) {
      showToast('解密失败：' + (err as Error).message)
    } finally {
      setIsDecrypting(false)
    }
  }

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault()
    const ok = await confirm({
      level: 'moderate',
      title: '保存 LLM 设置？',
      body: <p>将保存 API Key、Base URL、模型配置及所有 Prompt 模板。</p>,
      confirmLabel: '保存',
    })
    if (!ok) return
    try {
      await saveLLM.mutateAsync({
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        base_url: baseUrl.trim(),
        model: model.trim(),
        auth_type: authType,
        max_tokens: maxTokens.trim(),
        min_tokens: minTokens.trim(),
      })
      showToast('已保存')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>大模型</h2>
      {isLoading ? (
        <p className={styles.sectionHint}>载入中...</p>
      ) : (
        <form onSubmit={handleSave}>
          <div className="field">
            <div className="field__label">
              <span>API Key</span>
              <span className="field__hint">加密保存</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                className="field__input"
                type={showKey ? 'text' : 'password'}
                value={showKey && apiKeyDecrypted ? apiKeyDecrypted : apiKey}
                onChange={e => { setApiKey(e.target.value); setApiKeyDecrypted('') }}
                placeholder={apiKeyPlaceholder || 'sk-...'}
                style={{ flex: 1 }}
                disabled={!!(showKey && apiKeyDecrypted)}
              />
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  if (showKey) { setShowKey(false); setApiKeyDecrypted('') }
                  else { handleShowApiKey() }
                }}
                disabled={isDecrypting}
              >
                {isDecrypting ? '解密中...' : showKey ? '隐藏' : '显示'}
              </button>
            </div>
            <p className={styles.fieldHint}>
              {apiKeyPlaceholder
                ? `当前：${apiKeyPlaceholder}。输入新值将替换，留空则保持不变。点击"显示"可查看完整值。`
                : '输入您的 LLM API Key，将加密传输并存储。'}
            </p>
          </div>

          <div className="field">
            <div className="field__label"><span>Base URL</span></div>
            <input
              className="field__input"
              value={baseUrl}
              onChange={e => setBaseUrl(e.target.value)}
              placeholder="https://api.minimaxi.com/anthropic"
            />
          </div>

          <div className="field">
            <div className="field__label">
              <span>认证方式</span>
              <span className="field__hint">{authType === 'bearer' ? 'Authorization: Bearer' : 'x-api-key header'}</span>
            </div>
            <select
              className="field__input"
              value={authType}
              onChange={e => setAuthType(e.target.value as 'bearer' | 'x-api-key')}
              style={{ cursor: 'pointer' }}
            >
              <option value="bearer">Bearer（智谱、DeepSeek、MiniMax 等）</option>
              <option value="x-api-key">x-api-key（Anthropic 原生）</option>
            </select>
            <p className={styles.fieldHint}>
              {authType === 'bearer'
                ? '使用 Authorization: Bearer <key> 认证，适用于大多数第三方 API'
                : '使用 x-api-key: <key> 认证，适用于 Anthropic 官方 API'}
            </p>
          </div>

          <div className="field-row">
            <div className="field">
              <div className="field__label"><span>模型</span></div>
              <input
                className="field__input"
                value={model}
                onChange={e => setModel(e.target.value)}
                placeholder="glm-5"
              />
            </div>
          </div>

          <div className="field-row">
            <div className="field">
              <div className="field__label"><span>Max Tokens</span><span className="field__hint">输出上限</span></div>
              <input
                className="field__input"
                type="number"
                min="1"
                step="1"
                value={maxTokens}
                onChange={e => setMaxTokens(e.target.value.replace(/\D/g, ''))}
                placeholder="1000"
              />
            </div>
            <div className="field">
              <div className="field__label"><span>Min Tokens</span><span className="field__hint">输出下限，0=不限制</span></div>
              <input
                className="field__input"
                type="number"
                min="0"
                step="1"
                value={minTokens}
                onChange={e => setMinTokens(e.target.value.replace(/\D/g, ''))}
                placeholder="100"
              />
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button type="submit" className="btn btn--primary" disabled={saveLLM.isPending}>
              {saveLLM.isPending ? '保存中...' : '保存'}
            </button>
          </div>
        </form>
      )}
    </section>
  )
}
