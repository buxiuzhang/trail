import { MarkdownRenderer } from '@/components/shared/MarkdownRenderer'

interface SummaryBoxProps {
  label: string
  content: string
  variant?: 'main' | 'maintenance'
}

export function SummaryBox({ label, content, variant = 'main' }: SummaryBoxProps) {
  const className = variant === 'maintenance' ? 'summary-box summary-box--mt' : 'summary-box'
  return (
    <div className={className}>
      <span className="summary-box__label">{label}</span>
      <MarkdownRenderer text={content} />
    </div>
  )
}
