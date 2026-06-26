import { useNavigate } from 'react-router-dom'
import type { TaskOut } from '@/types'
import { isSealed } from '@/constants'
import { ContactChip } from './ContactChip'
import { SummaryBox } from './SummaryBox'
import { Button } from '@/components/shared/Button'
import styles from './MetaPane.module.css'

interface MetaPaneProps {
  task: TaskOut
  lastLogDate: string | null
  collapsed: boolean
  onToggleCollapse: () => void
  onChangeStatus: () => void
  onCancel: () => void
}

function MetaRow({ label, value, mono = false }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div className={styles.row}>
      <span className={styles.rowLabel}>{label}</span>
      <span className={`${styles.rowValue} ${mono ? styles.rowValueMono : ''}`}>
        {value || '—'}
      </span>
    </div>
  )
}

export function MetaPane({ task, lastLogDate, collapsed, onToggleCollapse, onChangeStatus, onCancel }: MetaPaneProps) {
  const navigate = useNavigate()

  return (
    <aside className={`${styles.pane} ${collapsed ? styles.collapsed : ''}`}>
      {/* 折叠按钮 */}
      <button
        type="button"
        className={styles.toggle}
        onClick={onToggleCollapse}
        title={collapsed ? '展开编目信息' : '折叠编目信息'}
      >
        <span className={styles.toggleIcon}>{collapsed ? '▶' : '◀'}</span>
        {collapsed && <span className={styles.toggleLabel}>编目</span>}
      </button>

      {!collapsed && (
        <>
          <h3 className={styles.title}>编目信息</h3>

          <div className={`${styles.row} ${styles.rowContacts}`}>
            <span className={styles.rowLabel}>对接渠道</span>
            <div className={`${styles.rowValue} ${styles.rowValueContacts}`}>
              {task.contacts.length === 0
                ? <span style={{color:'var(--ink-ghost)', fontStyle:'italic'}}>无</span>
                : task.contacts.map(c => <ContactChip key={c.id} contact={c} />)
              }
            </div>
          </div>

          <MetaRow label="任务开始" value={task.start_date} mono />
          <MetaRow label="开始处理" value={task.processing_date} mono />
          <MetaRow label="完成时间" value={task.end_date} mono />
          <MetaRow label="最近记录" value={lastLogDate} mono />
          <MetaRow label="状态" value={task.status} />

          {task.summary && <SummaryBox label="主体总结" content={task.summary} />}
          {task.maintenance_summary && <SummaryBox label="维护期总结" content={task.maintenance_summary} variant="maintenance" />}

          <div className={styles.actions}>
            {/* 封版不显示"编辑任务""作废此条"——已完成+维护仍可编辑以修改维护配置 */}
            {!isSealed(task) && (
              <Button glyph="✎" variant="default" onClick={() => navigate(`/edit/${task.id}`)}>编辑任务</Button>
            )}
            {/* 进行中可完成；已完成+维护可结束维护期 */}
            {(task.status === '进行中' || (task.status === '已完成' && task.nature === '维护')) && (
              <Button variant="ghost" onClick={onChangeStatus}>变更状态</Button>
            )}
            {!isSealed(task) && (
              <Button variant="danger" onClick={onCancel}>作废此条</Button>
            )}
          </div>
        </>
      )}
    </aside>
  )
}
