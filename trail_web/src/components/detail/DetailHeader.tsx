import type { TaskOut } from '@/types'
import { Stamp } from '@/components/task/Stamp'
import { NatureBadge } from '@/components/task/NatureBadge'
import { CollapsibleText } from '@/components/shared/CollapsibleText'

interface DetailHeaderProps {
  task: TaskOut
  catalog: string
  logCount: number
}

export function DetailHeader({ task, catalog, logCount }: DetailHeaderProps) {
  return (
    <header className="detail__hd">
      <div className="detail__cat-row">
        <span className="cat-no">CAT. № {catalog}</span>
        <span className="cat-rule" />
        <span>Filed under <strong style={{color:'var(--ink)'}}>{task.nature}</strong></span>
      </div>
      <h1 className="detail__title detail__title-zh">{task.title}</h1>
      {task.alias && <p className="detail__alias">ALIAS · <em>{task.alias}</em></p>}
      {task.description && (
        <CollapsibleText
          text={task.description}
          maxHeight={200}
          maxImgHeight={120}
          className="detail__lede"
        />
      )}
      <div className="detail__badges">
        <Stamp status={task.status} size="big" />
        <NatureBadge nature={task.nature} />
        <span className="tag">{logCount} 条日志</span>
        {task.tags.map(t => <span key={t} className="tag">#{t}</span>)}
      </div>
    </header>
  )
}
