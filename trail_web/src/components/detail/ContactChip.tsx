import { useState } from 'react'
import type { ContactOut } from '@/types'
import { KIND_LABELS, PLATFORM_LABELS } from '@/constants'
import styles from './ContactChip.module.css'

interface ContactChipProps {
  contact: ContactOut
}

export function ContactChip({ contact }: ContactChipProps) {
  const [expanded, setExpanded] = useState(false)
  const kindLabel = KIND_LABELS[contact.kind] || contact.kind
  const platformLabel = PLATFORM_LABELS[contact.channel] || contact.channel

  return (
    <div className={`${styles.wrap} ${expanded ? styles.isExpanded : ''}`}>
      {/* 紧凑 chip 行（点击展开/收起） */}
      <button
        type="button"
        className={styles.chip}
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
        title={expanded ? '收起' : '展开详情'}
      >
        <span className={styles.kind}>{kindLabel}</span>
        <span className={styles.sep}>·</span>
        <span className={`${styles.platform} ${styles['p-' + contact.channel] || ''}`}>
          {platformLabel}
        </span>
        <span className={styles.name} title={contact.name}>{contact.name}</span>
        {contact.note && !expanded && (
          <span className={styles.note}>／{contact.note}</span>
        )}
        <span className={styles.toggle}>{expanded ? '▴' : '▾'}</span>
      </button>

      {/* 展开详情行 */}
      {expanded && (
        <div className={styles.detail}>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>对接类型</span>
            <span className={styles.detailValue}>{kindLabel}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>平台</span>
            <span className={styles.detailValue}>{platformLabel}</span>
          </div>
          <div className={styles.detailRow}>
            <span className={styles.detailLabel}>名称</span>
            <span className={styles.detailValue}>{contact.name}</span>
          </div>
          {contact.target && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>标识</span>
              <span className={styles.detailValue}>{contact.target}</span>
            </div>
          )}
          {contact.note && (
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>备注</span>
              <span className={styles.detailValue}>{contact.note}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
