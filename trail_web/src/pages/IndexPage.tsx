import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useInfiniteTasks } from '@/api/tasks'
import { useVectorSearch, type VectorSearchResult } from '@/api/embed'
import { useFilterContext } from '@/context/FilterContext'
import { monthLabel } from '@/constants'
import { TaskCardList } from '@/components/task/TaskCardList'
import { TaskListTable } from '@/components/task/TaskListTable'
import { Crumbs } from '@/components/shared/Crumbs'
import { EmptyState } from '@/components/detail/EmptyState'
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll'
import type { TaskOut } from '@/types'
import viewListIcon from '@/icons/view-list.svg'
import viewCardIcon from '@/icons/view-card.svg'

type ViewMode = 'card' | 'list'

function getInitialViewMode(): ViewMode {
  try {
    const saved = localStorage.getItem('taskListViewMode')
    if (saved === 'list' || saved === 'card') return saved
  } catch { /* localStorage unavailable */ }
  return 'card'
}

/** 用于排序和分组的日期：processing_date || start_date */
function groupDate(t: TaskOut): string {
  return t.processing_date || t.start_date || ''
}

/** "YYYY-MM" 分组键 */
function monthKey(d: string): string {
  if (!d) return '未知'
  return d.slice(0, 7)
}

function highlight(text: string, query: string): string {
  const safe = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
  if (!query.trim()) return safe
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return safe.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>')
}

