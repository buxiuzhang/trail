import { useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { useOverview } from '@/api/insights'
import { useWeather, WEATHER_EMOJI } from '@/api/weather'
import { TODAY } from '@/constants'
import { Breadcrumb } from './Breadcrumb'
import styles from './Masthead.module.css'

/** 当前时间的时针 / 分针 / 秒针角度（从 12 点方向顺时针，单位度） */
function clockAngles(now: Date) {
  const h = now.getHours()
  const m = now.getMinutes()
  const s = now.getSeconds()
  const ms = now.getMilliseconds()
  const smoothSec = s + ms / 1000
  return {
    hour:   (h % 12) * 30 + m * 0.5 + smoothSec * (0.5 / 60),
    minute: m * 6 + smoothSec * 0.1,
    second: smoothSec * 6,
  }
}

export function Masthead() {
  const navigate = useNavigate()
  const { data: overview } = useOverview()
  const [now, setNow] = useState(() => new Date())
  const [geoLocation, setGeoLocation] = useState<string | null | 'pending'>('pending')

  useEffect(() => {
    if (!navigator.geolocation) { setGeoLocation(null); return }
    navigator.geolocation.getCurrentPosition(
      pos => setGeoLocation(`${pos.coords.latitude.toFixed(4)},${pos.coords.longitude.toFixed(4)}`),
      () => setGeoLocation(null),
      { timeout: 5000 }
    )
  }, [])

  const { data: weather } = useWeather(
    geoLocation === 'pending' ? null : geoLocation,
    true
  )

  // 定位成功且天气返回后，自动回写 default_city（城市名），方便下次定位被拒时回退
  useEffect(() => {
    if (!weather?.districtName || typeof geoLocation !== 'string') return
    fetch('/api/settings/weather', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ default_city: weather.districtName }),
    }).catch(() => {})
  }, [weather?.districtName, geoLocation])

  // 每秒更新指针（秒针实时走）
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  const todayLabel = TODAY.replace(/-/g, ' · ')
  const { hour, minute, second } = clockAngles(now)

  return (
    <header className={styles.masthead}>
      <div className={styles.left}>
        <div className={styles.crest}>
          <svg viewBox="0 0 60 60" width="44" height="44" aria-hidden="true">
            {/* 表盘 */}
            <circle cx="30" cy="30" r="27" fill="none" stroke="currentColor" strokeWidth="0.7"/>
            <circle cx="30" cy="30" r="24" fill="none" stroke="currentColor" strokeWidth="0.3" opacity="0.5"/>
            {/*  12 时刻度——整点粗，其余细 */}
            <line x1="30" y1="6"  x2="30" y2="10" stroke="currentColor" strokeWidth="1.0"/>
            <line x1="42" y1="10" x2="40" y2="13" stroke="currentColor" strokeWidth="0.4"/>
            <line x1="50" y1="20" x2="47" y2="22" stroke="currentColor" strokeWidth="0.4"/>
            <line x1="54" y1="30" x2="50" y2="30" stroke="currentColor" strokeWidth="1.0"/>
            <line x1="50" y1="40" x2="47" y2="38" stroke="currentColor" strokeWidth="0.4"/>
            <line x1="42" y1="50" x2="40" y2="47" stroke="currentColor" strokeWidth="0.4"/>
            <line x1="30" y1="54" x2="30" y2="50" stroke="currentColor" strokeWidth="1.0"/>
            <line x1="18" y1="50" x2="20" y2="47" stroke="currentColor" strokeWidth="0.4"/>
            <line x1="10" y1="40" x2="13" y2="38" stroke="currentColor" strokeWidth="0.4"/>
            <line x1="6"  y1="30" x2="10" y2="30" stroke="currentColor" strokeWidth="1.0"/>
            <line x1="10" y1="20" x2="13" y2="22" stroke="currentColor" strokeWidth="0.4"/>
            <line x1="18" y1="10" x2="20" y2="13" stroke="currentColor" strokeWidth="0.4"/>
            {/* 时针 */}
            <line x1="30" y1="30" x2="30" y2="19" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
              transform={`rotate(${hour}, 30, 30)`} />
            {/* 分针 */}
            <line x1="30" y1="30" x2="30" y2="10" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round"
              transform={`rotate(${minute}, 30, 30)`} />
            {/* 秒针 */}
            <line x1="30" y1="34" x2="30" y2="8" stroke="currentColor" strokeWidth="0.4" strokeLinecap="round" opacity="0.6"
              transform={`rotate(${second}, 30, 30)`} />
            {/* 轴心 */}
            <circle cx="30" cy="30" r="1.8" fill="currentColor"/>
          </svg>
        </div>
        <div className={styles.text}>
          <div className={styles.titleRow}>
            <h1 className={styles.title} onClick={() => navigate('/settings')} title="大模型设置">
              Trail
            </h1>
            {weather && (
              <span className={styles.weatherChipWrap}>
                <span className={styles.weatherChip}>
                  {weather.districtName && (
                    <span className={styles.weatherDistrict}>{weather.districtName}</span>
                  )}
                  {WEATHER_EMOJI[weather.icon] ?? '🌡'} {weather.temp}°
                </span>
                <span className={styles.weatherTooltip}>
                  <span className={styles.weatherTooltipRow}>{weather.text} · 体感 {weather.feelsLike}°</span>
                  <span className={styles.weatherTooltipRow}>湿度 {weather.humidity}% · {weather.windDir} {weather.windScale}级</span>
                </span>
              </span>
            )}
          </div>
          <p className={styles.subtitle}>
            <span className={styles.zh}>个人编年</span>
            <span className={styles.dot}>·</span>
            <span className={styles.en}>A Personal Chronicle</span>
            <span className={styles.dot}>·</span>
            <span className={styles.vol}>卷 二 / Vol. II</span>
          </p>
        </div>
      </div>
      <div className={styles.right}>
        <div className={styles.meta}>
          <span className={styles.metaLabel}>TODAY</span>
          <span className={styles.metaValue}>{todayLabel}</span>
          {overview && (
            <>
              <span className={styles.metaSep}>·</span>
              <span className={styles.metaLabel}>共计</span>
              <span className={styles.metaValue}>{overview.total_tasks} 项</span>
            </>
          )}
        </div>
        <button className="btn btn--primary" type="button" onClick={() => navigate('/new')}>
          <span className="btn-glyph">+</span>
          <span>新建条目</span>
        </button>
      </div>

      <div className={styles.breadcrumbRow}>
        <Breadcrumb />
      </div>

      <div className={styles.ticker}>
        <span className={styles.tickerInner}>
          ········································································································································································································································································································································································································
          ········································································································································································································································································································································································································
        </span>
      </div>
    </header>
  )
}
