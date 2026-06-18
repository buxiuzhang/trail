import type { TaskOut } from '@/types'
import { TaskCard } from './TaskCard'

interface TaskCardListProps {
  tasks: TaskOut[]
}

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
