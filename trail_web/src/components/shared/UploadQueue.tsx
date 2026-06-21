import { useUploadQueue, type UploadTask } from '@/context/UploadQueueContext'
import styles from './UploadQueue.module.css'

function TaskRow({ task }: { task: UploadTask }) {
  return (
    <div className={styles.row}>
      <span className={styles.icon}>
        {task.status === 'done' ? '✓' : task.status === 'error' ? '✗' : '↑'}
      </span>
      <div className={styles.info}>
        <span className={styles.name}>{task.fileName}</span>
        {task.status === 'uploading' && (
          <div className={styles.barWrap}>
            <div className={styles.bar} style={{ width: `${task.progress}%` }} />
          </div>
        )}
        {task.status === 'error' && (
          <span className={styles.error}>
            {task.error}
            {task.retryFn && (
              <button type="button" className={styles.retry} onClick={task.retryFn}>重试</button>
            )}
          </span>
        )}
        {task.status === 'done' && (
          <span className={styles.done}>完成</span>
        )}
      </div>
      {task.status === 'uploading' && (
        <span className={styles.percent}>{task.progress}%</span>
      )}
    </div>
  )
}

export function UploadQueuePanel() {
  const { tasks } = useUploadQueue()
  if (tasks.length === 0) return null

  return (
    <div className={styles.panel}>
      <div className={styles.header}>上传队列</div>
      {tasks.map(t => <TaskRow key={t.id} task={t} />)}
    </div>
  )
}
