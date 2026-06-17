/**
 * DescriptionEditor · 基于 TipTap 的 Markdown WYSIWYG 编辑器
 *
 * 设计原则：
 *   - 外部 props / ref 与旧版本**完全一致**：调用点零改动
 *   - 内部用 TipTap 接管：所见即所得编辑 / 图片粘贴 / @ 提及
 *   - 图片交互（25/50/75/100 缩放 + 删除）通过 Portal 浮层实现
 *   - @ 提及使用 TipTap 官方 Mention 扩展，直接插入 markdown 格式
 *
 * 关键不变量：
 *   - value 同步：lastEmittedRef 防循环
 *   - ref 兼容：useImperativeHandle 返回 adapter，.focus() 委托 TipTap
 *   - 全局 .logbook textarea 选择器：内部 hidden textarea（视觉隐藏，DOM 存在）
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useQueries } from '@tanstack/react-query'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { Markdown } from '@tiptap/markdown'
import {
  useUploadAttachment,
  useUpdateAttachment,
  useDeleteAttachment,
  type DeleteInUseError,
} from '@/api/attachments'
import { useToastContext } from '@/context/ToastContext'
import { useModalContext } from '@/context/ModalContext'
import { extractImageRefs } from './richtext-utils'
import type { TodoOut } from '@/types'
import styles from './DescriptionEditor.module.css'

interface DescriptionEditorProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** 保留 prop（textarea 时代的语义，TipTap 静默忽略） */
  rows?: number
  minHeight?: number
  /** 透传给容器 div 的额外 className（如 "field__textarea"） */
  textareaClassName?: string
  /** 当前任务的待办列表（用于 @ 提及） */
  todos?: TodoOut[]
}

// 4 档尺寸预设
const SIZE_PRESETS = [25, 50, 75, 100] as const

