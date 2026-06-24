import { Link, useLocation, useMatch } from 'react-router-dom'
import { useTask } from '@/api/tasks'
import styles from './Breadcrumb.module.css'

const HOME_PATHS = new Set(['/', '/workbench'])

const ROUTE_LABELS: Record<string, string> = {
  '/archive':  '工作档案',
  '/new':      '新建条目',
  '/settings': '系统设置',
  '/quick-log': '快速填报',
}

function TaskCrumb({ id }: { id: number }) {
  const { data: task } = useTask(id)
  return <span>{task ? task.title : `任务 #${id}`}</span>
}

export function Breadcrumb() {
  const location = useLocation()
  const taskMatch  = useMatch('/task/:id')
  const editMatch  = useMatch('/edit/:id')

  if (HOME_PATHS.has(location.pathname)) {
    return <nav className={styles.breadcrumb} aria-hidden="true" />
  }

  const crumbs: { label: React.ReactNode; to?: string }[] = [
    { label: '首页', to: '/' },
  ]

  if (taskMatch) {
    const id = Number(taskMatch.params.id)
    crumbs.push({ label: '工作档案', to: '/archive' })
    crumbs.push({ label: <TaskCrumb id={id} /> })
  } else if (editMatch) {
    const id = Number(editMatch.params.id)
    crumbs.push({ label: '工作档案', to: '/archive' })
    crumbs.push({ label: <TaskCrumb id={id} />, to: `/task/${id}` })
    crumbs.push({ label: '编辑' })
  } else {
    const label = ROUTE_LABELS[location.pathname]
    if (label) crumbs.push({ label })
  }

  return (
    <nav className={styles.breadcrumb} aria-label="面包屑导航">
      {crumbs.map((c, i) => (
        <span key={i} className={styles.item}>
          {i > 0 && <span className={styles.sep}>›</span>}
          {c.to
            ? <Link to={c.to} className={styles.link}>{c.label}</Link>
            : <span className={styles.current}>{c.label}</span>
          }
        </span>
      ))}
    </nav>
  )
}
