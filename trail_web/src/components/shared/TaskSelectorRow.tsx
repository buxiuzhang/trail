import { useState } from 'react'
import type { TaskOut } from '@/types'
import ChevronDown from '@/icons/chevron-down.svg'
import styles from './TaskSelectorRow.module.css'

interface Props {
  tasks: TaskOut[]
  taskId: number | null
  onChange: (taskId: number | null, task: TaskOut | null) => void
}

export function TaskSelectorRow({ tasks, taskId, onChange }: Props) {
  const selected = tasks.find(t => t.id === taskId) ?? null
  const [search, setSearch] = useState(selected?.title ?? '')
  const [focused, setFocused] = useState(false)

  const filtered = tasks
    .filter(t => !search || t.title.toLowerCase().includes(search.toLowerCase()))
    .slice(0, 30)

  return (
    <div className={styles.taskRow}>
      <span className={styles.taskLabel}>所属任务</span>
      <div className={styles.taskSelectWrap}>
        <input
          className={styles.taskInput}
          value={focused ? search : (selected?.title ?? search)}
          onChange={e => { setSearch(e.target.value); onChange(null, null) }}
          onFocus={() => { setSearch(''); setFocused(true) }}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={e => { if (e.key === 'Escape') setFocused(false) }}
          placeholder="搜索并选择任务…"
        />
        <span
          className={styles.taskArrow}
          onMouseDown={e => e.preventDefault()}
          onClick={() => { if (focused) { setFocused(false) } else { setSearch(''); setFocused(true) } }}
        ><img src={ChevronDown} width={12} height={12} alt="" aria-hidden="true" /></span>
        {focused && (
          <div className={styles.dropdown}>
            {filtered.map(t => (
              <div
                key={t.id}
                className={styles.dropdownItem}
                onMouseDown={e => e.preventDefault()}
                onClick={() => { onChange(t.id, t); setSearch(t.title); setFocused(false) }}
              >
                {t.title}
              </div>
            ))}
            {filtered.length === 0 && (
              <div className={styles.dropdownEmpty}>无匹配进行中任务</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