export const DescriptionEditor = forwardRef<HTMLTextAreaElement, DescriptionEditorProps>(function DescriptionEditor(
  {
    value,
    onChange,
    placeholder,
    rows: _rows = 4,
    minHeight = 120,
    textareaClassName = 'field__textarea',
    todos = [],
  },
  ref,
) {

  void _rows
  const editorRootRef = useRef<HTMLDivElement>(null)
  const hiddenTaRef = useRef<HTMLTextAreaElement>(null)
  const lastEmittedRef = useRef<string>(value)
  const onChangeRef = useRef(onChange)
  const isInitializedRef = useRef(false)

  // 保持 onChange 引用最新（用 useEffect 避免 render 期间修改 ref）
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // 标记初始化完成
  useEffect(() => {
    // 使用 queueMicrotask 确保在当前渲染周期完成后标记初始化
    const id = requestAnimationFrame(() => {
      isInitializedRef.current = true
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // hooks
  const upload = useUploadAttachment()
  const updateSize = useUpdateAttachment()
  const deleteAtt = useDeleteAttachment()
  const { showToast } = useToastContext()
  const { openModal } = useModalContext()

  // 提取 value 里所有图片 id
  const refIds = useMemo(() => {
    const refs = extractImageRefs(value)
    return Array.from(new Set(refs.map((r) => Number(r.url.split('/').pop()))))
  }, [value])

  // 拉所有 id 的 displaySize
  const sizeQueries = useQueries({
    queries: refIds.map((id) => ({
      queryKey: ['attachment', id] as const,
      queryFn: () =>
        fetch(`/api/attachments/${id}/meta`).then(
          (r) => r.json() as Promise<{ id: number; displaySize: number }>,
        ),
      enabled: id > 0,
      staleTime: 60_000,
    })),
  })
  const sizeMap = useMemo(() => {
    const m: Record<number, number> = {}
    refIds.forEach((id, i) => {
      const d = sizeQueries[i]?.data
      if (d) m[id] = d.displaySize
    })
    return m
  }, [refIds, sizeQueries])

  // @ 提及候选浮层状态
  const [mentionState, setMentionState] = useState<{
    active: boolean
    query: string
    items: TodoOut[]
    selectedIndex: number
    position: { top: number; left: number }
    command?: (item: TodoOut) => void
  }>({
    active: false,
    query: '',
    items: [],
    selectedIndex: 0,
    position: { top: 0, left: 0 },
  })

  // TipTap 编辑器初始化
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: {
          openOnClick: false,
          HTMLAttributes: { class: 'tiptap-link' },
        },
      }),
      Image.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: { class: 'tiptap-image' },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? '',
      }),
      Markdown.configure({
        html: false, // 禁用 HTML 标签
        breaks: true, // 单个换行符转换为 <br>
      }),
      Mention.configure({
        HTMLAttributes: { class: 'mention-todo' },
        suggestion: {
          items: ({ query }) =>
            todos.filter(
              (t) =>
                !t.is_completed &&
                !t.is_abandoned &&
                t.title.toLowerCase().includes(query.toLowerCase()),
            ),
          render: () => {

            return {
              onStart: (props) => {
                const rect = props.clientRect?.()
                if (!rect) return
                setMentionState({
                  active: true,
                  query: props.query,
                  items: props.items,
                  selectedIndex: 0,
                  position: { top: rect.bottom, left: rect.left },
                  command: (item: TodoOut) => {
                    props.command({ id: String(item.id), label: item.title })
                  },
                })
              },
              onUpdate: (props) => {
                const rect = props.clientRect?.()
                if (!rect) return
                setMentionState((prev) => ({
                  ...prev,
                  active: true,
                  query: props.query,
                  items: props.items,
                  selectedIndex: 0,
                  position: { top: rect.bottom, left: rect.left },
                  command: (item: TodoOut) => {
                    props.command({ id: String(item.id), label: item.title })
                  },
                }))
              },
              onKeyDown: (props) => {
                if (props.event.key === 'Escape') {
                  setMentionState((prev) => ({ ...prev, active: false }))
                  return true
                }
                if (props.event.key === 'ArrowDown') {
                  setMentionState((prev) => ({
                    ...prev,
                    selectedIndex: Math.min(
                      prev.selectedIndex + 1,
                      prev.items.length - 1,
                    ),
                  }))
                  return true
                }
                if (props.event.key === 'ArrowUp') {
                  setMentionState((prev) => ({
                    ...prev,
                    selectedIndex: Math.max(prev.selectedIndex - 1, 0),
                  }))
                  return true
                }
                if (props.event.key === 'Enter') {
                  const item = mentionState.items[mentionState.selectedIndex]
                  if (item && mentionState.command) {
                    mentionState.command(item)
                    setMentionState((prev) => ({ ...prev, active: false }))
                  }
                  return true
                }
                return false
              },
              onExit: () => {
                setMentionState((prev) => ({ ...prev, active: false }))
              },
            }
          },
        },
      }),
    ],
    content: value,
    contentType: 'markdown',
    onUpdate: ({ editor }) => {
      // 使用 @tiptap/markdown 提供的 getMarkdown() 方法
      const md = editor.getMarkdown()
      lastEmittedRef.current = md
      if (hiddenTaRef.current) hiddenTaRef.current.value = md
      // 只在初始化完成后才通知父组件，避免在渲染期间更新状态
      if (isInitializedRef.current) {
        queueMicrotask(() => {
          onChangeRef.current(md)
        })
      }
    },
    editorProps: {
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items
        if (!items) return false

        for (const item of items) {
          if (item.type.startsWith('image/')) {
            const file = item.getAsFile()
            if (file) {
              event.preventDefault()
              uploadImage(file).then((url) => {
                editor?.chain().focus().setImage({ src: url }).run()
              })
              return true
            }
          }
        }
        return false
      },
    },
  })

  // 更新编辑器内容（当外部 value 变化时）
  useEffect(() => {
    if (!editor) return
    // 防止循环：如果当前内容与 value 相同，跳过
    const currentMd = editor.getMarkdown()
    if (value === currentMd) return
    if (value === lastEmittedRef.current) return

    // 使用 setContent 更新内容，指定 contentType 为 markdown
    editor.commands.setContent(value, { contentType: 'markdown' })
    lastEmittedRef.current = value
    if (hiddenTaRef.current) hiddenTaRef.current.value = value
  }, [editor, value])

  // 上传图片
  const uploadImage = useCallback(
    async (file: File): Promise<string> => {
      try {
        const att = await upload.mutateAsync(file)
        return `/api/attachments/${att.id}`
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        showToast('上传失败：' + msg)
        throw err
      }
    },
    [upload, showToast],
  )

  // ref 兼容
  useImperativeHandle(
    ref,
    () => {
      const adapter = {
        focus: () => {
          editor?.commands.focus()
        },
      }
      return adapter as unknown as HTMLTextAreaElement
    },
    [editor],
  )

  // 图片尺寸变化
  function handleSizeChange(id: number, size: number) {
    updateSize.mutate({ id, displaySize: size })
  }

  // 图片删除
  function handleDeleteClick(id: number) {
    const refMarkdown = new RegExp(
      `!\\[[^\\]]*\\]\\(/api/attachments/${id}\\)`,
      'g',
    )
    openModal({
      eyebrow: '图片',
      title: '删除图片',
      body: '确认删除这张图片？文本里的 markdown 引用会一并清掉。',
      buttons: [
        { label: '取消', action: () => undefined },
        {
          label: '删除',
          className: 'btn-danger',
          action: () => {
            deleteAtt.mutate(id, {
              onSuccess: () => {
                const next = value
                  .replace(refMarkdown, '')
                  .replace(/\n{3,}/g, '\n\n')
                onChange(next)
              },
              onError: (err) => {
                const e = err as Error & { inUse?: DeleteInUseError }
                if (e.inUse) {
                  const first = e.inUse.references[0]
                  const where = first?.title
                    ? `${sourceTypeLabel(first.sourceType)}《${first.title}》(${first.column})`
                    : `${first?.sourceType}#${first?.sourceId}`
                  showToast(
                    `图片被 ${e.inUse.refCount} 处引用：${where}${e.inUse.refCount > 1 ? ' 等' : ''}，未删除。`,
                  )
                } else {
                  showToast('删除失败：' + e.message)
                }
              },
            })
          },
        },
      ],
    })
  }

  // 提及候选项点击
  function handleMentionSelect(item: TodoOut) {
    if (mentionState.command) {
      mentionState.command(item)
      setMentionState((prev) => ({ ...prev, active: false }))
    }
  }

  return (
    <div
      className={`${styles.editorBox} ${textareaClassName ?? ''}`}
      style={{ minHeight }}
    >
      <div ref={editorRootRef} className={styles.tiptapContainer}>
        {editor && <EditorContent editor={editor} />}
      </div>
      {/* 视觉隐藏的 textarea：DOM 存在以兼容 .logbook textarea 选择器 */}
      <textarea
        ref={hiddenTaRef}
        className={styles.hiddenTaMirror}
        readOnly
        aria-hidden
        tabIndex={-1}
        defaultValue={value}
      />
      <ImgToolbarPortal
        rootRef={editorRootRef}
        sizeMap={sizeMap}
        onSizeChange={handleSizeChange}
        onDelete={handleDeleteClick}
      />
      {/* @ 提及候选浮层 */}
      {mentionState.active && mentionState.items.length > 0 && (
        <MentionPortal
          items={mentionState.items}
          selectedIndex={mentionState.selectedIndex}
          position={mentionState.position}
          onSelect={handleMentionSelect}
          onClose={() =>
            setMentionState((prev) => ({ ...prev, active: false }))
          }
        />
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// MentionPortal · @ 提及候选浮层
// ---------------------------------------------------------------------------
interface MentionPortalProps {
  items: TodoOut[]
  selectedIndex: number
  position: { top: number; left: number }
  onSelect: (item: TodoOut) => void
  onClose: () => void
}

function MentionPortal({
  items,
  selectedIndex,
  position,
  onSelect,
  onClose,
}: MentionPortalProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return createPortal(
    <div
      ref={listRef}
      className={styles.mentionPopup}
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        zIndex: 9999,
      }}
    >
      {items.map((item, i) => (
        <div
          key={item.id}
          className={`${styles.mentionItem} ${
            i === selectedIndex ? styles.mentionItemActive : ''
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(item)}
        >
          <span className={styles.todoTitle}>{item.title}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// ImgToolbarPortal · 图片 hover 浮层工具条（25/50/75/100 + 🗑）
// ---------------------------------------------------------------------------
interface ImgToolbarPortalProps {
  rootRef: React.RefObject<HTMLElement | null>
  sizeMap: Record<number, number>
  onSizeChange: (id: number, size: number) => void
  onDelete: (id: number) => void
}

function ImgToolbarPortal({
  rootRef,
  sizeMap,
  onSizeChange,
  onDelete,
}: ImgToolbarPortalProps) {
  const [hovered, setHovered] = useState<{ id: number; rect: DOMRect } | null>(
    null,
  )

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onMove = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) {
        setHovered(null)
        return
      }
      const img =
        t.tagName === 'IMG'
          ? (t as HTMLImageElement)
          : (t.closest('img') as HTMLImageElement | null)
      if (!img) {
        setHovered(null)
        return
      }
      const m = img.src.match(/\/api\/attachments\/(\d+)/)
      if (!m) {
        setHovered(null)
        return
      }
      const id = Number(m[1])
      if (!id) {
        setHovered(null)
        return
      }
      setHovered((prev) =>
        prev?.id === id ? prev : { id, rect: img.getBoundingClientRect() },
      )
    }
    const onLeave = () => setHovered(null)
    const onScroll = () => setHovered(null)
    root.addEventListener('mousemove', onMove)
    root.addEventListener('mouseleave', onLeave)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      root.removeEventListener('mousemove', onMove)
      root.removeEventListener('mouseleave', onLeave)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [rootRef])

  if (!hovered) return null
  const size = sizeMap[hovered.id] ?? 100
  return createPortal(
    <div
      className={styles.imgToolbar}
      style={{
        position: 'fixed',
        top: hovered.rect.top + 4,
        left: hovered.rect.right - 4,
        transform: 'translate(-100%, 0)',
        zIndex: 9999,
      }}
    >
      {SIZE_PRESETS.map((p) => (
        <button
          key={p}
          type="button"
          className={`${styles.sizeBtn} ${size === p ? styles.sizeBtnActive : ''}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onSizeChange(hovered.id, p)
          }}
        >
          {p}
        </button>
      ))}
      <button
        type="button"
        className={styles.delBtn}
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          onDelete(hovered.id)
        }}
        title="删除图片"
        aria-label="删除图片"
      >
        🗑
      </button>
    </div>,
    document.body,
  )
}

function sourceTypeLabel(t: 'task' | 'log' | 'todo'): string {
  if (t === 'task') return '任务'
  if (t === 'log') return '日志'
  return '待办'
}
