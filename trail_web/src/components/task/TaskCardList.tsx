import type { TaskOut } from '@/types'
import { TaskCard } from './TaskCard'

interface TaskCardListProps {
  tasks: TaskOut[]
}

/**
 * 渲染任务卡片列表。
 * 旧版 logCounts 来自 useQueries 批量拉 logs（已删 N+1）；现在 logCount/logMainCount
 * 直接来自 task 字段（后端 SQL 聚合）。
 */
export function TaskCardList({ tasks }: TaskCardListProps) {
  return (
    <>
      {tasks.map(task => (
        <TaskCard
          key={task.id}
          task={task}
          logCount={task.log_count}
          logMainCount={task.log_main_count}
        />
      ))}
    </>
  )
}
