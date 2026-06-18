/**
 * ContentViewer · 只读预览器（可选折叠）
 *
 * 预览模式始终使用 MarkdownRenderer（TipTap 只读），确保与编辑器预览效果一致。
 * 自带可选的折叠功能。
 *
 * 两种使用方式：
 *   1. 纯只读预览（最常见）：不传 onModeChange，始终渲染 MarkdownRenderer
 *   2. 预览/源码切换：传 mode + onModeChange，显示切换按钮
 *
 * 与 DescriptionEditorWithMode 的区别：
 *   - DescriptionEditorWithMode: 编辑场景，含 TipTap 富文本编辑器
 *   - ContentViewer: 只读场景，用 MarkdownRenderer（TipTap 只读模式）
 *
 * 用法:
 *   <ContentViewer text={log.content} maxHeight={240} />
 */
import { useState, useRef, useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { EditorMode } from './ModeToggleButton'
import { ModeToggleButton } from './ModeToggleButton'
import { MarkdownRenderer } from './MarkdownRenderer'
import expandIcon from '@/icons/expand.svg'
import collapseIcon from '@/icons/collapse.svg'
import styles from './ContentViewer.module.css'

/** 阈值：超出 maxHeight 至少 20px 才显示收起/展开按钮 */
const THRESHOLD = 20

interface ContentViewerProps {
  /** 要展示的内容文本 */
  text: string | null | undefined

  /**
   * 预览/源码模式（受控）。
   * 仅当同时传了 onModeChange 时才显示切换按钮。
   */
  mode?: EditorMode

  /** 模式变化回调。不传则不显示切换按钮，始终渲染预览。 */
  onModeChange?: (mode: EditorMode) => void

  /** 外层容器类名 */
  className?: string

  /** 预览区域类名（透传给 MarkdownRenderer） */
  previewClassName?: string

  // ----- 折叠功能（可选） -----
  /** 收起状态最大高度（px），不传则不折叠 */
  maxHeight?: number

  /** 默认展开状态 */
  defaultExpanded?: boolean

  // ----- 透传给 MarkdownRenderer -----
  /** 待办列表（用于 @todo:ID 渲染） */
  todos?: { id: number; title: string }[]

  /** 任务列表（用于 @task:ID 渲染） */
  tasks?: { id: number; title: string }[]
}

export function ContentViewer({
  text,
  mode,
  onModeChange,
  className,
  previewClassName,
  maxHeight,
  defaultExpanded = false,
  todos = [],
  tasks = [],
}: ContentViewerProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const [needsTruncate, setNeedsTruncate] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)

  // 折叠检测
  useEffect(() => {
    if (!contentRef.current || expanded || !maxHeight) return
    const el = contentRef.current

    const checkOverflow = () => {
      if (el.scrollHeight > maxHeight + THRESHOLD) {
        setNeedsTruncate(true)
      } else {
        setNeedsTruncate(false)
      }
    }

    checkOverflow()

    // MarkdownRenderer 异步渲染，用 ResizeObserver 监听
    const observer = new ResizeObserver(() => {
      checkOverflow()
    })
    observer.observe(el)
    const child = el.firstElementChild
    if (child) observer.observe(child)

    return () => observer.disconnect()
  }, [text, expanded, maxHeight])

  if (!text) return null

  const hasCollapse = !!maxHeight
  const showToggle = !!onModeChange

  const toggleStyle: CSSProperties = {
    position: 'absolute',
    top: 0,
    right: 0,
    zIndex: 2,
  }

  // 纯只读模式：不传 onModeChange 时，始终渲染预览
  if (!showToggle) {
    if (!hasCollapse) {
      return (
        <div className={`${styles.wrapper} ${className ?? ''}`}>
          <MarkdownRenderer text={text} todos={todos} tasks={tasks} className={previewClassName} />
        </div>
      )
    }

    return (
      <div className={`${styles.wrapper} ${className ?? ''}`}>
        <div
          ref={contentRef}
          className={styles.collapseWrap}
          style={{ maxHeight: expanded ? 'none' : `${maxHeight}px` }}
        >
          <MarkdownRenderer text={text} todos={todos} tasks={tasks} className={previewClassName} />
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

  // 预览/源码切换模式
  return (
    <div className={`${styles.wrapper} ${className ?? ''}`}>
      <ModeToggleButton
        mode={mode ?? 'preview'}
        onModeChange={onModeChange}
        style={toggleStyle}
        usage="view"
      />

      {(mode ?? 'preview') === 'preview' ? (
        hasCollapse ? (
          <div
            ref={contentRef}
            className={styles.collapseWrap}
            style={{ maxHeight: expanded ? 'none' : `${maxHeight}px` }}
          >
            <MarkdownRenderer text={text} todos={todos} tasks={tasks} className={previewClassName} />
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
        ) : (
          <MarkdownRenderer text={text} todos={todos} tasks={tasks} className={previewClassName} />
        )
      ) : (
        <pre className={styles.source}>{text}</pre>
      )}

      {hasCollapse && expanded && needsTruncate && (
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

export type { EditorMode }
