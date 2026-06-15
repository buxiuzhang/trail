/**
 * ImageLightbox · 图片预览弹窗
 *
 * 点击图片后全屏预览，支持：
 *   - 点击背景或关闭按钮关闭
 *   - ESC 键关闭
 *   - 图片自适应居中显示
 *
 * 使用 Portal 渲染到 body，避免父容器 transform 破坏 fixed 定位。
 */
import { useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import styles from './ImageLightbox.module.css'

interface ImageLightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  // ESC 关闭
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    // 禁止 body 滚动
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  return createPortal(
    <div className={styles.overlay} onClick={onClose}>
      <button
        type="button"
        className={styles.closeBtn}
        onClick={onClose}
        aria-label="关闭"
      >
        ✕
      </button>
      <div className={styles.content} onClick={(e) => e.stopPropagation()}>
        <img src={src} alt={alt ?? ''} className={styles.img} />
      </div>
    </div>,
    document.body
  )
}