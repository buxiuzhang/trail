import { useState, useMemo, useEffect, useRef } from 'react'
import styles from './CronEditor.module.css'

// ── 字段定义 ──────────────────────────────────────────────────
interface FieldDef {
  key: 'min' | 'hour' | 'dom' | 'month' | 'dow'
  label: string
  min: number
  max: number
  labels?: string[]   // 可选显示名（月份、星期）
}

const FIELDS: FieldDef[] = [
  { key: 'min',   label: '分钟', min: 0, max: 59 },
  { key: 'hour',  label: '小时', min: 0, max: 23 },
  { key: 'dom',   label: '日期', min: 1, max: 31 },
  { key: 'month', label: '月份', min: 1, max: 12,
    labels: ['','1月','2月','3月','4月','5月','6月','7月','8月','9月','10月','11月','12月'] },
  { key: 'dow',   label: '星期', min: 0, max: 6,
    labels: ['周日','周一','周二','周三','周四','周五','周六'] },
]

type Mode = 'every' | 'specific' | 'range' | 'step'

interface FieldState {
  mode: Mode
  specific: number[]   // 指定
  rangeFrom: number
  rangeTo: number
  stepFrom: number
  stepVal: number
}

function defaultState(f: FieldDef): FieldState {
  return {
    mode: 'every',
    specific: [],
    rangeFrom: f.min,
    rangeTo: f.max,
    stepFrom: f.min,
    stepVal: 1,
  }
}

function buildPart(state: FieldState, f: FieldDef): string {
  switch (state.mode) {
    case 'every': return '*'
    case 'specific':
      return state.specific.length === 0 ? '*' : [...state.specific].sort((a,b)=>a-b).join(',')
    case 'range':
      return `${state.rangeFrom}-${state.rangeTo}`
    case 'step':
      return `${state.stepFrom}/${state.stepVal}`
  }
}

function buildExpr(states: Record<string, FieldState>): string {
  return FIELDS.map(f => buildPart(states[f.key], f)).join(' ')
}

// ── 人类可读描述 ──────────────────────────────────────────────
function describe(expr: string): string {
  if (!expr) return ''
  const p = expr.trim().split(/\s+/)
  if (p.length !== 5) return '格式有误'
  const [min, hour, , , dow] = p

  const hourDesc = () => {
    if (hour === '*') return '每小时'
    if (hour.includes('/')) { const [s,v]=hour.split('/'); return `从 ${s} 点起每 ${v} 小时` }
    if (hour.includes('-')) { const [a,b]=hour.split('-'); return `${a}:00~${b}:00` }
    return hour.split(',').map(h=>`${h}:${min==='*'?'00':min.padStart(2,'0')}`).join('、') + ' 点'
  }

  const minDesc = () => {
    if (min === '*') return '每分钟'
    if (min.includes('/')) { const [s,v]=min.split('/'); return `从 ${s} 分起每 ${v} 分钟` }
    if (min.includes('-')) { const [a,b]=min.split('-'); return `第 ${a}~${b} 分钟` }
    if (hour !== '*') return ''   // 小时已含分钟信息
    return `第 ${min} 分钟`
  }

  const dowDesc = () => {
    if (dow === '*') return ''
    const names = ['周日','周一','周二','周三','周四','周五','周六']
    if (dow.includes('-')) {
      const [a,b]=dow.split('-')
      return `${names[+a]||a}至${names[+b]||b}`
    }
    return dow.split(',').map(d=>names[+d]||d).join('、')
  }

  const parts = [dowDesc(), hourDesc(), minDesc()].filter(Boolean)
  return parts.join(' ') || expr
}

// ── 最近 N 次运行时间 ─────────────────────────────────────────
function nextTimes(expr: string, n = 5): string[] {
  const p = expr.trim().split(/\s+/)
  if (p.length !== 5) return []
  const [minE, hourE, , , dowE] = p

  function matches(val: number, field: string, max: number): boolean {
    if (field === '*') return true
    if (field.includes('/')) {
      const [s, step] = field.split('/').map(Number)
      for (let i = s; i <= max; i += step) if (i === val) return true
      return false
    }
    if (field.includes('-')) {
      const [a, b] = field.split('-').map(Number)
      return val >= a && val <= b
    }
    return field.split(',').map(Number).includes(val)
  }

  const results: string[] = []
  const now = new Date()
  now.setSeconds(0, 0)
  now.setMinutes(now.getMinutes() + 1)

  for (let i = 0; i < 60 * 24 * 7 && results.length < n; i++) {
    const d = now.getDay()   // 0=Sun
    const h = now.getHours()
    const m = now.getMinutes()
    if (matches(m, minE, 59) && matches(h, hourE, 23) && matches(d, dowE, 6)) {
      const y = now.getFullYear()
      const mo = String(now.getMonth()+1).padStart(2,'0')
      const dd = String(now.getDate()).padStart(2,'0')
      const hh = String(h).padStart(2,'0')
      const mm = String(m).padStart(2,'0')
      results.push(`${y}-${mo}-${dd} ${hh}:${mm}`)
    }
    now.setMinutes(now.getMinutes() + 1)
  }
  return results
}

function parseStates(value: string): Record<string, FieldState> | null {
  const init: Record<string, FieldState> = {}
  FIELDS.forEach(f => { init[f.key] = defaultState(f) })
  const p = value?.trim().split(/\s+/)
  if (!p || p.length !== 5) return null
  FIELDS.forEach((f, i) => {
    const part = p[i]
    if (part === '*') return
    if (part.includes('/')) {
      const [s, v] = part.split('/').map(Number)
      init[f.key] = { ...init[f.key], mode: 'step', stepFrom: s, stepVal: v }
    } else if (part.includes('-')) {
      const [a, b] = part.split('-').map(Number)
      init[f.key] = { ...init[f.key], mode: 'range', rangeFrom: a, rangeTo: b }
    } else {
      init[f.key] = { ...init[f.key], mode: 'specific', specific: part.split(',').map(Number) }
    }
  })
  return init
}

