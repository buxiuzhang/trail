/**
 * DescriptionEditor · 基于 TipTap 的 Markdown WYSIWYG 编辑器
 *
 * 设计原则：
 *   - 外部 props / ref 与旧版本**完全一致**：调用点零改动
 *   - 内部用 TipTap 接管：所见即所得编辑 / 图片粘贴 / @ 提及
 *   - 图片预览：点击图片 → 全屏暗色遮罩展示原图
 *   - @ 提及使用 TipTap 官方 Mention 扩展，直接插入 markdown 格式
 *   - @ 提及显示标题：通过 decoration + CSS ::after 实现
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
  useRef,
  useState,
} from 'react'
import { createPortal } from 'react-dom'
import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import Mention from '@tiptap/extension-mention'
import { Markdown } from '@tiptap/markdown'
import { Extension } from '@tiptap/core'
import { HighlightedCodeBlock } from './HighlightedCodeBlock'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import {
  useUploadAttachment,
} from '@/api/attachments'
import { useToastContext } from '@/context/ToastContext'
import { normalizeMentions } from './richtext-utils'
import { ImagePreview } from './ImagePreview'
import type { TodoOut, TaskOut } from '@/types'
import styles from './DescriptionEditor.module.css'
import tiptapStyles from './TipTapContent.module.css'

/** 提及候选项（待办或任务） */
interface MentionCandidate {
  type: 'todo' | 'task'
  id: number
  title: string
}

/** 创建装饰器扩展，将 @task:ID 和 @todo:ID 显示为标题
 *  使用 CSS ::after 显示标题，font-size: 0 隐藏原始文本
 *  当后面没有空格时，使用 widget decoration 插入空格确保光标可定位
 */
export function createMentionDecorationExtension(
  todosRef: React.MutableRefObject<ReadonlyArray<{ id: number; title: string }>>,
  tasksRef: React.MutableRefObject<ReadonlyArray<{ id: number; title: string }>>,
  /** 样式类名，默认使用 DescriptionEditor 的样式 */
  styleClasses?: { todoMentionDecor: string; taskMentionDecor: string },
) {
  const todoClass = styleClasses?.todoMentionDecor ?? styles.todoMentionDecor
  const taskClass = styleClasses?.taskMentionDecor ?? styles.taskMentionDecor

  return Extension.create({
    name: 'mentionDecoration',
    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey('mentionDecoration'),
          props: {
            decorations(state) {
              const decorations: Decoration[] = []
              const doc = state.doc
              // 从 ref 获取最新值
              const todos = todosRef.current
              const tasks = tasksRef.current

              // 遍历文档中的所有文本节点
              doc.descendants((node, pos) => {
                if (!node.isText) return

                const text = node.text ?? ''
                // 匹配 @todo:ID 或 @task:ID
                const re = /@(todo|task):(\d+)/g
                let m: RegExpExecArray | null

                while ((m = re.exec(text)) !== null) {
                  const type = m[1] as 'todo' | 'task'
                  const id = parseInt(m[2], 10)
                  const start = pos + m.index
                  const end = start + m[0].length

                  // 从数据中查找标题
                  const items = type === 'todo' ? todos : tasks
                  const found = items.find((t) => t.id === id)
                  const title = found?.title || `@${type}:${id}`

                  // 使用 inline decoration 添加样式和数据属性
                  // CSS 通过 ::after 显示标题，font-size: 0 隐藏原始文本
                  // inclusiveEnd: false 允许光标落在装饰末尾，不依赖尾部空格
                  const className = type === 'todo' ? todoClass : taskClass
                  decorations.push(
                    Decoration.inline(
                      start,
                      end,
                      {
                        class: className,
                        'data-mention-type': type,
                        'data-mention-id': String(id),
                        'data-mention-title': title,
                        'data-mention-end': String(end),
                      },
                      { inclusiveEnd: false },
                    ),
                  )
                }
              })

              return DecorationSet.create(doc, decorations)
            },
          },
        }),
      ]
    },
  })
}

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
  /** 全局任务列表（用于 @ 任务引用） */
  tasks?: TaskOut[]
}

