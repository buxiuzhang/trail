import type { TaskOut, LogOut } from '@/types'
import { isSealed } from '@/constants'
import { LogCompose } from './LogCompose'
import { RichText } from '@/components/shared/RichText'
import styles from './Logbook.module.css'

interface LogEntryProps {
  task: TaskOut
  log: LogOut
  isEditing: boolean
  onEdit: () => void
  onDelete: () => void
  onSaveEdit: (data: { log_date: string; content: string; phase: string }) => Promise<void>
  onCancelEdit: () => void
}

export function LogEntry({ task, log, isEditing, onEdit, onDelete, onSaveEdit, onCancelEdit }: LogEntryProps) {
  const sealed = isSealed(task)
  // 编辑态：整条替换为 compose form
  if (isEditing) {
    return (
      <div className={`${styles.entry} ${log.phase === 'maintenance' ? styles.entryMt : ''} ${styles.entryEditing}`}>
        <LogCompose task={task} editing={log} onSave={onSaveEdit} onCancel={onCancelEdit} />
      </div>
    )
  }

  const isMt = log.phase === 'maintenance'
  const editedTag = log.updated_at
    ? <span className={styles.edited} title={log.updated_at}>已改 {log.edit_count} 次</span>
    : null

  return (
    <div className={`${styles.entry} ${isMt ? styles.entryMt : ''}`}>
      <div className={styles.date}>
        <span className={styles.dateDay}>{log.log_date.slice(8, 10)}</span>
        <span>{log.log_date.slice(5, 7)}/{log.log_date.slice(2, 4)}</span>
        <span className={styles.dateYr}>{log.log_date.slice(0, 4)}</span>
      </div>
      <span className={styles.dot} aria-hidden="true" />
      <div className={styles.body}>
        <div className={styles.topline}>
          <span className={styles.phase}>{isMt ? 'maintenance' : 'main'}</span>
          <span className={styles.ord}>№ {String(log.id).padStart(3, '0')}</span>
          {editedTag}
        </div>
        <RichText text={log.content} className={styles.content} />
        {log.polished_content && (
          <div className={styles.polish}>
            <span className={styles.polishLabel}>润色后</span>
            <RichText text={log.polished_content} />
          </div>
        )}
        <div className={styles.actions}>
          <button type="button" onClick={onEdit} disabled={sealed}>编辑</button>
          <button type="button" onClick={onDelete} disabled={sealed}>软删</button>
        </div>
      </div>
    </div>
  )
}
