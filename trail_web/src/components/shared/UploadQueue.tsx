import { useUploadQueue, type UploadTask } from '@/context/UploadQueueContext'
import CloseCircleIcon from '@/icons/close-circle.svg'
import DeleteIcon from '@/icons/delete.svg'
import styles from './UploadQueue.module.css'

function TaskRow({ task, onDismiss }: { task: UploadTask; onDismiss: () => void }) {
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
      {task.status !== 'uploading' && (
        <button type="button" className={styles.dismiss} onClick={onDismiss}>
          <img src={DeleteIcon} width={12} height={12} alt="关闭" />
        </button>
      )}
    </div>
  )
}

export function UploadQueuePanel() {
  const { tasks, dismissTask } = useUploadQueue()
  if (tasks.length === 0) return null

  const allSettled = tasks.every(t => t.status !== 'uploading')

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>上传队列</span>
        {allSettled && (
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => tasks.forEach(t => dismissTask(t.id))}
          >
            <img src={CloseCircleIcon} width={12} height={12} alt="关闭" />
          </button>
        )}
      </div>
      {tasks.map(t => <TaskRow key={t.id} task={t} onDismiss={() => dismissTask(t.id)} />)}
    </div>
  )
}
