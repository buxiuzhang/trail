import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TaskOut } from '@/types'
import { usePinTask, useUnpinTask, useWatchTask, useUnwatchTask } from '@/api/tasks'
import { useToastContext } from '@/context/ToastContext'
import { ContentViewer } from '@/components/shared/ContentViewer'
import { Stamp } from './Stamp'
import { NatureBadge } from './NatureBadge'
import { TaskContextMenu } from './TaskContextMenu'
import styles from './TaskCard.module.css'

interface TaskCardProps {
  task: TaskOut
  logCount?: number
  logMainCount?: number
}

/** 根据 created_at 和全局 id 生成编目号 */
function catalogOf(task: TaskOut): { display: string; year: string; seq: string } {
  const y = task.created_at?.slice(0, 4) || '????'
  const seq = String(task.id).padStart(4, '0')
  return { display: `${y} · ${seq}`, year: y, seq }
}

/** 联系人摘要 */
function contactSummary(contacts: TaskOut['contacts']): string {
  if (!contacts || !contacts.length) return '—'
  const persons = contacts.filter(c => c.kind === 'person').length
  const groups = contacts.filter(c => c.kind === 'group').length
  const parts: string[] = []
  if (groups) parts.push(`${groups} 群`)
  if (persons) parts.push(`${persons} 人`)
  if (!parts.length) parts.push(`${contacts.length} 条`)
  return parts.join(' · ')
}

/** 格式化日期为 YYYY · MM · DD */
function fmtDatePretty(d: string | null): string {
  if (!d) return '—'
  const [y, m, day] = d.split('-')
  return `${y} · ${m} · ${day}`
}

/** 闲置天数（用本地日期比较，避免时区问题） */
function daysSince(dateStr: string | null): number | null {
  if (!dateStr) return null
  // 用本地日期字符串比较，避免 new Date() 的时区问题
  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const [y1, m1, d1] = todayStr.split('-').map(Number)
  const [y2, m2, d2] = dateStr.split('-').map(Number)
  // 简单天数差（不考虑时区）
  const days = (new Date(y1, m1 - 1, d1).getTime() - new Date(y2, m2 - 1, d2).getTime()) / 86400000
  return Math.floor(days)
}

/** 工时换算：8h=1天、40h=1周、176h(22*8)=1月 */
function formatHours(hours: number): string {
  if (!hours || hours <= 0) return '—'
  const MONTH_HOURS = 22 * 8   // 176
  const WEEK_HOURS = 40
  const DAY_HOURS = 8

  const months = Math.floor(hours / MONTH_HOURS)
  const rem1 = hours % MONTH_HOURS
  const weeks = Math.floor(rem1 / WEEK_HOURS)
  const rem2 = rem1 % WEEK_HOURS
  const days = Math.floor(rem2 / DAY_HOURS)
  const remainHours = rem2 % DAY_HOURS

  // 优先级：月 > 周 > 天 > 小时
  const parts: string[] = []
  if (months) parts.push(`${months} 月`)
  if (weeks) parts.push(`${weeks} 周`)
  if (days) parts.push(`${days} 天`)
  // 小时保留一位小数，0.5 显示为 0.5 小时
  if (remainHours && !months) {
    const h = remainHours % 1 === 0 ? String(remainHours) : remainHours.toFixed(1)
    parts.push(`${h} 小时`)
  }

  return parts.join(' ') || '—'
}

const NATURE_EN: Record<string, string> = {
  '长期': 'long-term',
  '临时': 'ad-hoc',
  '维护': 'maintenance',
}

