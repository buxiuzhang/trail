import { useWorkbench } from '@/context/WorkbenchContext'
import { QuickLogPage } from './QuickLogPage'
import { DashboardPage } from './DashboardPage'
import styles from './WorkbenchPage.module.css'

export function WorkbenchPage() {
  const { panel, switchCount } = useWorkbench()

  return (
    <div className={styles.page}>
      {panel === 'quick-log'  && <QuickLogPage key={switchCount} />}
      {panel === 'dashboard'  && <DashboardPage />}
    </div>
  )
}
