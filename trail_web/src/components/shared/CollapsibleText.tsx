/**
 * CollapsibleText · 可折叠文本组件
 *
 * 用于任务描述等可能很长的文本区域：
 *   - 超过 maxHeight + THRESHOLD 时才显示展开按钮（避免边界情况）
 *   - 收起时底部渐变遮罩暗示有更多内容
 *   - 展开/收起按钮只显示图标
 */
import { useState, useRef, useEffect } from 'react'
import { RichText } from './RichText'
import expandIcon from '@/icons/expand.svg'
import collapseIcon from '@/icons/collapse.svg'
import styles from './CollapsibleText.module.css'

/** 阈值：超出 maxHeight 至少 20px 才显示收起/展开按钮（避免边界情况） */
const THRESHOLD = 20

interface CollapsibleTextProps {
  text: string | null | undefined
  /** 收起状态最大高度（px） */
  maxHeight: number
  className?: string
  /** 透传给 RichText，控制图片高度 */
  maxImgHeight?: number
  /** 默认展开状态 */
  defaultExpanded?: boolean
}

export function CollapsibleText({
  text,
  maxHeight,
  className,
  maxImgHeight,
  defaultExpanded = false,
}: CollapsibleTextProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [needsTruncate, setNeedsTruncate] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!contentRef.current || expanded) return
    const el = contentRef.current

    // 检测是否溢出（加阈值避免边界情况）
    const checkOverflow = () => {
      // 只有超出阈值才需要折叠（避免展开/收起高度一致的情况）
      if (el.scrollHeight > maxHeight + THRESHOLD) {
        setNeedsTruncate(true)
      } else {
        setNeedsTruncate(false)
      }
    }

    // 立即检测一次
    checkOverflow()

    // 用 ResizeObserver 监听内容变化（MarkdownRenderer 是异步渲染）
    const observer = new ResizeObserver(() => {
      checkOverflow()
    })

    observer.observe(el)

    // 也观察内部子元素
    const child = el.firstElementChild
    if (child) observer.observe(child)

    return () => observer.disconnect()
  }, [text, expanded, maxHeight])

  if (!text) return null

  return (
    <div className={className}>
      <div
        ref={contentRef}
        className={styles.content}
        style={{ maxHeight: expanded ? 'none' : `${maxHeight}px` }}
      >
        <RichText text={text} maxImgHeight={maxImgHeight} />
        {!expanded && needsTruncate && (
          <div className={styles.fade}>
            <button
              type="button"
              className={styles.expandBtn}
              onClick={() => setExpanded(true)}
              title="展开"
            >
              <img src={expandIcon} alt="展开" />
            </button>
          </div>
        )}
      </div>
      {expanded && needsTruncate && (
        <button
          type="button"
          className={styles.collapseBtn}
          onClick={() => setExpanded(false)}
          title="收起"
        >
          <img src={collapseIcon} alt="收起" />
        </button>
      )}
    </div>
  )
}