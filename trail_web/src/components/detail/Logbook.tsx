import { useState } from 'react'
import type { TaskOut, LogOut } from '@/types'
import { LogCompose } from './LogCompose'
import { LogEntry } from './LogEntry'
import styles from './Logbook.module.css'

type SortOrder = 'asc' | 'desc'

interface LogbookProps {
  task: TaskOut
  logs: LogOut[]
  onSaveNew: (data: { log_date: string; content: string; phase: string }) => Promise<void>
  onSaveEdit: (logId: number, data: { log_date: string; content: string; phase: string }) => Promise<void>
  onDelete: (logId: number) => void
  onAddLogFocus: boolean
}

export function Logbook({ task, logs, onSaveNew, onSaveEdit, onDelete, onAddLogFocus }: LogbookProps) {
  const [editingLogId, setEditingLogId] = useState<number | null>(null)
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

  // 按日期+序号排序
  const key = (l: LogOut) => l.log_date + String(l.ordinal).padStart(4, '0')
  const sorted = [...logs].sort((a, b) =>
    sortOrder === 'asc' ? key(a).localeCompare(key(b)) : key(b).localeCompare(key(a))
  )

  return (
    <section className={styles.logbook}>
      <header className={styles.head}>
        <h2 className={`${styles.title} ${styles.titleZh}`}>编年日志</h2>
        <span className={styles.count}>{logs.length} entries · 可改可软删</span>
      </header>

      {/* 封版（已完成+非维护 或 已作废）不显示日志表单 */}
      {(task.status !== '已作废' && !(task.status === '已完成' && task.nature !== '维护')) ? (
        <LogCompose
          task={task}
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
        {sorted.length === 0 ? (
          <div className={styles.emptyLog}>
            <span className={styles.emptyGlyph}>∅</span>
            尚无记录。写下第一笔吧。
          </div>
        ) : (
          sorted.map(l => (
            <LogEntry
              key={l.id}
              task={task}
              log={l}
              isEditing={editingLogId === l.id}
              onEdit={() => setEditingLogId(l.id)}
              onDelete={() => onDelete(l.id)}
              onSaveEdit={async (data) => {
                await onSaveEdit(l.id, data)
                setEditingLogId(null)
              }}
              onCancelEdit={() => setEditingLogId(null)}
            />
          ))
        )}
      </div>
    </section>
  )
}
