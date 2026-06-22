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
import { useEffect, useRef, useState, useMemo } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import { Markdown } from '@tiptap/markdown'
import { HighlightedCodeBlock } from './HighlightedCodeBlock'
import { createMentionDecorationExtension } from './DescriptionEditor'
import { useAttachmentsByIds } from '@/api/attachments'
import { ImagePreview } from './ImagePreview'
import styles from './MarkdownRenderer.module.css'
import tiptapStyles from './TipTapContent.module.css'

interface MarkdownRendererProps {
  text: string | null | undefined
  className?: string
  todos?: { id: number; title: string }[]
  tasks?: { id: number; title: string }[]
}

export function MarkdownRenderer({ text, className, todos = [], tasks = [] }: MarkdownRendererProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const todosRef = useRef(todos)
  const tasksRef = useRef(tasks)
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  // 自动从 text 解析 @file:N，拉取附件元数据
  const fileIds = useMemo(() => {
    const ids: number[] = []
    const re = /@file:(\d+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(text ?? '')) !== null) ids.push(Number(m[1]))
    return ids
  }, [text])
  const { data: attList = [] } = useAttachmentsByIds(fileIds)
  const attachmentsRef = useRef<Map<number, { name: string; mime: string }>>(new Map())

  useEffect(() => { todosRef.current = todos }, [todos])
  useEffect(() => { tasksRef.current = tasks }, [tasks])
  useEffect(() => {
    const m = new Map<number, { name: string; mime: string }>()
    for (const a of attList) m.set(a.id, { name: a.original_name || `文件 #${a.id}`, mime: a.mime })
    attachmentsRef.current = m
  }, [attList])

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
      // 添加 mention decoration 扩展，渲染 @todo:ID、@task:ID 和 @file:ID
      createMentionDecorationExtension(todosRef, tasksRef, {
        todoMentionDecor: styles.todoMentionDecor,
        taskMentionDecor: styles.taskMentionDecor,
      }, attachmentsRef),
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

  // todos/tasks/attList 变化后触发 decoration 重新计算
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, todos, tasks, attList])

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