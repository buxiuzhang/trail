import { useLocation, useNavigate } from 'react-router-dom'
import { useWorkbench } from '@/context/WorkbenchContext'
import { MottoFooter } from './MottoFooter'
import styles from './WorkbenchSidebar.module.css'

export function WorkbenchSidebar() {
  const location = useLocation()
  const navigate = useNavigate()
  const { panel, setPanel } = useWorkbench()

  const isWorkbench = location.pathname === '/' || location.pathname === '/workbench'

  return (
    <aside className={styles.sidebar} aria-label="工作台导航">
      <nav className={styles.list}>
        <div
          className={`${styles.item} ${isWorkbench && panel === 'quick-log' ? styles.isActive : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => { if (!isWorkbench) navigate('/'); setPanel('quick-log') }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { if (!isWorkbench) navigate('/'); setPanel('quick-log') } }}
        >
          <span>快速填报</span>
        </div>
        <div
          className={`${styles.item} ${location.pathname === '/archive' ? styles.isActive : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => navigate('/archive')}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate('/archive') }}
        >
          <span>工作任务</span>
        </div>
        <div
          className={`${styles.item} ${isWorkbench && panel === 'dashboard' ? styles.isActive : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => { if (!isWorkbench) navigate('/'); setPanel('dashboard') }}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { if (!isWorkbench) navigate('/'); setPanel('dashboard') } }}
        >
          <span>工作看板</span>
        </div>
        <div
          className={`${styles.item} ${location.pathname === '/settings' ? styles.isActive : ''}`}
          role="button"
          tabIndex={0}
          onClick={() => navigate('/settings')}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') navigate('/settings') }}
        >
          <span>系统设置</span>
        </div>
      </nav>

      <MottoFooter />
    </aside>
  )
}
