/**
 * DescriptionEditorWithMode · 在 DescriptionEditor 外面包一层 "预览 / 源码" 切换
 *
 * 设计要点：
 *   - 复用 DescriptionEditor，**不动**它的内部逻辑（Crepe 初始化稳定）
 *   - 切换模式时通过 conditional render 让 DescriptionEditor 自然卸载/重挂，
 *     useEffect cleanup → initRef 重置 → 下次 mount Crepe 重建
 *   - value 双向同步：preview 和 source 共享一份 value，切换不丢内容
 *   - 受控 mode:父组件管 state,本组件只渲染分支 + 转发 onModeChange
 *   - 内置按钮默认在右上角(overlay 模式),传 hideInlineToggle=true 时不渲染
 *     ——父组件可独立用 <ModeToggleButton /> 放到任意位置(如 .composeRow 行尾)
 *
 * ref 处理：
 *   - 外部 .focus() 在 preview 模式委托给 DescriptionEditor (内部最终走 ProseMirror)
 *   - source 模式委托给可见的 textarea
 *
 * 故意不做：
 *   - 不引新依赖
 *   - source 模式不解析 markdown（就是纯 textarea），跟 demo 一致
 */
import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useRef,
} from 'react'
import { DescriptionEditor } from './DescriptionEditor'
import { IconPreview, IconSource } from './ModeIcons'
import { type EditorMode } from './ModeToggleButton'
import styles from './DescriptionEditorWithMode.module.css'

export type { EditorMode }

interface Props {
  value: string
  onChange: (v: string) => void
  mode: EditorMode
  onModeChange: (m: EditorMode) => void
  /** 传 true 则不在编辑器内部渲染按钮,由父组件自己用 <ModeToggleButton /> 放置 */
  hideInlineToggle?: boolean
  placeholder?: string
  rows?: number
  minHeight?: number
  textareaClassName?: string
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
      textareaClassName = 'field__textarea',
    },
    ref,
  ) {
    // 模式各自的 focus 入口
    const previewRef = useRef<HTMLTextAreaElement>(null)
    const sourceRef = useRef<HTMLTextAreaElement>(null)

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

    const handleSourceChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        onChange(e.target.value)
      },
      [onChange],
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
          <DescriptionEditor
            ref={previewRef}
            value={value}
            onChange={onChange}
            placeholder={placeholder}
            rows={rows}
            minHeight={minHeight}
            textareaClassName={textareaClassName}
          />
        ) : (
          <textarea
            ref={sourceRef}
            className={`${styles.sourceTextarea} ${textareaClassName ?? ''}`}
            value={value}
            onChange={handleSourceChange}
            placeholder={placeholder}
            rows={rows}
            style={{ minHeight }}
            spellCheck={false}
          />
        )}
      </div>
    )
  },
)
