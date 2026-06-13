import clsx from 'clsx'
import styles from './NatureBadge.module.css'

const NATURE_CSS: Record<string, string> = {
  '长期': styles.lt,
  '临时': styles.tp,
  '维护': styles.mt,
}

interface NatureBadgeProps {
  nature: string
}

export function NatureBadge({ nature }: NatureBadgeProps) {
  return (
    <span className={clsx(styles.badge, NATURE_CSS[nature] || styles.tp)}>
      {nature}
    </span>
  )
}
