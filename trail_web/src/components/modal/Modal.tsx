import { useModalContext } from '@/context/ModalContext'
import clsx from 'clsx'
import styles from './Modal.module.css'

export function Modal() {
  const { config, closeModal } = useModalContext()

  if (!config) return null

  return (
    <div className={styles.shroud} onClick={closeModal}>
      <div
        className={styles.modal}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <div className={styles.hd}>
          <div>
            <span className={styles.eyebrow}>{config.eyebrow}</span>
            <h3
              className={clsx(
                styles.title,
                config.titleMode === 'zh' && styles.titleZh
              )}
            >
              {config.title}
            </h3>
          </div>
          <button className={styles.close} type="button" onClick={closeModal} aria-label="关闭">
            ×
          </button>
        </div>
        <div className={styles.bd}>{config.body}</div>
        {config.buttons.length > 0 && (
          <div className={styles.ft}>
            {config.buttons.map((btn, i) => (
              <button
                key={i}
                className={btn.className || 'btn btn--primary'}
                type="button"
                onClick={() => {
                  btn.action()
                  closeModal()
                }}
              >
                {btn.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