// ── 主组件 ───────────────────────────────────────────────────
export function CronEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [activeTab, setActiveTab] = useState<FieldDef['key']>('min')
  const [states, setStates] = useState<Record<string, FieldState>>(() => {
    return parseStates(value) ?? (() => {
      const init: Record<string, FieldState> = {}
      FIELDS.forEach(f => { init[f.key] = defaultState(f) })
      return init
    })()
  })

  const expr = useMemo(() => buildExpr(states), [states])

  // 当外部 value 变化时（如 settings 异步加载完）同步内部 states
  const prevValue = useRef('')
  const prevExpr = useRef('')
  useEffect(() => {
    if (value === prevValue.current) return
    prevValue.current = value
    const p = parseStates(value)
    if (p) {
      setStates(p)
      prevExpr.current = buildExpr(p)
    }
  }, [value])

  // 同步到父组件
  const update = (key: string, patch: Partial<FieldState>) => {
    setStates(prev => {
      const next = { ...prev, [key]: { ...prev[key], ...patch } }
      return next
    })
  }

  // expr 变化时同步到父组件（在 effect 里调用，避免在 render/setState 期间触发父组件更新）
  useEffect(() => {
    if (expr === prevExpr.current) return
    prevExpr.current = expr
    prevValue.current = expr  // 标记为"已知"，防止父组件回传时触发重新解析
    onChange(expr)
  }, [expr, onChange])

  const field = FIELDS.find(f => f.key === activeTab)!
  const state = states[activeTab]

  const MODES: { key: Mode; label: string }[] = [
    { key: 'every',    label: '每' },
    { key: 'specific', label: '指定' },
    { key: 'range',    label: '范围' },
    { key: 'step',     label: '步长' },
  ]

  function toggleSpecific(v: number) {
    const cur = state.specific
    const next = cur.includes(v) ? cur.filter(x => x !== v) : [...cur, v]
    update(activeTab, { specific: next })
  }

  const desc = describe(expr)
  const times = useMemo(() => nextTimes(expr), [expr])

  return (
    <div className={styles.wrap}>
      {/* Tab 栏 */}
      <div className={styles.tabs}>
        {FIELDS.map(f => (
          <button
            key={f.key}
            type="button"
            className={`${styles.tab} ${activeTab === f.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(f.key)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 面板 */}
      <div className={styles.panel}>
        {/* 模式选择 */}
        <div className={styles.modes}>
          {MODES.map(m => (
            <button
              key={m.key}
              type="button"
              className={`${styles.modeBtn} ${state.mode === m.key ? styles.modeBtnActive : ''}`}
              onClick={() => update(activeTab, { mode: m.key })}
            >
              {m.label}
            </button>
          ))}
        </div>

        {/* 每 */}
        {state.mode === 'every' && (
          <div className={styles.control}>
            <span>* — 不限制，每个{field.label}都执行</span>
          </div>
        )}

        {/* 指定 */}
        {state.mode === 'specific' && (
          <div className={styles.chips}>
            {Array.from({ length: field.max - field.min + 1 }, (_, i) => i + field.min).map(v => {
              const lbl = field.labels ? field.labels[v] : String(v)
              return (
                <button
                  key={v}
                  type="button"
                  className={`${styles.chip} ${state.specific.includes(v) ? styles.chipActive : ''}`}
                  onClick={() => toggleSpecific(v)}
                >
                  {lbl}
                </button>
              )
            })}
          </div>
        )}

        {/* 范围 */}
        {state.mode === 'range' && (
          <div className={styles.control}>
            <span>从</span>
            <input
              type="number" className={styles.numInput}
              min={field.min} max={field.max}
              value={state.rangeFrom}
              onChange={e => update(activeTab, { rangeFrom: +e.target.value })}
            />
            <span>到</span>
            <input
              type="number" className={styles.numInput}
              min={field.min} max={field.max}
              value={state.rangeTo}
              onChange={e => update(activeTab, { rangeTo: +e.target.value })}
            />
            {field.labels && (
              <span style={{ fontSize: '11px', color: 'var(--ink-ghost)' }}>
                （{field.labels[state.rangeFrom]}–{field.labels[state.rangeTo]}）
              </span>
            )}
          </div>
        )}

        {/* 步进 */}
        {state.mode === 'step' && (
          <div className={styles.control}>
            <span>从</span>
            <input
              type="number" className={styles.numInput}
              min={field.min} max={field.max}
              value={state.stepFrom}
              onChange={e => update(activeTab, { stepFrom: +e.target.value })}
            />
            <span>起，每隔</span>
            <input
              type="number" className={styles.numInput}
              min={1} max={field.max}
              value={state.stepVal}
              onChange={e => update(activeTab, { stepVal: +e.target.value })}
            />
            <span>{field.label}执行一次</span>
          </div>
        )}
      </div>

      {/* 底部预览 */}
      <div className={styles.footer}>
        <div className={styles.exprRow}>
          <code className={styles.expr}>{expr}</code>
          <span className={`${styles.desc} ${desc === '格式有误' ? styles.descError : ''}`}>
            → {desc}
          </span>
        </div>
        {times.length > 0 && (
          <>
            <span className={styles.nextLabel}>最近 {times.length} 次运行</span>
            <div className={styles.nextTimes}>
              {times.map(t => <span key={t} className={styles.nextTime}>{t}</span>)}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
