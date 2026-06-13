import clsx from 'clsx'
import styles from './Stamp.module.css'

const STATUS_CSS: Record<string, string> = {
  '未开始': styles.ns,
  '进行中': styles.ip,
  '已完成': styles.dn,
  '已作废': styles.cn,
}

const STATUS_LABEL: Record<string, string> = {
  '未开始': '未始',
  '进行中': '进行',
  '已完成': '完成',
  '已作废': '作废',
}

interface StampProps {
  status: string
  size?: 'normal' | 'big'
  animated?: boolean
}

export function Stamp({ status, size = 'normal', animated }: StampProps) {
  return (
    <span
      className={clsx(
        styles.stamp,
        STATUS_CSS[status] || styles.ns,
        size === 'big' && styles.big,
        animated && styles.fresh
      )}
    >
      {STATUS_LABEL[status] || status}
    </span>
  )
}
