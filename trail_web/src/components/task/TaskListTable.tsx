import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TaskOut } from '@/types'
import { usePinTask, useUnpinTask, useWatchTask, useUnwatchTask } from '@/api/tasks'
import { useToastContext } from '@/context/ToastContext'
import { TaskContextMenu } from './TaskContextMenu'

interface TaskListTableProps {
  tasks: TaskOut[]
}

const STATUS_TITLE_COLOR: Record<string, string> = {
  '未开始': 'var(--ink-ghost)',
  '进行中': 'var(--ink)',
  '已完成': 'var(--amber)',
  '已作废': 'var(--oxblood)',
}

const NATURE_COLOR: Record<string, string> = {
  '长期': 'var(--green)',
  '临时': 'var(--ink-faded)',
  '维护': 'var(--amber)',
}

function fmtDate(d: string | null): string {
  if (!d) return '—'
  return d.slice(0, 10)
}

function formatHours(hours: number): string {
  if (!hours || hours <= 0) return '—'
  const MONTH_HOURS = 176
  const WEEK_HOURS = 40
  const DAY_HOURS = 8
  const months = Math.floor(hours / MONTH_HOURS)
  const rem1 = hours % MONTH_HOURS
  const weeks = Math.floor(rem1 / WEEK_HOURS)
  const rem2 = rem1 % WEEK_HOURS
  const days = Math.floor(rem2 / DAY_HOURS)
  const remainHours = rem2 % DAY_HOURS
  const parts: string[] = []
  if (months) parts.push(`${months}月`)
  if (weeks) parts.push(`${weeks}周`)
  if (days) parts.push(`${days}天`)
  if (remainHours && !months) parts.push(`${remainHours % 1 === 0 ? remainHours : remainHours.toFixed(1)}h`)
  return parts.join(' ') || '—'
}

function TaskRow({ task }: { task: TaskOut }) {
  const navigate = useNavigate()
  const { showToast } = useToastContext()
  const pinTask = usePinTask(task.id)
  const unpinTask = useUnpinTask(task.id)
  const watchTask = useWatchTask(task.id)
  const unwatchTask = useUnwatchTask(task.id)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const pinned = !!task.pinned_at
  const watched = !!task.watched_at

  async function handlePin() {
    try {
      if (pinned) { await unpinTask.mutateAsync(undefined as any); showToast('已取消置顶') }
      else { await pinTask.mutateAsync(undefined as any); showToast('已置顶') }
    } catch (err: any) { showToast('操作失败：' + err.message) }
  }

  async function handleWatch() {
    try {
      if (watched) { await unwatchTask.mutateAsync(undefined as any); showToast('已取消关注') }
      else { await watchTask.mutateAsync(undefined as any); showToast('已添加到特别关注') }
    } catch (err: any) { showToast('操作失败：' + err.message) }
  }

  return (
    <>
      <tr
        onDoubleClick={() => navigate(`/task/${task.id}`)}
        onContextMenu={e => { e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }) }}
        title="双击进入详情，右键菜单"
        className={pinned ? 'task-list-row--pinned' : ''}
      >
        <td
          className="task-list-title"
          style={{ color: STATUS_TITLE_COLOR[task.status] || 'var(--ink)' }}
        >
          {pinned && <span className="task-list-pin">📌</span>}
          <span className="task-list-status">[{task.status}]</span>
          {task.title}
          {watched && <span className="task-list-watch">⭐</span>}
        </td>
        <td
          className="task-list-nature"
          style={{ color: NATURE_COLOR[task.nature] || 'var(--ink-faded)' }}
        >
          {task.nature}
        </td>
        <td className="task-list-mono">{fmtDate(task.start_date)}</td>
        <td className="task-list-mono">{fmtDate(task.last_log_date || task.processing_date)}</td>
        <td className="task-list-mono">{formatHours(task.total_hours)}</td>
        <td className="task-list-action">
          <button type="button" className="task-list-detail-btn" onClick={() => navigate(`/task/${task.id}`)}>详情</button>
        </td>
      </tr>
      {menu && (
        <TaskContextMenu
          x={menu.x}
          y={menu.y}
          watched={watched}
          pinned={pinned}
          onWatch={handleWatch}
          onUnwatch={handleWatch}
          onPin={handlePin}
          onUnpin={handlePin}
          onOpen={() => navigate(`/task/${task.id}`)}
          onClose={() => setMenu(null)}
        />
      )}
    </>
  )
}

export function TaskListTable({ tasks }: TaskListTableProps) {
  return (
    <table className="task-list-table">
      <thead>
        <tr>
          <th>任务名称</th>
          <th>性质</th>
          <th>开始时间</th>
          <th>最近记录</th>
          <th>总工时</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        {tasks.map(task => <TaskRow key={task.id} task={task} />)}
      </tbody>
    </table>
  )
}
