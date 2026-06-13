import { useId, useState } from 'react'
import styles from './FilterSection.module.css'

interface FilterItemData {
  key: string
  label: string
  count: number
}

interface FilterSectionProps {
  title: string
  items: FilterItemData[]
  activeKey: string
  onSelect: (key: string) => void
  defaultExpanded?: boolean
}

export function FilterSection({ title, items, activeKey, onSelect, defaultExpanded = true }: FilterSectionProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const listId = useId()

  return (
    <section className={styles.block}>
      <h2 className={styles.title}>
        <button
          type="button"
          className={styles.titleBtn}
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
        >
          <span className={styles.titleText}>{title}</span>
          <span className={styles.caret} aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </button>
      </h2>
      <ul
        id={listId}
        className={`${styles.list} ${expanded ? '' : styles.listCollapsed}`}
        role="list"
      >
        {items.map(item => (
          <li
            key={item.key}
            className={`${styles.item} ${activeKey === item.key ? styles.isActive : ''}`}
            onClick={() => onSelect(item.key)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(item.key) }}
          >
            <span>{item.label}</span>
            <span className={styles.count}>{item.count}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
