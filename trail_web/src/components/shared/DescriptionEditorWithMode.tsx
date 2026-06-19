/**
 * DescriptionEditorWithMode · 在 DescriptionEditor 外面包一层 "预览 / 源码" 切换
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { DescriptionEditor } from './DescriptionEditor'
import { IconPreview, IconSource } from './ModeIcons'
import { type EditorMode } from './ModeToggleButton'
import type { TodoOut, TaskOut } from '@/types'
import expandIcon from '@/icons/expand.svg'
import collapseIcon from '@/icons/collapse.svg'
import styles from './DescriptionEditorWithMode.module.css'
import viewerStyles from './ContentViewer.module.css'

export type { EditorMode }

const THRESHOLD = 20

interface Props {
  value: string
  onChange: (v: string) => void
  mode: EditorMode
  onModeChange: (m: EditorMode) => void
  hideInlineToggle?: boolean
  placeholder?: string
  rows?: number
  minHeight?: number
  /** preview 模式下超出此高度折叠，传 0 或不传则不折叠 */
  maxHeight?: number
  textareaClassName?: string
  todos?: TodoOut[]
  tasks?: TaskOut[]
  autoGrow?: boolean
}

export const DescriptionEditorWithMode = forwardRef<HTMLTextAreaElement, Props>(
  function DescriptionEditorWithMode(
    {
      value,
      onChange,
      mode,
      onModeChange,
      hideInlineToggle = false,
      placeholder,
      rows,
      minHeight = 120,
      maxHeight,
      textareaClassName = 'field__textarea',
      todos = [],
      tasks = [],
      autoGrow = false,
    },
    ref,
  ) {
    const previewRef = useRef<HTMLTextAreaElement>(null)
    const sourceRef = useRef<HTMLTextAreaElement>(null)
    const collapseRef = useRef<HTMLDivElement>(null)
    const [expanded, setExpanded] = useState(false)
    const [needsTruncate, setNeedsTruncate] = useState(false)

    useImperativeHandle(
      ref,
      () => {
        const adapter = {
          focus: () => {
            if (mode === 'preview') previewRef.current?.focus()
            else sourceRef.current?.focus()
          },
        }
        return adapter as unknown as HTMLTextAreaElement
      },
      [mode],
    )

    // 折叠检测（preview 模式 + maxHeight 时）
    useEffect(() => {
      if (!maxHeight || mode !== 'preview' || expanded) return
      const el = collapseRef.current
      if (!el) return
      const check = () => {
        setNeedsTruncate(el.scrollHeight > maxHeight + THRESHOLD)
      }
      check()
      const observer = new ResizeObserver(check)
      observer.observe(el)
      const child = el.firstElementChild
      if (child) observer.observe(child)
      return () => observer.disconnect()
    }, [maxHeight, mode, value, expanded])

    // 切换到 preview 时重置折叠状态
    useEffect(() => {
      if (mode === 'preview') setExpanded(false)
    }, [mode])

    // autoGrow：source 模式切入或 value 变化时同步高度
    useEffect(() => {
      if (!autoGrow || mode !== 'source') return
      const el = sourceRef.current
      if (!el) return
      el.style.height = 'auto'
      el.style.height = el.scrollHeight + 'px'
    }, [autoGrow, mode, value])

    const handleSourceChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value)
        if (autoGrow) {
          const el = e.currentTarget
          el.style.height = 'auto'
          el.style.height = el.scrollHeight + 'px'
        }
      },
      [onChange, autoGrow],
    )

    const editorNode = (
      <DescriptionEditor
        ref={previewRef}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        minHeight={minHeight}
        textareaClassName={textareaClassName}
        todos={todos}
        tasks={tasks}
      />
    )

    return (
      <div className={styles.wrapper}>
        {!hideInlineToggle && (
          <button
            type="button"
            className={`${styles.modeBtn} ${styles.modeBtnOverlay}`}
            onClick={() => onModeChange(mode === 'preview' ? 'source' : 'preview')}
            title={mode === 'preview' ? '预览编辑' : '源码编辑'}
            aria-label={mode === 'preview' ? '预览编辑(点击切换到源码)' : '源码编辑(点击切换到预览)'}
            aria-pressed={mode === 'source'}
            onMouseDown={(e) => e.preventDefault()}
          >
            {mode === 'preview' ? (
              <IconPreview className={styles.modeBtnIcon} />
            ) : (
              <IconSource className={styles.modeBtnIcon} />
            )}
          </button>
        )}

        {mode === 'preview' ? (
          maxHeight ? (
            <>
              <div
                ref={collapseRef}
                className={viewerStyles.collapseWrap}
                style={{ maxHeight: expanded ? 'none' : `${maxHeight}px` }}
              >
                {editorNode}
                {!expanded && needsTruncate && (
                  <div className={viewerStyles.fade}>
                    <button
                      type="button"
                      className={viewerStyles.expandBtn}
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
                  className={viewerStyles.collapseBtn}
                  onClick={() => setExpanded(false)}
                  title="收起"
                >
                  <img src={collapseIcon} alt="收起" />
                </button>
              )}
            </>
          ) : (
            editorNode
          )
        ) : (
          <textarea
            ref={sourceRef}
            className={`${styles.sourceTextarea} ${textareaClassName ?? ''}`}
            value={value}
            onChange={handleSourceChange}
            placeholder={placeholder}
            rows={rows}
            style={{
              minHeight,
              ...(autoGrow ? { overflow: 'hidden', resize: 'none' } : {}),
            }}
            spellCheck={false}
          />
        )}
      </div>
    )
  },
)


