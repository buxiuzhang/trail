import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactECharts from 'echarts-for-react'
import { useWorkbench } from '@/context/WorkbenchContext'
import {
  useOverview,
  useStaleTasks,
  useLogsByDate,
  useLogsByDateRange,
  useIncompleteTodos,
} from '@/api/insights'
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
export function DashboardPage() {
  const today = localDate()
  const wStart = weekStart()
  const trend14Start = localDate(-13)

  const { data: overview } = useOverview()
  const { data: todayLogs = [] } = useLogsByDate(today)
  const { data: weekRange = [] } = useLogsByDateRange(wStart, today)
  const { data: trend14 = [] } = useLogsByDateRange(trend14Start, today)
  const { data: staleTasks = [] } = useStaleTasks(0)
  const { data: incompleteTodos = [] } = useIncompleteTodos()
  const navigate = useNavigate()
  const { setPanel } = useWorkbench()

  const trend14Ref = useRef(trend14)
  trend14Ref.current = trend14
  const setPanelRef = useRef(setPanel)
  setPanelRef.current = setPanel

  const todayHours = useMemo(() =>
    parseFloat(todayLogs.reduce((s: number, l: any) => s + (l.hours || 0), 0).toFixed(1)),
    [todayLogs])

  const weekHours = useMemo(() =>
    parseFloat(weekRange.reduce((s, d) => s + d.hours, 0).toFixed(1)),
    [weekRange])

  const inProgress = overview?.by_status?.['进行中'] ?? 0

  const activeCount = staleTasks.filter((t: any) => (t.days_idle ?? 0) <= 3).length
  const coolCount   = staleTasks.filter((t: any) => (t.days_idle ?? 0) > 3 && (t.days_idle ?? 0) <= 7).length
  const warnTasks   = staleTasks.filter((t: any) => (t.days_idle ?? 0) > 7 || t.days_idle == null)

  const totalTodos     = (overview as any)?.todo_active_count ?? incompleteTodos.length
  const completedTodos = (overview as any)?.todo_completed_count ?? 0
  const todoTotal      = totalTodos + completedTodos
  const todoRate       = todoTotal > 0 ? Math.round((completedTodos / todoTotal) * 100) : 0

  const logCounts = useMemo(() => trend14.map(d => d.count ?? 0), [trend14])

  const weekDayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const trendDates = useMemo(() => trend14.map(d => {
    const wd = new Date(d.date).getDay()
    return `${d.date.slice(5)} ${weekDayNames[wd]}`
  }), [trend14])

  // ECharts：工时趋势（双线：工时 + 日报数量）
  const trendOption = useMemo(() => {
    const dates = trendDates
    const hours  = trend14.map(d => d.hours)
    return {
      grid: { top: 32, right: 60, bottom: 28, left: 40 },
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
      yAxis: [
        {
          type: 'value',
          name: 'h',
          nameTextStyle: { color: '#B8AC95', fontSize: 9 },
          minInterval: 1,
          axisLabel: { color: '#B8AC95', fontSize: 10 },
          splitLine: { lineStyle: { color: '#DDD0B5', type: 'dashed' } },
        },
        {
          type: 'value',
          name: '条',
          nameTextStyle: { color: '#B8AC95', fontSize: 9 },
          minInterval: 1,
          axisLabel: { color: '#B8AC95', fontSize: 10 },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: '工时(h)',
          type: 'line',
          yAxisIndex: 0,
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
          yAxisIndex: 1,
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
          <div className={styles.statCard}>
            <span className={styles.statValue}>{incompleteTodos.length}</span>
            <span className={styles.statLabel}>待办未完成</span>
          </div>
        </div>
      </section>

      {/* 工时趋势 */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>近 14 天工时趋势</div>
        <ReactECharts
          option={trendOption}
          style={{ height: 220 }}
          onChartReady={(chart) => {
            chart.getZr().on('dblclick', (e: any) => {
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

      {/* 任务健康度 */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>任务健康度</div>
        <ReactECharts option={healthOption} style={{ height: 120 }} />
        {warnTasks.length > 0 && (
          <div className={styles.warnList}>
            {warnTasks.slice(0, 5).map((t: any) => (
              <div key={t.id} className={styles.warnItem} onClick={() => navigate(`/task/${t.id}`)}>
                <span className={styles.warnTitle}>{t.title}</span>
                <span className={styles.warnDays}>
                  {t.days_idle != null ? `${t.days_idle} 天未记录` : '从未记录'}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 待办完成率 */}
      <section className={styles.section}>
        <div className={styles.sectionTitle}>待办完成率</div>
        <div className={styles.gaugeRow}>
          <ReactECharts option={gaugeOption} style={{ height: 160, width: 200 }} />
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
      </section>

    </div>
  )
}
