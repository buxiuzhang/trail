import { useState, useEffect } from 'react'
import { useWeatherSettings, useSaveWeatherSettings } from '@/api/weather'
import { useToastContext } from '@/context/ToastContext'
import styles from '@/pages/SettingsPage.module.css'

export function WeatherSection() {
  const { showToast } = useToastContext()
  const { data: weatherSettings } = useWeatherSettings()
  const saveWeather = useSaveWeatherSettings()

  const [weatherProjectId, setWeatherProjectId] = useState('')
  const [weatherCredentialId, setWeatherCredentialId] = useState('')
  const [weatherApiHost, setWeatherApiHost] = useState('')
  const [weatherPrivateKey, setWeatherPrivateKey] = useState('')
  const [weatherDefaultCity, setWeatherDefaultCity] = useState('')

  useEffect(() => {
    if (!weatherSettings) return
    setWeatherProjectId(weatherSettings.project_id)
    setWeatherCredentialId(weatherSettings.credential_id)
    setWeatherApiHost(weatherSettings.api_host)
    setWeatherPrivateKey('')
    setWeatherDefaultCity(weatherSettings.default_city_name || weatherSettings.default_city)
  }, [weatherSettings])

  async function handleSave() {
    const payload: Record<string, string> = {
      project_id: weatherProjectId,
      credential_id: weatherCredentialId,
      api_host: weatherApiHost,
      default_city: weatherDefaultCity,
    }
    if (weatherPrivateKey.trim()) payload.private_key = weatherPrivateKey.trim()
    try {
      await saveWeather.mutateAsync(payload)
      setWeatherPrivateKey('')
      showToast('天气配置已保存')
    } catch (err: unknown) {
      showToast('保存失败：' + (err as Error).message)
    }
  }

  return (
    <section id="interface-weather" className={styles.section}>
      <h2 className={styles.sectionTitle}>天气配置</h2>
      <p className={styles.sectionHint}>
        和风天气（QWeather）API 凭据，用于在标题栏 Trail 旁显示实时天气。
        凭据信息请在 <a href="https://console.qweather.com" target="_blank" rel="noreferrer" style={{ color: 'var(--green-ink)' }}>和风天气控制台</a> 获取。
      </p>

      <div style={{ display: 'flex', gap: 16 }}>
        <div className="field" style={{ flex: 1 }}>
          <div className="field__label"><span>项目 ID</span></div>
          <input className="field__input" value={weatherProjectId} onChange={e => setWeatherProjectId(e.target.value)} placeholder="例：24E6AVXK6B" style={{ fontFamily: 'var(--mono)', fontSize: '13.5px' }} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <div className="field__label"><span>凭据 ID</span></div>
          <input className="field__input" value={weatherCredentialId} onChange={e => setWeatherCredentialId(e.target.value)} placeholder="例：TFB4P8GVXH" style={{ fontFamily: 'var(--mono)', fontSize: '13.5px' }} />
        </div>
      </div>

      <div className="field">
        <div className="field__label">
          <span>Ed25519 私钥</span>
          <span className="field__hint">{weatherSettings?.private_key_masked === '****' ? '已配置' : '未配置'}</span>
        </div>
        <textarea
          className="field__textarea"
          value={weatherPrivateKey}
          onChange={e => setWeatherPrivateKey(e.target.value)}
          placeholder={weatherSettings?.private_key_masked === '****' ? '已保存（不回显），重新粘贴可覆盖' : '粘贴 PKCS#8 PEM 格式私钥（-----BEGIN PRIVATE KEY-----...）'}
          rows={5}
          style={{ fontFamily: 'var(--mono)', fontSize: '12px' }}
        />
        <p className={styles.fieldHint}>Ed25519 私钥，PKCS#8 PEM 格式或纯 Base64 均可。存储后加密保存，不回显。</p>
      </div>

      <div style={{ display: 'flex', gap: 16 }}>
        <div className="field" style={{ flex: 1 }}>
          <div className="field__label">
            <span>API Host</span>
            <span className="field__hint">可选，默认 devapi.qweather.com</span>
          </div>
          <input className="field__input" value={weatherApiHost} onChange={e => setWeatherApiHost(e.target.value)} placeholder="devapi.qweather.com" style={{ fontFamily: 'var(--mono)', fontSize: '13.5px' }} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <div className="field__label">
            <span>默认城市</span>
            <span className="field__hint">
              {weatherSettings?.default_city_name
                ? `当前：${weatherSettings.default_city_name} · 定位被拒时回退`
                : '浏览器定位被拒时的回退城市'}
            </span>
          </div>
          <input className="field__input" value={weatherDefaultCity} onChange={e => setWeatherDefaultCity(e.target.value)} placeholder="城市名或城市 ID，例：深圳" />
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button type="button" className="btn btn--primary" disabled={saveWeather.isPending} onClick={handleSave}>
          {saveWeather.isPending ? '保存中...' : '保存'}
        </button>
      </div>
    </section>
  )
}
