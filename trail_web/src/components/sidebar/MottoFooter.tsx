import { useMotto } from '@/api/settings'
import styles from './MottoFooter.module.css'

export function MottoFooter() {
  const { data: motto } = useMotto()
  if (!motto) return null

  return (
    <div className={styles.foot}>
      <div className={styles.footLine}>
        <span className={styles.footTitle}>卷首语</span>
        <div className={styles.footRule} />
      </div>
      <p className={styles.footNote} style={{ whiteSpace: 'pre-line' }}>
        {motto}
      </p>
      <p className={styles.footSig}>— 自 2025</p>
    </div>
  )
}
