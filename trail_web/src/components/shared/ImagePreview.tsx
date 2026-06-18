/**
 * ImagePreview · 图片预览（全屏暗色遮罩）
 *
 * 在 DescriptionEditor 和 MarkdownRenderer 中复用。
 * 点击遮罩、✕ 按钮或按 ESC 关闭。
 */
import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import styles from './ImagePreview.module.css'

interface ImagePreviewProps {
  src: string
  onClose: () => void
}

export function ImagePreview({ src, onClose }: ImagePreviewProps) {
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose])

  return createPortal(
    <div
      ref={overlayRef}
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose()
      }}
    >
      <button className={styles.close} onClick={onClose} aria-label="关闭">
        ✕
      </button>
      <img
        className={styles.image}
        src={src}
        alt="预览"
        onClick={(e) => e.stopPropagation()}
      />
    </div>,
    document.body,
  )
}
