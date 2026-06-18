import { useState, useEffect, useRef } from 'react'
import type { TaskOut, LogOut, TodoOut } from '@/types'
import { LogCompose } from './LogCompose'
import { LogEntry } from './LogEntry'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import styles from './Logbook.module.css'

type SortOrder = 'asc' | 'desc'

interface LogbookProps {
  task: TaskOut
  logs: LogOut[]
  todos: TodoOut[]
  tasks?: TaskOut[]
  onSaveNew: (data: { log_date: string; content: string; phase: string; hours: number; todo_ids: number[]; task_ids: number[] }) => Promise<void>
  onSaveEdit: (logId: number, data: { log_date: string; content: string; phase: string; hours: number; todo_ids: number[]; task_ids: number[] }) => Promise<void>
  onDelete: (logId: number) => void
  onAddLogFocus: boolean
  revealLogId?: number
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
}

export function Logbook({ task, logs, todos, tasks = [], onSaveNew, onSaveEdit, onDelete, onAddLogFocus, revealLogId, fetchNextPage, hasNextPage, isFetchingNextPage }: LogbookProps) {
  const [editingLogId, setEditingLogId] = useState<number | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const prevRevealId = useRef<number | undefined>(undefined)
  const sentinelRef = useInfiniteScroll(fetchNextPage, hasNextPage, isFetchingNextPage)

  // 按日期+序号排序（后端已 desc，asc 时前端反转）
  const key = (l: LogOut) => l.log_date + String(l.ordinal).padStart(4, '0')
  const sorted = sortOrder === 'desc'
    ? logs
    : [...logs].sort((a, b) => key(a).localeCompare(key(b)))

  // reveal：目标已在当前 logs 中则直接 scroll + 高亮
  useEffect(() => {
    if (!revealLogId || revealLogId === prevRevealId.current || logs.length === 0) return
    prevRevealId.current = revealLogId

    const doReveal = () => {
      const el = document.getElementById(`log-${revealLogId}`)
      if (!el) return
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      el.classList.remove('log-highlight')
      requestAnimationFrame(() => {
        el.classList.add('log-highlight')
        el.addEventListener('animationend', () => el.classList.remove('log-highlight'), { once: true })
      })
    }

    const el = document.getElementById(`log-${revealLogId}`)
    if (el) {
      requestAnimationFrame(doReveal)
    } else {
      // 目标还没加载：连续翻页直到出现或无更多
      const tryLoad = () => {
        if (document.getElementById(`log-${revealLogId}`)) {
          doReveal()
          return
        }
        if (hasNextPageRef.current && !isFetchingNextPageRef.current) {
          fetchNextPage()
          setTimeout(tryLoad, 300)
        }
      }
      setTimeout(tryLoad, 100)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealLogId])

  return (
    <section className={styles.logbook}>
      <header className={styles.head}>
        <h2 className={`${styles.title} ${styles.titleZh}`}>编年日志</h2>
        <span className={styles.count}>{logs.length} entries · 可改可软删</span>
      </header>

      {(task.status !== '已作废' && !(task.status === '已完成' && task.nature !== '维护')) ? (
        <LogCompose
          task={task}
          todos={todos}
          tasks={tasks}
          editing={null}
          onSave={onSaveNew}
          onCancel={() => {}}
        />
      ) : (
        <div className={styles.emptyLog}>
          <span className={styles.emptyGlyph}>✕</span>
          此任务已封版，不再接受新日志。
        </div>
      )}

      <div className={styles.sortBar}>
        <span className={styles.sortLabel}>
          {sortOrder === 'desc' ? '最新在前' : '最早在前'}
        </span>
        <button
          type="button"
          className={`${styles.sortBtn} ${sortOrder === 'desc' ? styles.sortActive : ''}`}
          onClick={() => setSortOrder('desc')}
        >
          倒序
        </button>
        <span className={styles.sortSep}>|</span>
        <button
          type="button"
          className={`${styles.sortBtn} ${sortOrder === 'asc' ? styles.sortActive : ''}`}
          onClick={() => setSortOrder('asc')}
        >
          正序
        </button>
      </div>

      <div className={styles.entries}>
        {sorted.length === 0 && !hasNextPage ? (
          <div className={styles.emptyLog}>
            <span className={styles.emptyGlyph}>∅</span>
            尚无记录。写下第一笔吧。
          </div>
        ) : (
          <>
            {sorted.map(l => (
              <LogEntry
                key={l.id}
                task={task}
                log={l}
                todos={todos}
                tasks={tasks}
                isEditing={editingLogId === l.id}
                onEdit={() => setEditingLogId(l.id)}
                onDelete={() => onDelete(l.id)}
                onSaveEdit={async (data) => {
                  await onSaveEdit(l.id, data)
                  setEditingLogId(null)
                }}
                onCancelEdit={() => setEditingLogId(null)}
              />
            ))}
            <div ref={sentinelRef} />
          </>
        )}
      </div>
    </section>
  )
}
