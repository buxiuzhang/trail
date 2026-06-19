import { useEffect, useRef } from 'react'
import styles from './TaskContextMenu.module.css'

interface TaskContextMenuProps {
  x: number
  y: number
  watched: boolean
  pinned: boolean
  onWatch: () => void
  onUnwatch: () => void
  onPin: () => void
  onUnpin: () => void
  onOpen: () => void
  onClose: () => void
}

export function TaskContextMenu({
  x, y, watched, pinned,
  onWatch, onUnwatch, onPin, onUnpin, onOpen, onClose,
}: TaskContextMenuProps) {
  const ref = useRef<HTMLUListElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handleClick)
    document.addEventListener('keydown', handleKey)
    return () => {
      document.removeEventListener('mousedown', handleClick)
      document.removeEventListener('keydown', handleKey)
    }
  }, [onClose])

  // 防止菜单超出视口右侧/底部
  const style: React.CSSProperties = { position: 'fixed', left: x, top: y }

  function item(label: string, action: () => void, danger?: boolean) {
    return (
      <li
        className={`${styles.item} ${danger ? styles.danger : ''}`}
        onMouseDown={(e) => { e.preventDefault(); action(); onClose() }}
      >
        {label}
      </li>
    )
  }

  return (
    <ul ref={ref} className={styles.menu} style={style} role="menu">
      {item('打开详情', onOpen)}
      <li className={styles.sep} role="separator" />
      {watched
        ? item('取消关注', onUnwatch)
        : item('⭐ 特别关注', onWatch)
      }
      {pinned
        ? item('取消置顶', onUnpin)
        : item('置顶', onPin)
      }
    </ul>
  )
}