export function TaskCard({ task, logCount = 0, logMainCount = 0 }: TaskCardProps) {
  const navigate = useNavigate()
  const pinTask = usePinTask(task.id)
  const unpinTask = useUnpinTask(task.id)
  const watchTask = useWatchTask(task.id)
  const unwatchTask = useUnwatchTask(task.id)
  const { showToast } = useToastContext()
  const catalog = catalogOf(task)
  const pinned = !!task.pinned_at
  const watched = !!task.watched_at

  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  // 待办三态计数：来自 task 字段（后端 SQL 聚合），不再 N+1 拉 /todos
  const todoActive = task.todo_active_count
  const todoCompleted = task.todo_completed_count
  const todoAbandoned = task.todo_abandoned_count

  async function handlePin(e: React.MouseEvent) {
    e.stopPropagation()
    if (e.detail >= 2) return
    try {
      if (pinned) {
        await unpinTask.mutateAsync(undefined as any)
        showToast('已取消置顶')
      } else {
        await pinTask.mutateAsync(undefined as any)
        showToast('已置顶')
      }
    } catch (err: any) {
      showToast('操作失败：' + err.message)
    }
  }

  async function handleWatch() {
    try {
      if (watched) {
        await unwatchTask.mutateAsync(undefined as any)
        showToast('已取消关注')
      } else {
        await watchTask.mutateAsync(undefined as any)
        showToast('已添加到特别关注')
      }
    } catch (err: any) {
      showToast('操作失败：' + err.message)
    }
  }

  // 统计日志（从缓存取不到，用占位）
  const contactLabel = contactSummary(task.contacts)

  // 日志摘要
  const logMtCount = logCount - logMainCount
  let logSummary = `${logCount} 条 (main ${logMainCount}`
  if (logMtCount > 0) logSummary += ` / mt ${logMtCount}`
  logSummary += ')'

  // 闲置天数：用派生 last_log_date（无日志回退到 processing_date / start_date）
  const lastDate = task.last_log_date || task.processing_date || task.start_date
  const idle = lastDate ? daysSince(lastDate) : null
  const idleLabel = idle != null ? `${idle} 天` : '—'

  // 总工时换算
  const hoursLabel = formatHours(task.total_hours)

  return (
    <>
      <div className={styles.cardWrap} onContextMenu={handleContextMenu}>
        <span
          className={`${styles.pinBtn} ${pinned ? styles.pinOn : ''}`}
          role="button"
          tabIndex={0}
          onClick={handlePin}
          onDoubleClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); handlePin(e as any) } }}
          title={pinned ? '取消置顶' : '置顶到列表首位'}
        >
          📌
        </span>
        {watched && (
          <span className={styles.watchBadge} title="特别关注">⭐</span>
        )}
        <div
          className={`${styles.card} ${pinned ? styles.isPinned : ''} ${watched ? styles.isWatched : ''}`}
          role="button"
          tabIndex={0}
          onDoubleClick={() => navigate(`/task/${task.id}`)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              navigate(`/task/${task.id}`)
            }
          }}
          title="双击进入详情，右键菜单"
        >
          {/* 左列：编目号 */}
          <div className={styles.cat}>
            <span className={styles.catNo}>
              CAT. № <strong>{catalog.display}</strong>
            </span>
            <span className={styles.catLabel}>
              {task.nature} · {NATURE_EN[task.nature] || task.nature}
            </span>
            <div className={styles.hoursBlock}>
              <span className={styles.hoursTitle}>任务总工时</span>
              <span className={styles.hoursValue}>{hoursLabel}</span>
            </div>
            <div className={styles.todoBlock}>
              <span className={styles.todoTitle}>待办事项</span>
              <ul className={styles.todoList}>
                <li>- 待办 {todoActive}</li>
                <li>- 已完成 {todoCompleted}</li>
                <li>- 已废弃 {todoAbandoned}</li>
              </ul>
            </div>
          </div>

          {/* 中列：主体 */}
          <div className={styles.body}>
            <div className={styles.topline}>
              <Stamp status={task.status} />
              <NatureBadge nature={task.nature} />
            </div>
            <h3 className={styles.title}>{task.title}</h3>
            {task.description && (
              <ContentViewer
                text={task.description}
                maxHeight={124}
                previewClassName={styles.desc}
              />
            )}
            {task.tags.length > 0 && (
              <div className={styles.tags}>
                {task.tags.map(t => <span key={t} className="tag">{t}</span>)}
              </div>
            )}
          </div>

          {/* 右列：旁注 */}
          <dl className={styles.margin}>
            <dt>对接</dt>
            <dd>{contactLabel}</dd>
            <div className={styles.marginSep} />
            <dt>开始</dt>
            <dd>{fmtDatePretty(task.start_date)}</dd>
            <dt>最近记录</dt>
            <dd>{fmtDatePretty(task.last_log_date || task.processing_date) || '—'}</dd>
            <div className={styles.marginSep} />
            <dt>日报</dt>
            <dd>{logSummary}</dd>
            <dt>闲置</dt>
            <dd>{idleLabel}</dd>
          </dl>
        </div>
      </div>
      {menu && (
        <TaskContextMenu
          x={menu.x}
          y={menu.y}
          watched={watched}
          pinned={pinned}
          onWatch={handleWatch}
          onUnwatch={handleWatch}
          onPin={() => handlePin({ stopPropagation: () => {}, detail: 1 } as any)}
          onUnpin={() => handlePin({ stopPropagation: () => {}, detail: 1 } as any)}
          onOpen={() => navigate(`/task/${task.id}`)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}
