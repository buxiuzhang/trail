/**
 * MarkdownRenderer · 只读 markdown 渲染器
 *
 * 复用 TipTap 的渲染能力,但禁用编辑功能。
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
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import styles from './MarkdownRenderer.module.css'

interface MarkdownRendererProps {
  text: string | null | undefined
  className?: string
}

export function MarkdownRenderer({ text, className }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: true,
          HTMLAttributes: { class: 'tiptap-link' },
        },
      }),
      Image.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: { class: 'tiptap-image' },
      }),
      Markdown.configure({
        html: false,
        breaks: true,
      }),
    ],
    content: text ?? '',
    contentType: 'markdown',
    editable: false,
  })

  // text 变化时更新内容
  useEffect(() => {
    if (!editor || !text) return
    editor.commands.setContent(text, { contentType: 'markdown' })
  }, [editor, text])

  if (!text) return null

  return (
    <div ref={containerRef} className={`${styles.renderer} ${className ?? ''}`}>
      {editor && <EditorContent editor={editor} />}
    </div>
  )
}