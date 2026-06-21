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
import { useEffect, useRef, useState } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import { HighlightedCodeBlock } from './HighlightedCodeBlock'
import { createMentionDecorationExtension } from './DescriptionEditor'
import { ImagePreview } from './ImagePreview'
import styles from './MarkdownRenderer.module.css'
import tiptapStyles from './TipTapContent.module.css'

interface MarkdownRendererProps {
  text: string | null | undefined
  className?: string
  /** 待办列表（用于渲染 @todo:ID） */
  todos?: { id: number; title: string }[]
  /** 任务列表（用于渲染 @task:ID） */
  tasks?: { id: number; title: string }[]
}

export function MarkdownRenderer({ text, className, todos = [], tasks = [] }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const todosRef = useRef(todos)
  const tasksRef = useRef(tasks)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  // 保持 ref 最新
  useEffect(() => {
    todosRef.current = todos
  }, [todos])
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: true,
          HTMLAttributes: { class: 'tiptap-link' },
        },
        trailingNode: false,
        codeBlock: false,
      }),
      HighlightedCodeBlock,
      Image.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: { class: 'tiptap-image' },
      }),
      Markdown,
      // 添加 mention decoration 扩展，渲染 @todo:ID 和 @task:ID
      createMentionDecorationExtension(todosRef, tasksRef, {
        todoMentionDecor: styles.todoMentionDecor,
        taskMentionDecor: styles.taskMentionDecor,
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

  // todos/tasks 异步加载后，触发 decoration 重新计算（@ 提及渲染）
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, todos, tasks])

  if (!text) return null

  const handleClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement
    // 附件链接：阻止下载，内容区只作展示，下载从下方附件区操作
    const link = target.closest('a')
    if (link?.getAttribute('href')?.startsWith('/api/attachments/')) {
      e.preventDefault()
      return
    }
    // 图片预览
    const img = target.closest('img')
    if (img) {
      e.preventDefault()
      setPreviewImage(img.getAttribute('src') ?? '')
      return
    }
    // 任务引用导航
    const el = target.closest('[data-mention-type="task"]')
    if (!el) return
    const id = el.getAttribute('data-mention-id')
    if (id) {
      window.location.hash = `#/task/${id}`
    }
  }

  return (
    <>
      <div ref={containerRef} className={`${styles.renderer} ${className ?? ''} ${tiptapStyles.content}`} onClick={handleClick}>
        {editor && <EditorContent editor={editor} />}
      </div>
      {/* 图片预览 */}
      {previewImage && (
        <ImagePreview
          src={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </>
  )
}