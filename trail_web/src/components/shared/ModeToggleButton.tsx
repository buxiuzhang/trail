/**
 * ModeToggleButton · 预览/源码切换按钮 (受控)
 *
 * 跟 DescriptionEditorWithMode 解耦:父组件管 mode state,
 * 此组件只渲染按钮 + 触发 onModeChange。
 *
 * 用法:
 *   <ModeToggleButton mode={mode} onModeChange={setMode} style={{ marginLeft: 'auto' }} />
 *
 * 无定位,默认 inline-flex;父容器自己决定位置
 * (flex 容器中传 style.marginLeft: 'auto' 推到行尾)。
 */
import type { CSSProperties } from 'react'
import { IconPreview, IconSource } from './ModeIcons'
import styles from './DescriptionEditorWithMode.module.css'

export type EditorMode = 'preview' | 'source'

interface Props {
  mode: EditorMode
  onModeChange: (m: EditorMode) => void
  className?: string
  style?: CSSProperties
  /** 按钮用途：编辑场景用 'edit'，只读查看用 'view'。默认 'edit' */
  usage?: 'edit' | 'view'
}

export function ModeToggleButton({ mode, onModeChange, className, style, usage = 'edit' }: Props) {
  const previewTitle = usage === 'edit' ? '预览编辑' : '预览查看'
  const sourceTitle = usage === 'edit' ? '源码编辑' : '源码查看'
  const previewLabel = usage === 'edit' ? '预览编辑(点击切换到源码)' : '预览查看(点击切换到源码)'
  const sourceLabel = usage === 'edit' ? '源码编辑(点击切换到预览)' : '源码查看(点击切换到预览)'

  return (
    <button
      type="button"
      className={className ? `${styles.modeBtn} ${className}` : styles.modeBtn}
      style={style}
      onClick={() => onModeChange(mode === 'preview' ? 'source' : 'preview')}
      title={mode === 'preview' ? previewTitle : sourceTitle}
      aria-label={mode === 'preview' ? previewLabel : sourceLabel}
      aria-pressed={mode === 'source'}
      // 阻止按钮 click 切走编辑器焦点
      onMouseDown={(e) => e.preventDefault()}
    >
      {mode === 'preview' ? (
        <IconPreview className={styles.modeBtnIcon} />
      ) : (
        <IconSource className={styles.modeBtnIcon} />
      )}
    </button>
  )
}
