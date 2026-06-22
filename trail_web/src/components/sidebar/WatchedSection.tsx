import { useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { useWatchedTasks, useUnwatchTask } from '@/api/tasks'
import { useWatchSettings } from '@/api/settings'
import type { TaskOut } from '@/types'
import styles from './WatchedSection.module.css'
import filterStyles from './FilterSection.module.css'

export function WatchedSection() {
  const { data: tasks = [] } = useWatchedTasks()
  const [expanded, setExpanded] = useState(true)
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; task: TaskOut } | null>(null)
  const listId = useId()
  const navigate = useNavigate()
  const { hotDays, warnDays } = useWatchSettings()

  if (tasks.length === 0) return null

  const getIdle = (task: TaskOut) => {
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
            onContextMenu={(e) => {
              e.preventDefault()
              setCtxMenu({ x: e.clientX, y: e.clientY, task })
            }}
          >
            <span className={styles.name}>{task.title}</span>
            <IdleBadge task={task} hotDays={hotDays} warnDays={warnDays} />
          </li>
        ))}
      </ul>
      {ctxMenu && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setCtxMenu(null)} />
          <WatchedCtxMenu
            task={ctxMenu.task}
            x={ctxMenu.x}
            y={ctxMenu.y}
            onClose={() => setCtxMenu(null)}
          />
        </>,
        document.body
      )}
    </section>
  )
}

function WatchedCtxMenu({ task, x, y, onClose }: { task: TaskOut; x: number; y: number; onClose: () => void }) {
  const unwatch = useUnwatchTask(task.id)
  return (
    <div
      style={{
        position: 'fixed', top: y, left: x, zIndex: 1000,
        background: 'var(--card)', border: '0.5px solid var(--rule-soft)',
        boxShadow: '0 8px 24px -8px rgba(60,40,15,0.18)',
        borderRadius: 4, minWidth: 120, padding: '4px 0',
      }}
    >
      <div
        style={{
          padding: '6px 14px', fontFamily: 'var(--body)', fontSize: 13,
          color: 'var(--ink-soft)', cursor: 'pointer',
        }}
        onClick={async () => {
          onClose()
          await unwatch.mutateAsync()
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'var(--card-deep)' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      >
        取消关注
      </div>
    </div>
  )
}

function IdleBadge({ task, hotDays, warnDays }: {
  task: TaskOut
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