export const DescriptionEditor = forwardRef<HTMLTextAreaElement, DescriptionEditorProps>(function DescriptionEditor(
  {
    value,
    onChange,
    placeholder,
    rows: _rows = 4,
    minHeight = 120,
    textareaClassName = 'field__textarea',
    todos = [],
    tasks = [],
  },
  ref,
) {

  void _rows
  const editorRootRef = useRef<HTMLDivElement>(null)
  const hiddenTaRef = useRef<HTMLTextAreaElement>(null)
  const lastEmittedRef = useRef<string>(value)
  const onChangeRef = useRef(onChange)
  const isInitializedRef = useRef(false)
  // 使用 ref 存储 todos 和 tasks 的最新值，供 Mention 扩展的 items 函数使用
  const todosRef = useRef(todos)
  const tasksRef = useRef(tasks)

  // 保持 refs 最新
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])
  useEffect(() => {
    todosRef.current = todos
  }, [todos])
  useEffect(() => {
    tasksRef.current = tasks
  }, [tasks])

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
  const { showToast } = useToastContext()

  // 图片预览状态
  const [previewImage, setPreviewImage] = useState<string | null>(null)

  // @ 提及候选浮层状态
  const [mentionState, setMentionState] = useState<{
    active: boolean
    query: string
    items: MentionCandidate[]
    selectedIndex: number
    position: { top: number; left: number }
    command?: (item: MentionCandidate) => void
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
        // 关闭 trailingNode：当内容以列表结尾时 appendTransaction 会崩溃
        trailingNode: false,
        // 由 CodeBlockLowlight 接管
        codeBlock: false,
      }),
      HighlightedCodeBlock,
      Image.configure({
        inline: true,
        allowBase64: false,
        HTMLAttributes: { class: 'tiptap-image' },
      }),
      Placeholder.configure({
        placeholder: placeholder ?? '',
      }),
      Markdown,
      // 装饰器扩展：将 @task:ID 和 @todo:ID 显示为标题
      createMentionDecorationExtension(todosRef, tasksRef),
      Mention.configure({
        HTMLAttributes: { class: 'mention-ref' },
        suggestion: {
          items: ({ query }) => {
            const q = query.toLowerCase()
            // 从 ref 获取最新值（避免闭包陷阱）
            const currentTodos = todosRef.current
            const currentTasks = tasksRef.current
            // 1. 当前任务的待办（优先）
            const todoItems: MentionCandidate[] = currentTodos
              .filter(
                (t) =>
                  !t.is_completed &&
                  !t.is_abandoned &&
                  t.title.toLowerCase().includes(q),
              )
              .map((t) => ({ type: 'todo', id: t.id, title: t.title }))
            // 2. 全局任务（其次）
            const taskItems: MentionCandidate[] = currentTasks
              .filter((t) => t.title.toLowerCase().includes(q))
              .map((t) => ({ type: 'task', id: t.id, title: t.title }))
            return [...todoItems, ...taskItems]
          },
          render: () => {
            return {
              onStart: (props) => {
                const rect = props.clientRect?.()
                if (!rect) return
                const items = props.items as MentionCandidate[]
                setMentionState({
                  active: true,
                  query: props.query,
                  items,
                  selectedIndex: 0,
                  position: { top: rect.bottom, left: rect.left },
                  command: (item: MentionCandidate) => {
                    // 直接插入 @todo:ID 或 @task:ID 纯文本
                    const text = `@${item.type}:${item.id} `
                    props.editor
                      .chain()
                      .focus()
                      .insertContentAt(props.range, text)
                      .run()
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
                  items: props.items as MentionCandidate[],
                  selectedIndex: 0,
                  position: { top: rect.bottom, left: rect.left },
                  command: (item: MentionCandidate) => {
                    const text = `@${item.type}:${item.id} `
                    props.editor
                      .chain()
                      .focus()
                      .insertContentAt(props.range, text)
                      .run()
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
    content: normalizeMentions(value),
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
      handleClick: (view, pos, event) => {
        const target = event.target as HTMLElement
        const img = target.closest('img')
        if (img) {
          event.preventDefault()
          setPreviewImage(img.getAttribute('src') ?? '')
          return true
        }
        return false
      },
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

  // todos/tasks 异步加载后，触发 decoration 重新计算（@ 提及渲染）
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, todos, tasks])

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

  // 提及候选项点击
  function handleMentionSelect(item: MentionCandidate) {
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
      <div ref={editorRootRef} className={`${styles.tiptapContainer} ${tiptapStyles.content}`}>
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
      {/* 图片预览 */}
      {previewImage && (
        <ImagePreview
          src={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// MentionPortal · @ 提及候选浮层
// ---------------------------------------------------------------------------
interface MentionPortalProps {
  items: MentionCandidate[]
  selectedIndex: number
  position: { top: number; left: number }
  onSelect: (item: MentionCandidate) => void
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
          key={`${item.type}_${item.id}`}
          className={`${styles.mentionItem} ${
            i === selectedIndex ? styles.mentionItemActive : ''
          }`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onSelect(item)}
        >
          <span className={item.type === 'todo' ? styles.todoTag : styles.taskTag}>
            {item.type === 'todo' ? '待办' : '任务'}
          </span>
          <span className={styles.itemTitle}>{item.title}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}