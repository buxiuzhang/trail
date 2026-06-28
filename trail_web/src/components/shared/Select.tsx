import { useState, useRef, useEffect, useCallback } from 'react'

interface SelectOption {
  value: string
  label: string
}

interface SelectProps {
  value: string
  options: SelectOption[]
  onChange: (value: string) => void
  className?: string
  style?: React.CSSProperties
  disabled?: boolean
}

export function Select({ value, options, onChange, className, style, disabled }: SelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const handleClickOutside = useCallback((e: MouseEvent) => {
    if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
      setOpen(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, handleClickOutside])

  const currentLabel = options.find(o => o.value === value)?.label || value

  return (
    <div
      ref={containerRef}
      className={className}
      style={{ position: 'relative', userSelect: 'none', cursor: disabled ? 'not-allowed' : 'pointer', ...style }}
    >
      {/* 选中值展示 — 下划线风格 */}
      <div
        onClick={() => { if (!disabled) setOpen(!open) }}
        style={{
          fontFamily: 'var(--body)',
          fontSize: '16px',
          color: disabled ? 'var(--ink-ghost)' : 'var(--ink)',
          padding: '8px 0',
          borderBottom: open ? '0.5px solid var(--ink)' : '0.5px solid var(--rule)',
          transition: 'border-bottom-color 200ms ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span>{currentLabel}</span>
        <span style={{
          fontSize: '10px',
          color: 'var(--ink-ghost)',
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 150ms',
        }}>▼</span>
      </div>

      {/* 下拉面板 */}
      {open && !disabled && (
        <div style={{
          position: 'absolute',
          top: '100%',
          left: 0,
          right: 0,
          zIndex: 100,
          marginTop: 4,
          background: 'var(--card)',
          border: '0.5px solid var(--rule)',
          boxShadow: '0 8px 24px -12px rgba(60,40,15,0.25)',
          maxHeight: 220,
          overflowY: 'auto',
        }}>
          {options.map(opt => (
            <div
              key={opt.value}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              style={{
                fontFamily: 'var(--body)',
                fontSize: '15px',
                color: opt.value === value ? 'var(--green-ink)' : 'var(--ink-soft)',
                padding: '8px 12px',
                background: opt.value === value ? 'var(--green-bg)' : 'transparent',
                transition: 'background 100ms',
                cursor: 'pointer',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-deep)' }}
              onMouseLeave={e => { e.currentTarget.style.background = opt.value === value ? 'var(--green-bg)' : 'transparent' }}
            >
              {opt.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
