import { Link } from 'react-router-dom'
import styles from './Crumbs.module.css'

interface Crumb {
  label: string
  href?: string   // 如有 href 则为链接，否则为纯文本
}

export function Crumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className={styles.crumbs} aria-label="面包屑导航">
      {items.map((c, i) => {
        const el = c.href ? <Link to={c.href}>{c.label}</Link> : <span>{c.label}</span>
        return (
          <span key={i}>
            {i > 0 && <span className={styles.sep}>/</span>}
            {el}
          </span>
        )
      })}
    </nav>
  )
}
