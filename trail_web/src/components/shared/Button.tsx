import clsx from 'clsx'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  glyph?: string
  children: ReactNode
}

const variantClass: Record<string, string> = {
  default: '',
  primary: 'btn--primary',
  ghost: 'btn--ghost',
  danger: 'btn--danger',
}

const sizeClass: Record<string, string> = {
  sm: 'btn--sm',
  md: '',
  lg: 'btn--lg',
}

export function Button({ variant = 'default', size = 'md', glyph, children, className, ...props }: ButtonProps) {
  return (
    <button
      className={clsx('btn', variantClass[variant], sizeClass[size], className)}
      {...props}
    >
      {glyph && <span className="btn-glyph">{glyph}</span>}
      {children}
    </button>
  )
}
