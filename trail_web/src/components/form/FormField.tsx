import type { ReactNode } from 'react'

interface FormFieldProps {
  label: string
  hint?: string
  required?: boolean
  labelAction?: ReactNode
  children: ReactNode
  style?: React.CSSProperties
}

export function FormField({ label, hint, required, labelAction, children, style }: FormFieldProps) {
  return (
    <div className="field" style={style}>
      <div className="field__label">
        <span>{label}</span>
        {hint && <span className="field__hint">{hint}</span>}
        {required && <span className="field__hint">required</span>}
        {labelAction}
      </div>
      {children}
    </div>
  )
}
