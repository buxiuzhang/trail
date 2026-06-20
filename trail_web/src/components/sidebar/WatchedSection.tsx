import { useId, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useWatchedTasks } from '@/api/tasks'
import { useWatchSettings } from '@/api/settings'
import styles from './WatchedSection.module.css'
import filterStyles from './FilterSection.module.css'

export function WatchedSection() {
  const { data: tasks = [] } = useWatchedTasks()
  const [expanded, setExpanded] = useState(true)
  const listId = useId()
  const navigate = useNavigate()
  const { hotDays, warnDays } = useWatchSettings()

  if (tasks.length === 0) return null

  const getIdle = (task: import('@/types').TaskOut) => {
    const lastDate = task.last_log_date || task.processing_date || task.start_date
    if (!lastDate) return -1
    const [y, m, d] = lastDate.split('-').map(Number)
    return Math.floor((Date.now() - new Date(y, m - 1, d).getTime()) / 86400000)
  }

  const sorted = [...tasks].sort((a, b) => getIdle(b) - getIdle(a))

  return (
    <section className={filterStyles.block}>
      <h2 className={filterStyles.title}>
        <button
          type="button"
          className={filterStyles.titleBtn}
          onClick={() => setExpanded(v => !v)}
          aria-expanded={expanded}
          aria-controls={listId}
        >
          <span className={filterStyles.titleText}>特别关注</span>
          <span className={filterStyles.caret} aria-hidden="true">{expanded ? '▾' : '▸'}</span>
        </button>
      </h2>
      <ul
        id={listId}
        className={`${filterStyles.list} ${expanded ? '' : filterStyles.listCollapsed}`}
        role="list"
      >
        {sorted.map(task => (
          <li
            key={task.id}
            className={styles.item}
            role="button"
            tabIndex={0}
            onClick={() => navigate(`/task/${task.id}`)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') navigate(`/task/${task.id}`) }}
          >
            <span className={styles.name}>{task.title}</span>
            <IdleBadge task={task} hotDays={hotDays} warnDays={warnDays} />
          </li>
        ))}
      </ul>
    </section>
  )
}

function IdleBadge({ task, hotDays, warnDays }: {
  task: import('@/types').TaskOut
  hotDays: number
  warnDays: number
}) {
  const lastDate = task.last_log_date || task.processing_date || task.start_date
  if (!lastDate) return null
  const today = new Date()
  const [y, m, d] = lastDate.split('-').map(Number)
  const idle = Math.floor((today.getTime() - new Date(y, m - 1, d).getTime()) / 86400000)
  const hot = idle <= hotDays
  const warn = idle >= warnDays
  return (
    <span className={`${styles.idle} ${hot ? styles.hot : ''} ${warn ? styles.warn : ''}`}>
      {idle}天
    </span>
  )
}
