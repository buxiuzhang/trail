import { useTaskCounts } from '@/api/tasks'
import { useMotto } from '@/api/settings'
import { useFilterContext } from '@/context/FilterContext'
import { STATUS_LIST, NATURE_LIST } from '@/constants'
import { FilterSection } from './FilterSection'
import { monthLabel } from '@/constants'
import styles from './Sidebar.module.css'

export function Sidebar() {
  const { data: counts } = useTaskCounts()
  const { data: motto } = useMotto()
  const { filter, setStatus, setNature, setTag, setMonth } = useFilterContext()

  const totalCount = counts?.total_tasks || 0
  const byStatus = counts?.by_status || {}
  const byNature = counts?.by_nature || {}
  const byTag = counts?.by_tag || {}
  const byMonth = counts?.by_month || {}

  // 构建筛选项（首项为"全部"）
  function withAll<T extends { key: string; label: string; count: number }>(
    allLabel: string,
    items: T[],
  ): T[] {
    return [{ key: 'all', label: allLabel, count: totalCount } as T, ...items]
  }

  const statusItems = withAll('全部条目', STATUS_LIST.map(s => ({
    key: s, label: s, count: byStatus[s] || 0,
  })))

  const natureItems = withAll('全部', NATURE_LIST.map(n => ({
    key: n, label: n, count: byNature[n] || 0,
  })))

  const tagItems = withAll('全部标签', Object.entries(byTag)
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => ({ key: k, label: `#${k}`, count: c })))

  const monthItemsAll = withAll('全部月份', Object.entries(byMonth)
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([k, c]) => {
      const lbl = monthLabel(k)
      return { key: k, label: `${lbl.zh} ${lbl.en}`, count: c }
    }))


  return (
    <aside className={styles.sidebar} aria-label="查找助手">
      <FilterSection
        title="按状态"
        items={statusItems}
        activeKey={filter.status}
        onSelect={(key) => setStatus(key)}
      />
      <FilterSection
        title="按性质"
        items={natureItems}
        activeKey={filter.nature}
        onSelect={(key) => setNature(key)}
      />
      <FilterSection
        title="按标签"
        items={tagItems}
        activeKey={filter.tag}
        onSelect={(key) => setTag(key)}
        defaultExpanded={false}
      />
      <FilterSection
        title="编年"
        items={monthItemsAll}
        activeKey={filter.month}
        onSelect={(key) => setMonth(key)}
        defaultExpanded={false}
      />

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
    </aside>
  )
}
