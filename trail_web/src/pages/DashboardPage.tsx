import { useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { useWorkbench } from '@/context/WorkbenchContext'
import {
  useOverview,
  useStaleTasks,
  useLogsByDateRange,
  useTodoStats,
  useLogHeatmap,
  useAllTasks,
} from '@/api/insights'
import type { StaleOut } from '@/types'
import styles from './DashboardPage.module.css'

function localDate(offsetDays = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + offsetDays)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function weekStart(): string {
  const d = new Date()
  const day = d.getDay() || 7
  d.setDate(d.getDate() - day + 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// ── 主页面 ────────────────────────────────────────────────────────

const PALETTE = [
  '#5B8A6B', '#8A5B5B', '#5B6E8A', '#8A7A5B', '#7A5B8A',
  '#5B8A80', '#8A6B5B', '#6B8A5B', '#8A5B72', '#5B7A8A',
  '#8A845B', '#6B5B8A', '#5B8A65', '#8A5F5B', '#5B7F8A',
]

const STATUS_COLORS: Record<string, string> = {
  '未开始': '#B8AC95',
  '进行中': '#3D5A3D',
  '已完成': '#7A9E7A',
  '已作废': '#C7B999',
}
const NATURE_COLORS: Record<string, string> = {
  '长期': '#4A3728',
  '临时': '#8B6914',
  '维护': '#5A6E8A',
}

function pieOption(
  dataMap: Record<string, number> | undefined,
  colorMap: Record<string, string>,
) {
  const entries = Object.entries(dataMap ?? {}).filter(([, v]) => v > 0)
  return {
    tooltip: {
      trigger: 'item',
      backgroundColor: 'var(--card)',
      borderColor: 'var(--rule)',
      textStyle: { color: '#3A322A', fontSize: 12 },
      formatter: '{b}: {c} ({d}%)',
    },
    legend: {
      orient: 'vertical',
      right: 0,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      textStyle: { color: '#6B5E4D', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      formatter: (name: string) => `${name}  ${dataMap?.[name] ?? 0}`,
    },
    series: [{
      type: 'pie',
      radius: ['40%', '68%'],
      center: ['38%', '50%'],
      avoidLabelOverlap: false,
      label: { show: false },
      emphasis: { label: { show: false } },
      data: entries.map(([name, value]) => ({
        name,
        value,
        itemStyle: { color: colorMap[name] ?? '#C7B999' },
      })),
    }],
  }
}

const WEEK_DAY_NAMES = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

export function DashboardPage() {
  const today = localDate()
  const wStart = weekStart()
  const trend14Start = localDate(-13)
  const heatmap30Start = localDate(-29)

  const { data: overview } = useOverview()
  const { data: trend14 = [] } = useLogsByDateRange(trend14Start, today)
  const { data: staleTasks = [] } = useStaleTasks(0)
  const { data: allTasks = [] } = useAllTasks()
  const { data: todoStats } = useTodoStats()
  const { data: heatmapData = [] } = useLogHeatmap(heatmap30Start, today)
  const navigate = useNavigate()
  const { setPanel } = useWorkbench()

  const trend14Ref = useRef(trend14)
  trend14Ref.current = trend14
  const setPanelRef = useRef(setPanel)
  setPanelRef.current = setPanel

  const todayHours = useMemo(() =>
    parseFloat((trend14.find(d => d.date === today)?.hours ?? 0).toFixed(1)),
    [trend14, today])

  const weekHours = useMemo(() =>
    parseFloat(trend14.filter(d => d.date >= wStart).reduce((s, d) => s + d.hours, 0).toFixed(1)),
    [trend14, wStart])

  const inProgress = overview?.by_status?.['进行中'] ?? 0

  const activeCount = staleTasks.filter((t: StaleOut) => t.days_idle != null && t.days_idle <= 3).length
  const coolCount   = staleTasks.filter((t: StaleOut) => t.days_idle != null && t.days_idle >= 4 && t.days_idle <= 7).length
  const warnTasks   = staleTasks.filter((t: StaleOut) => t.days_idle == null || t.days_idle > 7)

  const totalTodos     = overview?.todo_active_count ?? 0
  const completedTodos = overview?.todo_completed_count ?? 0
  const todoTotal      = totalTodos + completedTodos
  const todoRate       = todoTotal > 0 ? Math.round((completedTodos / todoTotal) * 100) : 0

  const logCounts = useMemo(() => trend14.map(d => d.count ?? 0), [trend14])

  const trendDates = useMemo(() => trend14.map(d => {
    const wd = new Date(d.date).getDay()
    return `${d.date.slice(5)} ${WEEK_DAY_NAMES[wd]}`
  }), [trend14])

  // ECharts：工时趋势（双线：工时 + 日报数量）
  const trendOption = useMemo(() => {
    const dates = trendDates
    const hours  = trend14.map(d => d.hours)
    return {
      grid: { top: 32, right: 20, bottom: 28, left: 40 },
      legend: {
        data: ['工时(h)', '日报数'],
        top: 4,
        textStyle: { color: '#6B5E4D', fontSize: 10, fontFamily: 'JetBrains Mono, monospace' },
        itemWidth: 12, itemHeight: 3,
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'var(--card)',
        borderColor: 'var(--rule)',
        textStyle: { color: '#3A322A', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#C7B999' } },
        axisTick: { show: false },
        axisLabel: {
          color: '#B8AC95',
          fontSize: 10,
          formatter: (val: string) => val.split(' ')[0],
        },
      },
      yAxis: {
        type: 'value',
        minInterval: 1,
        axisLabel: { color: '#B8AC95', fontSize: 10 },
        splitLine: { lineStyle: { color: '#DDD0B5', type: 'dashed' } },
      },
      series: [
        {
          name: '工时(h)',
          type: 'line',
          data: hours,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#3D5A3D', width: 2 },
          itemStyle: { color: '#3D5A3D' },
          areaStyle: { color: { type: 'linear', x: 0, y: 0, x2: 0, y2: 1,
            colorStops: [{ offset: 0, color: 'rgba(61,90,61,0.12)' }, { offset: 1, color: 'rgba(61,90,61,0)' }] } },
        },
        {
          name: '日报数',
          type: 'line',
          data: logCounts,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: '#8B6914', width: 2 },
          itemStyle: { color: '#8B6914' },
        },
      ],
    }
  }, [trend14, logCounts, trendDates])

  // ECharts：健康度横向条形
  const healthOption = useMemo(() => ({
    grid: { top: 8, right: 40, bottom: 8, left: 80 },
    tooltip: { trigger: 'axis', axisPointer: { type: 'shadow' } },
    xAxis: { type: 'value', axisLabel: { color: '#B8AC95', fontSize: 10 },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: '#DDD0B5', type: 'dashed' } } },
    yAxis: {
      type: 'category',
      data: ['预警 >7天', '偏冷 4-7天', '活跃 0-3天'],
      axisLabel: { color: '#6B5E4D', fontSize: 11 },
      axisLine: { show: false },
      axisTick: { show: false },
    },
    series: [{
      type: 'bar',
      data: [
        { value: warnTasks.length, itemStyle: { color: '#9B3A3A' } },
        { value: coolCount,        itemStyle: { color: '#8B6914' } },
        { value: activeCount,      itemStyle: { color: '#3D5A3D' } },
      ],
      barMaxWidth: 20,
      label: { show: true, position: 'right', color: '#6B5E4D', fontSize: 11 },
    }],
  }), [activeCount, coolCount, warnTasks.length])

  // ECharts：待办完成率仪表盘
  const gaugeOption = useMemo(() => ({
    series: [{
      type: 'gauge',
      startAngle: 200,
      endAngle: -20,
      min: 0,
      max: 100,
      radius: '88%',
      pointer: { show: false },
      progress: { show: true, roundCap: true, width: 12,
        itemStyle: { color: '#3D5A3D' } },
      axisLine: { roundCap: true, lineStyle: { width: 12, color: [[1, '#EFE5D0']] } },
      axisTick: { show: false },
      splitLine: { show: false },
      axisLabel: { show: false },
      detail: {
        valueAnimation: true,
        formatter: '{value}%',
        color: '#1A1612',
        fontSize: 22,
        fontFamily: 'JetBrains Mono, monospace',
        offsetCenter: [0, '10%'],
      },
      title: { offsetCenter: [0, '35%'], color: '#B8AC95', fontSize: 10,
        fontFamily: 'JetBrains Mono, monospace' },
      data: [{ value: todoRate, name: '完成率' }],
    }],
  }), [todoRate])

  const [selectedHealth, setSelectedHealth] = useState<'active' | 'cool' | 'warn'>('warn')

  const activeTasks = staleTasks.filter((t: StaleOut) => t.days_idle != null && t.days_idle <= 3)
  const coolTasksList = staleTasks.filter((t: StaleOut) => t.days_idle != null && t.days_idle >= 4 && t.days_idle <= 7)

  const healthBuckets = { active: activeTasks, cool: coolTasksList, warn: warnTasks }
  const selectedTasks = healthBuckets[selectedHealth]

  const healthDayLabel = (t: StaleOut) =>
    t.days_idle != null ? `${t.days_idle} 天未记录` : '从未记录'

  const statusPieOption = useMemo(
    () => pieOption(overview?.by_status as Record<string, number>, STATUS_COLORS),
    [overview],
  )
  const naturePieOption = useMemo(
    () => pieOption(overview?.by_nature as Record<string, number>, NATURE_COLORS),
    [overview],
  )

  const heatmapMemo = useMemo(() => {
    const dates = Array.from({ length: 30 }, (_, i) => localDate(i - 29))

    const taskLastDate = new Map<string, string>()
    const taskIdByTitle = new Map<string, number>()
    const taskStatusByTitle = new Map<string, string>()
    const cellsByTask = new Map<string, typeof heatmapData>()
    for (const cell of heatmapData) {
      const prev = taskLastDate.get(cell.task_title) ?? ''
      if (cell.date > prev) taskLastDate.set(cell.task_title, cell.date)
      taskIdByTitle.set(cell.task_title, cell.task_id)
      const bucket = cellsByTask.get(cell.task_title) ?? []
      bucket.push(cell)
      cellsByTask.set(cell.task_title, bucket)
    }

    for (const t of allTasks) {
      taskIdByTitle.set(t.title, t.id)
      taskStatusByTitle.set(t.title, t.status)
      if (!taskLastDate.has(t.title)) {
        if (t.status === '已完成' || t.status === '已作废') continue
        taskLastDate.set(t.title, '')
      }
    }

    const STATUS_LABEL_COLOR: Record<string, string> = {
      '进行中': '#2D6A4F',
      '未开始': '#4A6FA5',
      '已完成': '#9E9E9E',
      '已作废': '#C8C8C8',
    }
    const STATUS_RICH_KEY: Record<string, string> = {
      '进行中': 's_ing',
      '未开始': 's_new',
      '已完成': 's_done',
      '已作废': 's_void',
    }

    const tasks = [...taskLastDate.keys()].sort((a, b) => {
      const sa = taskStatusByTitle.get(a) === '已完成'
      const sb = taskStatusByTitle.get(b) === '已完成'
      if (sa !== sb) return sa ? 1 : -1
      const da = taskLastDate.get(a) ?? ''
      const db = taskLastDate.get(b) ?? ''
      if (!da && !db) return a.localeCompare(b)
      if (!da) return 1
      if (!db) return -1
      return da > db ? -1 : da < db ? 1 : a.localeCompare(b)
    })

    const dateIdx = new Map(dates.map((d, i) => [d, i]))
    const maxCount = Math.max(1, ...heatmapData.map(c => c.count))

    const series = tasks.map((taskName, ti) => {
      const color = PALETTE[ti % PALETTE.length]
      const pts = (cellsByTask.get(taskName) ?? []).map(cell => ({
        value: [dateIdx.get(cell.date) ?? 0, ti, cell.count, cell.hours],
        symbolSize: 6 + Math.round((cell.count / maxCount) * 12),
        itemStyle: { color },
      }))
      return {
        type: 'scatter',
        data: pts,
        encode: { x: 0, y: 1, tooltip: [0, 1, 2, 3] },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: color + '66' } },
      }
    })

    const option = {
      grid: { top: 10, right: 16, bottom: 56, left: 0 },
      tooltip: {
        formatter: (p: { data: { value: number[] } }) => {
          const [di, ti, cnt, hrs] = p.data.value
          return `${tasks[ti]}<br/>${dates[di]}<br/>日报 ${cnt} 条 · ${hrs}h`
        },
        backgroundColor: 'var(--card)',
        borderColor: 'var(--rule)',
        textStyle: { color: '#3A322A', fontSize: 12 },
      },
      xAxis: {
        type: 'category',
        data: dates.map(d => d.slice(5)),
        axisLine: { lineStyle: { color: '#C7B999' } },
        axisTick: { show: false },
        axisLabel: { color: '#B8AC95', fontSize: 9, rotate: 45, interval: 0 },
        splitLine: { show: true, lineStyle: { color: '#EFE5D0', type: 'dashed' } },
      },
      yAxis: {
        type: 'category',
        data: tasks,
        inverse: true,
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 11,
          formatter: (name: string) => {
            const s = name.length > 10 ? name.slice(0, 10) + '…' : name
            const key = STATUS_RICH_KEY[taskStatusByTitle.get(name) ?? ''] ?? 's_new'
            return `{${key}|${s}}`
          },
          rich: Object.fromEntries(
            Object.entries(STATUS_LABEL_COLOR).map(([status, color]) => [
              STATUS_RICH_KEY[status],
              { width: 108, align: 'left', color, fontSize: 11 },
            ])
          ),
        },
        splitLine: { show: true, lineStyle: { color: '#EFE5D0', type: 'dashed' } },
      },
      series,
    }

    return { option, tasks, taskIdByTitle, chartHeight: tasks.length * 32 + 76 }
  }, [heatmapData, allTasks])

  const taskStatsMemo = useMemo(() => {
    const countMap = new Map<string, number>()
    const hoursMap = new Map<string, number>()
    for (const cell of heatmapData) {
      countMap.set(cell.task_title, (countMap.get(cell.task_title) ?? 0) + cell.count)
      hoursMap.set(cell.task_title, (hoursMap.get(cell.task_title) ?? 0) + cell.hours)
    }

    const taskStatusByTitle = new Map<string, string>()
    for (const t of allTasks) taskStatusByTitle.set(t.title, t.status)

    const tasks = [...countMap.keys()].sort((a, b) => {
      const aDone = taskStatusByTitle.get(a) === '已完成'
      const bDone = taskStatusByTitle.get(b) === '已完成'
      if (aDone !== bDone) return aDone ? 1 : -1
      return (hoursMap.get(b) ?? 0) - (hoursMap.get(a) ?? 0)
    })
    const counts = tasks.map(t => countMap.get(t) ?? 0)
    const hours  = tasks.map(t => parseFloat((hoursMap.get(t) ?? 0).toFixed(1)))

    const STATUS_LABEL_COLOR: Record<string, string> = {
      '进行中': '#2D6A4F',
      '未开始': '#4A6FA5',
      '已完成': '#9E9E9E',
      '已作废': '#C8C8C8',
    }
    const STATUS_RICH_KEY: Record<string, string> = {
      '进行中': 's_ing',
      '未开始': 's_new',
      '已完成': 's_done',
      '已作废': 's_void',
    }

    const option = {
      grid: { top: 48, right: 64, bottom: 80, left: 16, containLabel: true },
      legend: {
        top: 8,
        right: 8,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: { color: '#6B5E4D', fontSize: 11, fontFamily: 'JetBrains Mono, monospace' },
      },
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'var(--card)',
        borderColor: 'var(--rule)',
        textStyle: { color: '#3A322A', fontSize: 12 },
        formatter: (params: { dataIndex: number; seriesName: string; value: number }[]) => {
          const name = tasks[params[0].dataIndex]
          const c = params.find((p) => p.seriesName === '日报条数')
          const h = params.find((p) => p.seriesName === '总时长')
          return `${name}<br/>日报 ${c?.value ?? 0} 条 · ${h?.value ?? 0}h`
        },
      },
      xAxis: {
        type: 'category',
        data: tasks.map(t => t.length > 8 ? t.slice(0, 8) + '…' : t),
        axisLine: { lineStyle: { color: '#C7B999' } },
        axisTick: { show: false },
        axisLabel: {
          fontSize: 10,
          rotate: 30,
          interval: 0,
          formatter: (_: string, i: number) => {
            const name = tasks[i] ?? ''
            const s = name.length > 8 ? name.slice(0, 8) + '…' : name
            const key = STATUS_RICH_KEY[taskStatusByTitle.get(name) ?? ''] ?? 's_new'
            return `{${key}|${s}}`
          },
          rich: Object.fromEntries(
            Object.entries(STATUS_LABEL_COLOR).map(([status, color]) => [
              STATUS_RICH_KEY[status],
              { align: 'left', color, fontSize: 10 },
            ])
          ),
        },
        splitLine: { show: false },
      },
      yAxis: [
        {
          type: 'value',
          name: '条',
          nameTextStyle: { color: '#B8AC95', fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#B8AC95', fontSize: 10 },
          splitLine: { lineStyle: { color: '#EFE5D0', type: 'dashed' } },
          minInterval: 1,
        },
        {
          type: 'value',
          name: 'h',
          nameTextStyle: { color: '#B8AC95', fontSize: 10 },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: '#B8AC95', fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '日报条数',
          type: 'bar',
          yAxisIndex: 0,
          data: counts.map((v, i) => ({
            value: v,
            itemStyle: { color: PALETTE[i % PALETTE.length], borderRadius: [3, 3, 0, 0] },
          })),
          barMaxWidth: 20,
          label: { show: true, position: 'top', fontSize: 10, color: '#4A3F32', formatter: '{c}' },
        },
        {
          name: '总时长',
          type: 'line',
          yAxisIndex: 1,
          data: hours,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: '#E8762B', width: 2 },
          itemStyle: { color: '#E8762B', borderWidth: 2, borderColor: '#fff' },
          label: { show: true, position: 'bottom', fontSize: 10, color: '#E8762B', formatter: '{c}h' },
        },
      ],
    }
    return { option, hasData: tasks.length > 0 }
  }, [heatmapData, allTasks])

  return (
    <div className={styles.page}>

      {/* 今日概览 */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>今日概览</div>
        <div className={styles.cards4}>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{todayHours}<span className={styles.statUnit}>h</span></span>
            <span className={styles.statLabel}>今日工时</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{weekHours}<span className={styles.statUnit}>h</span></span>
            <span className={styles.statLabel}>本周工时</span>
          </div>
          <div className={styles.statCard}>
            <span className={styles.statValue}>{inProgress}</span>
            <span className={styles.statLabel}>进行中任务</span>
          </div>
          <div className={`${styles.statCard} ${styles.statCardSplit}`}>
            <div className={styles.statSplitItem}>
              <span className={styles.statValue}>{todoStats?.new_today ?? 0}</span>
              <span className={styles.statLabel}>今日新增待办</span>
            </div>
            <div className={styles.statSplitDivider} />
            <div className={styles.statSplitItem}>
              <span className={styles.statValue}>{todoStats?.followed_today ?? 0}</span>
              <span className={styles.statLabel}>今日跟进待办</span>
            </div>
          </div>
        </div>
      </section>

      {/* 任务概览 */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>任务概览</div>
        <div className={styles.pieRow}>
          <div className={styles.pieCard}>
            <div className={styles.pieCardTitle}>按状态</div>
            <ReactECharts option={statusPieOption} style={{ height: 160 }} />
          </div>
          <div className={styles.pieCard}>
            <div className={styles.pieCardTitle}>按性质</div>
            <ReactECharts option={naturePieOption} style={{ height: 160 }} />
          </div>
          <div className={styles.pieCard}>
            <div className={styles.pieCardTitle}>待办完成率</div>
            <div className={styles.gaugeRow}>
              <ReactECharts option={gaugeOption} style={{ height: 140, width: 140 }} />
              <div className={styles.todoMeta}>
                <div className={styles.todoMetaItem}>
                  <span className={styles.todoMetaLabel}>未完成</span>
                  <span className={styles.todoMetaValue}>{totalTodos}</span>
                </div>
                <div className={styles.todoMetaItem}>
                  <span className={styles.todoMetaLabel}>已完成</span>
                  <span className={styles.todoMetaValue}>{completedTodos}</span>
                </div>
                <div className={styles.todoMetaItem}>
                  <span className={styles.todoMetaLabel}>合计</span>
                  <span className={styles.todoMetaValue}>{todoTotal}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
        {taskStatsMemo.hasData && (
          <div style={{ marginBottom: -56 }}>
            <div className={styles.sectionSubtitle}>任务日报统计（近 30 天）</div>
            <ReactECharts option={taskStatsMemo.option} style={{ height: 360 }} />
          </div>
        )}
      </section>

      {/* 任务健康度 */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>任务健康度</div>
        <ReactECharts
          option={healthOption}
          style={{ height: 120 }}
          onEvents={{
            click: (p: { componentType: string; dataIndex: number | null }) => {
              const map = ['warn', 'cool', 'active'] as const
              if (p.componentType === 'series' && p.dataIndex != null) {
                setSelectedHealth(map[p.dataIndex])
              }
            },
          }}
        />
        <div className={styles.healthTabs}>
          {(['active', 'cool', 'warn'] as const).map(bucket => {
            const labels = { active: '活跃', cool: '偏冷', warn: '预警' }
            const counts = { active: activeCount, cool: coolCount, warn: warnTasks.length }
            return (
              <button
                key={bucket}
                type="button"
                className={`${styles.healthTab} ${selectedHealth === bucket ? styles.healthTabActive : ''} ${styles[`healthTab_${bucket}`]}`}
                onClick={() => setSelectedHealth(bucket)}
              >
                {labels[bucket]} <span className={styles.healthTabCount}>{counts[bucket]}</span>
              </button>
            )
          })}
        </div>
        {selectedTasks.length > 0 ? (
          <div className={styles.warnList}>
            {selectedTasks.map((t: StaleOut) => (
              <div key={t.id} className={styles.warnItem} onClick={() => navigate(`/task/${t.id}`)}>
                <span className={styles.warnTitle}>{t.title}</span>
                <span className={styles.warnDays}>{healthDayLabel(t)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>暂无任务</div>
        )}
      </section>

      {/* 工时趋势 */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>近 14 天工时趋势</div>
        <ReactECharts
          option={trendOption}
          style={{ height: 220 }}
          onChartReady={(chart) => {
            chart.getZr().on('dblclick', (e: { offsetX: number; offsetY: number }) => {
              const pt = [e.offsetX, e.offsetY]
              const idx = chart.convertFromPixel({ seriesIndex: 0 }, pt)
              if (idx == null) return
              const i = Math.round(idx[0])
              const data = trend14Ref.current
              if (i >= 0 && i < data.length) {
                setPanelRef.current('quick-log', data[i].date)
              }
            })
          }}
        />
      </section>

      {/* 任务日报热力图 */}
      {allTasks.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionTitle}>任务日报热力图</div>
          <div className={styles.heatmapWrap}>
            <ReactECharts
              option={{ ...heatmapMemo.option, grid: { ...heatmapMemo.option.grid, left: 120 } }}
              style={{ height: heatmapMemo.chartHeight }}
              onEvents={{
                dblclick: (p: { componentType: string; data: { value: number[] } | null }) => {
                  if (p.componentType === 'series' && p.data) {
                    const title = heatmapMemo.tasks[p.data.value[1]]
                    const id = heatmapMemo.taskIdByTitle.get(title)
                    if (id) navigate(`/task/${id}`)
                  }
                },
              }}
            />
          </div>
        </section>
      )}


    </div>
  )
}
