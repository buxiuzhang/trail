import { useWorkbench } from '@/context/WorkbenchContext'
import { QuickLogPage } from './QuickLogPage'
import styles from './WorkbenchPage.module.css'

export function WorkbenchPage() {
  const { panel } = useWorkbench()

  return (
    <div className={styles.page}>
      {panel === 'quick-log' && <QuickLogPage />}
    </div>
  )
}
