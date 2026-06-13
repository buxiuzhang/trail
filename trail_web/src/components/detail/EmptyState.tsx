interface EmptyStateProps {
  glyph: string
  title: string
  subtitle?: string
}

export function EmptyState({ glyph, title, subtitle }: EmptyStateProps) {
  return (
    <div className="empty">
      <div className="empty__glyph">{glyph}</div>
      <div className="empty__title">{title}</div>
      {subtitle && <div className="empty__sub">{subtitle}</div>}
    </div>
  )
}
