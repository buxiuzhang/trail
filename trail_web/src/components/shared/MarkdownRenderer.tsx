/**
 * MarkdownRenderer · 只读 markdown 渲染器
 *
 * 复用 Milkdown Crepe 的渲染能力,但禁用编辑功能。
 * 用于日志/描述等只读展示场景,保持与编辑器一致的视觉效果。
 *
 * 与 RichText 的关系:
 *   - RichText: 轻量渲染,只处理图片,文本原样输出
 *   - MarkdownRenderer: 完整 markdown 渲染(加粗/斜体/链接/列表等)
 *
 * 用法:
 *   <MarkdownRenderer text={log.content} className={styles.content} />
 */
import { useEffect, useRef } from 'react'
import { CrepeBuilder } from '@milkdown/crepe'
import { placeholder as placeholderFeature } from '@milkdown/crepe/feature/placeholder'
import { listItem } from '@milkdown/crepe/feature/list-item'
import styles from './MarkdownRenderer.module.css'
import '@milkdown/crepe/theme/common/style.css'

interface MarkdownRendererProps {
  text: string | null | undefined
  className?: string
}

export function MarkdownRenderer({ text, className }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const crepeRef = useRef<CrepeBuilder | null>(null)
  const initRef = useRef(false)

  useEffect(() => {
    if (!text || initRef.current) return
    initRef.current = true

    const container = containerRef.current
    if (!container) {
      initRef.current = false
      return
    }

    const crepe = new CrepeBuilder({
      root: container,
      defaultValue: text,
    })
      .addFeature(placeholderFeature, { text: '', mode: 'doc' })
      .addFeature(listItem)

    crepe.create().then(() => {
      crepeRef.current = crepe
      // 设置为只读模式
      crepe.setReadonly(true)
    }).catch(() => undefined)

    return () => {
      void crepe.destroy().catch(() => undefined)
      crepeRef.current = null
      container.innerHTML = ''
      initRef.current = false
    }
  }, [text])

  // text 变化时更新内容
  useEffect(() => {
    if (!crepeRef.current || !text) return
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (crepeRef.current as any).editor?.action?.((ctx: any) => {
      const editor = ctx?.editor
      if (editor) {
        editor.commands.replaceAll(text)
      }
    })
  }, [text])

  if (!text) return null

  return (
    <div
      ref={containerRef}
      className={`${styles.renderer} ${className ?? ''}`}
    />
  )
}