function VectorSearchBlock({ results, navigate, query }: {
  results: VectorSearchResult[]
  navigate: (path: string) => void
  query: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  return (
    <div className="vector-search-results">
      <div
        className="vector-search-header"
        onClick={() => setCollapsed(c => !c)}
        style={{ cursor: 'pointer', userSelect: 'none' }}
      >
        <span>语义相关 · {results.length} 条</span>
        {collapsed ? (
          <svg viewBox="0 0 1024 1024" width={12} height={12} fill="currentColor" style={{ opacity: 0.5 }}>
            <path d="M210.96 848.05c-11.58-13.35-10.14-33.56 3.22-45.14l331.38-282.1c4.61-4 4.6-11.17-0.04-15.14L214.13 221.19c-13.41-11.51-14.95-31.71-3.44-45.12 11.51-13.41 31.71-14.95 45.12-3.44L634.7 497.88c9.27 7.96 9.3 22.29 0.07 30.29L256.1 851.27c-13.35 11.57-33.56 10.13-45.14-3.22z"/>
            <path d="M430.31 848.05c-11.58-13.35-10.14-33.56 3.22-45.14l331.38-282.1c4.61-4 4.6-11.17-0.04-15.14L433.48 221.19c-13.41-11.51-14.95-31.71-3.44-45.12 11.51-13.41 31.71-14.95 45.12-3.44l378.88 325.25c9.27 7.96 9.3 22.29 0.07 30.29l-378.68 323.1c-13.33 11.57-33.54 10.13-45.12-3.22z"/>
          </svg>
        ) : (
          <svg viewBox="0 0 1024 1024" width={12} height={12} fill="currentColor" style={{ opacity: 0.5 }}>
            <path d="M175.95 210.96c13.35-11.58 33.56-10.14 45.14 3.22l282.1 331.38c4 4.61 11.17 4.6 15.14-0.04l284.48-331.39c11.51-13.41 31.71-14.95 45.12-3.44 13.41 11.51 14.95 31.71 3.44 45.12L526.12 634.7c-7.96 9.27-22.29 9.3-30.29 0.07L172.73 256.1c-11.57-13.35-10.13-33.56 3.22-45.14z"/>
            <path d="M175.95 430.31c13.35-11.58 33.56-10.14 45.14 3.22l282.1 331.38c4 4.61 11.17 4.6 15.14-0.04l284.48-331.39c11.51-13.41 31.71-14.95 45.12-3.44 13.41 11.51 14.95 31.71 3.44 45.12L526.12 854.05c-7.96 9.27-22.29 9.3-30.29 0.07l-323.1-378.68c-11.57-13.34-10.13-33.55 3.22-45.13z"/>
          </svg>
        )}
      </div>
      {!collapsed && results.map(r => {
        const sourceLabel = r.source === 'task' ? '任务' : r.source === 'log' ? '日报' : '待办'
        const taskId = r.task_id ?? null
        return (
          <div
            key={r.id}
            className="vector-search-item"
            onClick={() => taskId && navigate(`/task/${taskId}`)}
            style={{ cursor: taskId ? 'pointer' : 'default' }}
          >
            <span className="vector-search-tag">{sourceLabel}</span>
            <span
              className="vector-search-text"
              dangerouslySetInnerHTML={{ __html: highlight(r.text, query) }}
            />
            <span className="vector-search-score">{(r.score * 100).toFixed(0)}%</span>
          </div>
        )
      })}
    </div>
  )
}

export function IndexPage() {
  const navigate = useNavigate()
  const { filter } = useFilterContext()
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [searchText, setSearchText] = useState('')
  const [backendSearch, setBackendSearch] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>(getInitialViewMode)

  const { data: vectorData } = useVectorSearch(backendSearch)

  function switchViewMode(mode: ViewMode) {
    setViewMode(mode)
    try { localStorage.setItem('taskListViewMode', mode) } catch { /* localStorage unavailable */ }
  }

  // 无限滚动：分页 + 筛选后端化（status/nature/month/tag 走 query param）
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    error,
  } = useInfiniteTasks({
    status: filter.status,
    nature: filter.nature,
    month: filter.month,
    tag: filter.tag,
    search: backendSearch || undefined,
  })

  // 累计所有已加载页 → 单一 task 数组
  const allLoaded = useMemo(
    () => data?.pages.flatMap(p => p.items) ?? [],
    [data]
  )
  const total = data?.pages[0]?.total ?? 0

  // 搜索：实时输入走前端内存过滤；点击搜索按钮走后端全量检索
  const searched = useMemo(() => {
    if (backendSearch) return allLoaded  // 后端已过滤，直接用
    if (!searchText.trim()) return allLoaded
    const kw = searchText.trim().toLowerCase()
    return allLoaded.filter(t =>
      t.title.toLowerCase().includes(kw) ||
      (t.description && t.description.toLowerCase().includes(kw)) ||
      t.tags.some((tag: string) => tag.toLowerCase().includes(kw))
    )
  }, [allLoaded, searchText, backendSearch])

  // 排序：pinned 优先，然后按 processing_date||start_date
  const sorted = useMemo(() => {
    const dir = sortOrder === 'desc' ? -1 : 1
    return [...searched].sort((a, b) => {
      const pa = a.pinned_at ? 1 : 0
      const pb = b.pinned_at ? 1 : 0
      if (pa !== pb) return pb - pa
      const da = groupDate(a)
      const db = groupDate(b)
      return da.localeCompare(db) * dir
    })
  }, [searched, sortOrder])

  // 按月份分组
  const grouped = useMemo(() => {
    const map = new Map<string, TaskOut[]>()
    for (const t of sorted) {
      const k = monthKey(groupDate(t))
      if (!map.has(k)) map.set(k, [])
      map.get(k)!.push(t)
    }
    const dir = sortOrder === 'desc' ? -1 : 1
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]) * dir)
  }, [sorted, sortOrder])

  // 哨兵：距底 200px 时预拉下一页（用户无感）
  const sentinelRef = useInfiniteScroll(fetchNextPage, hasNextPage, isFetchingNextPage)

  if (isLoading) return <EmptyState glyph="⋯" title="载入中..." subtitle="正在调阅档案" />
  if (error) return <EmptyState glyph="!" title="调阅失败" subtitle={(error as Error).message} />

  return (
    <div>
      <Crumbs items={[{ label: '任务清单' }]} />
      <div className="archive-header">
        <h2 className="archive-title">
          <em>Catalogued</em> 全部 · {String(total).padStart(2, '0')} entries
        </h2>
        <div className="archive-controls">
          <div className="archive-search">
            <input
              type="text"
              placeholder="搜索标题、描述或标签..."
              value={searchText}
              onChange={e => {
                setSearchText(e.target.value)
                setBackendSearch('')  // 输入变化时退出后端搜索模式
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') setBackendSearch(searchText.trim())
              }}
              className="archive-search-input"
            />
            <button
              type="button"
              className={`archive-search-btn${backendSearch ? ' active' : ''}`}
              title={backendSearch ? '后端检索中，点击清除' : '全量检索（后端）'}
              onClick={() => {
                if (backendSearch) {
                  setBackendSearch('')
                } else {
                  setBackendSearch(searchText.trim())
                }
              }}
            >
              <svg viewBox="0 0 1024 1024" fill="currentColor">
                <path d="M446.112323 177.545051c137.567677 0.219798 252.612525 104.59798 266.162424 241.493333 13.562828 136.895354-78.778182 261.818182-213.617777 289.008485-134.852525 27.203232-268.386263-52.156768-308.945455-183.608889s25.018182-272.252121 151.738182-325.779394A267.235556 267.235556 0 0 1 446.112323 177.545051m0-62.060607c-182.794343 0-330.989899 330.989899-330.989899 330.989899s148.195556 330.989899 330.989899 330.989899 330.989899-148.195556 330.989899-330.989899-148.195556-330.989899-330.989899-330.989899z m431.321212 793.341415a30.849293 30.849293 0 0 1-21.94101-9.102223l-157.220202-157.220202c-11.752727-12.179394-11.584646-31.534545 0.37495-43.50707 11.972525-11.972525 31.327677-12.140606 43.494141-0.37495l157.220202 157.220202a31.036768 31.036768 0 0 1 6.723232 33.810101 31.004444 31.004444 0 0 1-28.651313 19.174142z m0 0" />
              </svg>
            </button>
          </div>
          <div className="archive-controls-row">
            <button
              type="button"
              className="archive-view-btn"
              onClick={() => switchViewMode(viewMode === 'card' ? 'list' : 'card')}
            >{viewMode === 'card'
              ? <><img src={viewListIcon} className="archive-view-icon" alt="" />列表模式</>
              : <><img src={viewCardIcon} className="archive-view-icon" alt="" />卡片模式</>
            }</button>
            <span
              className="archive-count"
              role="button"
              tabIndex={0}
              style={{ cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setSortOrder(o => o === 'desc' ? 'asc' : 'desc')}
              onKeyDown={e => { if (e.key === 'Enter') setSortOrder(o => o === 'desc' ? 'asc' : 'desc') }}
              title="点击切换排序方向"
            >
              Sorted · {sortOrder === 'desc' ? '倒序 · 最近处理在前' : '正序 · 最早处理在前'}
            </span>
          </div>
        </div>
      </div>
      {total === 0 ? (
        <EmptyState glyph="¶" title="档案室空" subtitle="尚无任何任务条目。点击「新建任务」开始记录。" />
      ) : sorted.length === 0 ? (
        <EmptyState glyph="∅" title="此格暂无可录之事" subtitle="试着调整左侧筛选，或 新建任务。" />
      ) : (
        <>
          {backendSearch && vectorData?.configured && vectorData.results.length > 0 && (
            <VectorSearchBlock results={vectorData.results} navigate={navigate} query={backendSearch} />
          )}
          {viewMode === 'list' ? (
            <TaskListTable tasks={sorted} />
          ) : (
            <>
              <p className="archive-dblclick-hint">双击卡片进入任务详情</p>
              {grouped.map(([key, monthTasks]) => {
                const lbl = monthLabel(key)
                return (
                  <section className="month-block" key={key}>
                    <div className="month-header">
                      <span className="month-title-zh">{lbl.zh}</span>
                      <span className="month-title">{lbl.en}</span>
                      <span className="month-count">{String(monthTasks.length).padStart(2, '0')} {monthTasks.length === 1 ? 'entry' : 'entries'}</span>
                      <span className="month-rule" />
                      <span className="month-year">{lbl.year}</span>
                    </div>
                    <TaskCardList tasks={monthTasks} />
                  </section>
                )
              })}
            </>
          )}
          {/* 哨兵：距底 200px 时触发 fetchNextPage */}
          <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
          {isFetchingNextPage && (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--ink-faded)' }}>
              载入中…
            </div>
          )}
          {!hasNextPage && total > 0 && (
            <div style={{ textAlign: 'center', padding: 16, color: 'var(--ink-ghost)', fontStyle: 'italic' }}>
              — 已载入全部 {total} 条 —
            </div>
          )}
        </>
      )}
    </div>
  )
}
