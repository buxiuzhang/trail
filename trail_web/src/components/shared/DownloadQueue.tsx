import { useDownloadQueue, type DownloadTask } from '@/context/DownloadQueueContext'
import DeleteIcon from '@/icons/delete.svg'
import CloseCircleIcon from '@/icons/close-circle.svg'
import styles from './DownloadQueue.module.css'

function TaskRow({ task, onDismiss }: { task: DownloadTask; onDismiss: () => void }) {
  const isActive = task.status === 'downloading' || task.status === 'pending'
  return (
    <div className={styles.row}>
      <span className={styles.icon}>
        {task.status === 'done' ? '✓' : task.status === 'error' ? '✗' : '↓'}
      </span>
      <div className={styles.info}>
        <span className={styles.name}>{task.fileName}</span>
        {isActive && (
          <div className={styles.barWrap}>
            {task.progress >= 0
              ? <div className={styles.bar} style={{ width: `${task.progress}%` }} />
              : <div className={styles.barIndeterminate} />
            }
          </div>
        )}
        {task.status === 'error' && (
          <span className={styles.error}>{task.error}</span>
        )}
        {task.status === 'done' && (
          <span className={styles.done}>完成</span>
        )}
      </div>
      {isActive && task.progress >= 0 && (
        <span className={styles.percent}>{task.progress}%</span>
      )}
      {isActive && (
        <button type="button" className={styles.dismiss} onClick={onDismiss} title="取消">
          <img src={DeleteIcon} width={12} height={12} alt="取消" />
        </button>
      )}
      {!isActive && (
        <button type="button" className={styles.dismiss} onClick={onDismiss}>
          <img src={DeleteIcon} width={12} height={12} alt="关闭" />
        </button>
      )}
    </div>
  )
}

export function DownloadQueuePanel() {
  const { tasks, dismissTask } = useDownloadQueue()
  if (tasks.length === 0) return null

  const allSettled = tasks.every(t => t.status !== 'downloading' && t.status !== 'pending')

  return (
    <div className={styles.panel}>
      <div className={styles.header}>
        <span>下载队列</span>
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
