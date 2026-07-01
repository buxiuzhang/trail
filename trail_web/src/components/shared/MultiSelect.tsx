import { useState, useRef, useEffect, useCallback } from 'react'
import ChevronDown from '@/icons/chevron-down.svg'

export interface MultiSelectOption {
  value: string
  label: string
}

interface MultiSelectProps {
  value: string[]
  options: MultiSelectOption[]
  onChange: (value: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  className?: string
  noArrow?: boolean
  underline?: boolean
  minWidth?: number
}

export function MultiSelect({
  value, options, onChange,
  placeholder = '全部',
  searchPlaceholder = '搜索…',
  className,
  noArrow = false,
  underline = false,
  minWidth = 140,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false)
      setSearch('')
    }
  }, [])

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      setTimeout(() => inputRef.current?.focus(), 50)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, handleClickOutside])

  const filtered = options.filter(o =>
    o.label.toLowerCase().includes(search.toLowerCase()) ||
    o.value.toLowerCase().includes(search.toLowerCase())
  )

  function toggle(v: string) {
    onChange(value.includes(v) ? value.filter(x => x !== v) : [...value, v])
  }

  function remove(v: string, e: React.MouseEvent) {
    e.stopPropagation()
    onChange(value.filter(x => x !== v))
  }

  const selectedLabels = value.map(v => options.find(o => o.value === v)?.label ?? v)

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', userSelect: 'none', minWidth }}
    >
      {/* 触发区 */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          fontFamily: 'var(--body)',
          fontSize: '14px',
          color: 'var(--ink)',
          padding: underline ? '4px 0' : '6px 8px',
          border: underline ? 'none' : (open ? '0.5px solid var(--ink)' : '0.5px solid var(--rule)'),
          borderBottom: underline
            ? (open ? '0.5px solid var(--ink)' : '0.5px solid var(--rule)')
            : undefined,
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 4,
          minHeight: 28,
          transition: 'border-color 150ms',
        }}
      >
        {value.length === 0 ? (
          <span style={{ color: 'var(--ink-ghost)' }}>{placeholder}</span>
        ) : (
          selectedLabels.map((label, i) => (
            <span key={value[i]} style={{
              display: 'inline-flex', alignItems: 'center', gap: 3,
              fontSize: '12px', padding: '1px 6px',
              background: 'var(--card-deep)', border: '0.5px solid var(--rule-soft)',
              color: 'var(--ink-faded)',
            }}>
              {label}
              <button
                type="button"
                onClick={e => remove(value[i], e)}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, lineHeight: 1, color: 'var(--ink-ghost)', fontSize: 11 }}
              >×</button>
            </span>
          ))
        )}
        {!noArrow && (
          <img
            src={ChevronDown}
            width={12}
            height={12}
            alt=""
            aria-hidden="true"
            style={{
              marginLeft: 'auto', opacity: 0.4, flexShrink: 0,
              transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms',
            }}
          />
        )}
      </div>

      {/* 下拉面板 */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
          marginTop: 2, background: 'var(--card)',
          border: '0.5px solid var(--rule)',
          boxShadow: '0 8px 24px -12px rgba(60,40,15,0.25)',
        }}>
          {/* 搜索框 */}
          <div style={{ padding: '6px 8px', borderBottom: '0.5px solid var(--rule-soft)' }}>
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={searchPlaceholder}
              style={{
                width: '100%', border: 'none', outline: 'none',
                fontFamily: 'var(--body)', fontSize: '13px',
                background: 'transparent', color: 'var(--ink)',
              }}
            />
          </div>
          {/* 选项列表 */}
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '10px 12px', fontSize: '13px', color: 'var(--ink-ghost)', fontStyle: 'italic' }}>
                无匹配选项
              </div>
            ) : filtered.map(opt => {
              const checked = value.includes(opt.value)
              return (
                <div
                  key={opt.value}
                  onClick={() => toggle(opt.value)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    padding: '8px 12px', cursor: 'pointer',
                    fontSize: '14px',
                    color: checked ? 'var(--ink)' : 'var(--ink-soft)',
                    background: checked ? 'var(--card-deep)' : 'transparent',
                    transition: 'background 80ms',
                  }}
                  onMouseEnter={e => { if (!checked) e.currentTarget.style.background = 'var(--paper-warm)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = checked ? 'var(--card-deep)' : 'transparent' }}
                >
                  <span style={{
                    width: 14, height: 14, border: '0.5px solid',
                    borderColor: checked ? 'var(--ink)' : 'var(--rule)',
                    background: checked ? 'var(--ink)' : 'transparent',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontSize: 10, color: 'var(--paper)',
                  }}>
                    {checked && '✓'}
                  </span>
                  {opt.label}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
