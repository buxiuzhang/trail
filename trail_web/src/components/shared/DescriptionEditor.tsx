/* eslint-disable react-refresh/only-export-components */
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
import { useDownloadQueue } from '@/context/DownloadQueueContext'
import { useUploadQueue } from '@/context/UploadQueueContext'
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

/** 创建装饰器扩展，将 @task:ID 和 @todo:ID 显示为标题，@file:ID 显示为图片或文件 chip
 *  使用 CSS ::after 显示标题，font-size: 0 隐藏原始文本
 *  当后面没有空格时，使用 widget decoration 插入空格确保光标可定位
 */
export function createMentionDecorationExtension(
  todosRef: React.MutableRefObject<ReadonlyArray<{ id: number; title: string }>>,
  tasksRef: React.MutableRefObject<ReadonlyArray<{ id: number; title: string }>>,
  /** 样式类名，默认使用 DescriptionEditor 的样式 */
  styleClasses?: { todoMentionDecor: string; taskMentionDecor: string },
  /** 附件元数据 ref，供 @file:N 渲染使用 */
  attachmentsRef?: React.MutableRefObject<Map<number, { name: string; mime: string }>>,
  /** 下载回调 ref，供 @file:N chip 点击使用 */
  downloadRef?: React.MutableRefObject<((url: string, fileName?: string) => void) | null>,
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
              const todos = todosRef.current
              const tasks = tasksRef.current
              const attMap = attachmentsRef?.current

              doc.descendants((node, pos) => {
                if (!node.isText) return

                const text = node.text ?? ''
                // @todo:ID 和 @task:ID
                const re = /@(todo|task):(\d+)/g
                let m: RegExpExecArray | null

                while ((m = re.exec(text)) !== null) {
                  const type = m[1] as 'todo' | 'task'
                  const id = parseInt(m[2], 10)
                  const start = pos + m.index
                  const end = start + m[0].length

                  const items = type === 'todo' ? todos : tasks
                  const found = items.find((t) => t.id === id)
                  const title = found?.title || `@${type}:${id}`

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

                // @file:ID
                const fileRe = /@file:(\d+)/g
                while ((m = fileRe.exec(text)) !== null) {
                  const id = parseInt(m[1], 10)
                  const start = pos + m.index
                  const end = start + m[0].length
                  const att = attMap?.get(id)
                  const name = att?.name || `文件 #${id}`
                  const mime = att?.mime || ''
                  const isImage = mime.startsWith('image/')

                  if (isImage) {
                    decorations.push(
                      Decoration.inline(start, end, {
                        style: 'font-size:0;color:transparent;',
                      }),
                    )
                    decorations.push(
                      Decoration.widget(start, () => {
                        const img = document.createElement('img')
                        img.src = `/api/attachments/${id}`
                        img.alt = name
                        img.className = 'tiptap-image file-token-img'
                        img.style.cssText = 'max-width:100%;display:block;margin:8px 0;border-radius:4px;cursor:zoom-in;'
                        return img
                      }, { side: -1, key: `file-img-${id}-${name}` }),
                    )
                  } else {
                    decorations.push(
                      Decoration.inline(start, end, {
                        class: 'file-token-chip',
                        'data-file-id': String(id),
                        'data-file-name': name,
                        style: 'font-size:0;color:transparent;',
                      }),
                    )
                    decorations.push(
                      Decoration.widget(start, () => {
                        const span = document.createElement('span')
                        span.className = 'file-token-chip'
                        span.setAttribute('data-file-id', String(id))
                        span.style.cssText =
                          'display:inline-flex;align-items:center;gap:4px;padding:1px 6px;' +
                          'background:var(--card-deep);border:0.5px solid var(--rule-soft);' +
                          'border-radius:3px;font-size:12px;color:var(--ink);cursor:pointer;font-family:var(--mono);'
                        span.title = name
                        span.textContent = '📎 ' + name
                        span.addEventListener('click', (e) => {
                          e.preventDefault()
                          const dl = downloadRef?.current
                          if (dl) {
                            dl(`/api/attachments/${id}`, name)
                          } else {
                            const a = document.createElement('a')
                            a.href = `/api/attachments/${id}`
                            a.download = name
                            a.click()
                          }
                        })
                        return span
                      }, { side: -1, key: `file-chip-${id}-${name}` }),
                    )
                  }
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
  /** 附件元数据（用于 @file:N 渲染） */
  attachments?: Map<number, { name: string; mime: string }>
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
    attachments,
  },
  ref,
) {

  void _rows
  const editorRootRef = useRef<HTMLDivElement>(null)
  const hiddenTaRef = useRef<HTMLTextAreaElement>(null)
  const lastEmittedRef = useRef<string>(value)
  const onChangeRef = useRef(onChange)
  const isInitializedRef = useRef(false)
  const isSettingContentRef = useRef(false)
  // 使用 ref 存储 todos 和 tasks 的最新值，供 Mention 扩展的 items 函数使用
  const todosRef = useRef(todos)
  const tasksRef = useRef(tasks)
  const attachmentsRef = useRef<Map<number, { name: string; mime: string }>>(attachments ?? new Map())
  const { enqueueDownload } = useDownloadQueue()
  const downloadRef = useRef<((url: string, fileName?: string) => void) | null>(enqueueDownload)
  /** 已出现在文档中的 @mention 键集合，防止重复引用 */
  const usedMentionKeysRef = useRef(new Set<string>())

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
  useEffect(() => {
    attachmentsRef.current = attachments ?? new Map()
  }, [attachments])

  // value 变化时，解析已使用的 @mention 键（用于过滤候选列表）
  useEffect(() => {
    const keys = new Set<string>()
    const re = /@(todo|task):(\d+)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(value)) !== null) {
      keys.add(`${m[1]}:${m[2]}`)
    }
    usedMentionKeysRef.current = keys
  }, [value])

  // 标记初始化完成
  useEffect(() => {
    // 使用 queueMicrotask 确保在当前渲染周期完成后标记初始化
    const id = requestAnimationFrame(() => {
      isInitializedRef.current = true
    })
    return () => cancelAnimationFrame(id)
  }, [])

  // hooks
  const { uploadFile: queueUpload } = useUploadQueue()

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
  /** ref 镜像，供 onKeyDown 闭包读取最新值（避免闭包陷阱） */
  const mentionStateRef = useRef(mentionState)
  useEffect(() => { mentionStateRef.current = mentionState }, [mentionState])

  // / 斜杠命令状态
  const [slashState, setSlashState] = useState<{
    active: boolean
    position: { top: number; left: number }
    selectedIndex: number
  }>({ active: false, position: { top: 0, left: 0 }, selectedIndex: 0 })
  const slashStateRef = useRef(slashState)
  useEffect(() => { slashStateRef.current = slashState }, [slashState])

  // 隐藏的文件选择器（图片 + 文件统一）
  const fileInputRef = useRef<HTMLInputElement>(null)
  const editorRef = useRef<import('@tiptap/core').Editor | null>(null)

  // 上传文件（通过队列）—— 斜杠命令和文件 input 使用
  const uploadFileRef = useRef<(file: File) => void>(() => {})
  const uploadFile = useCallback((file: File) => {
    queueUpload(file, (_url, _name, _mime, id) => {
      const ed = editorRef.current
      if (!ed) return
      ed.chain().focus().insertContent(`@file:${id} `).run()
    })
  }, [queueUpload])
  useEffect(() => { uploadFileRef.current = uploadFile }, [uploadFile])

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
      // 装饰器扩展：将 @task:ID 和 @todo:ID 显示为标题，@file:ID 显示图片或文件 chip
      createMentionDecorationExtension(todosRef, tasksRef, undefined, attachmentsRef, downloadRef),
      Mention.configure({
        HTMLAttributes: { class: 'mention-ref' },
        suggestion: {
          items: ({ query }) => {
            const q = query.toLowerCase()
            const used = usedMentionKeysRef.current
            // 从 ref 获取最新值（避免闭包陷阱）
            const currentTodos = todosRef.current
            const currentTasks = tasksRef.current
            // 1. 当前任务的待办（优先），过滤已引用的
            const todoItems: MentionCandidate[] = currentTodos
              .filter(
                (t) =>
                  !used.has(`todo:${t.id}`) &&
                  !t.is_completed &&
                  !t.is_abandoned &&
                  t.title.toLowerCase().includes(q),
              )
              .map((t) => ({ type: 'todo', id: t.id, title: t.title }))
            // 2. 全局任务（其次），过滤已引用的
            const taskItems: MentionCandidate[] = currentTasks
              .filter(
                (t) =>
                  !used.has(`task:${t.id}`) &&
                  t.title.toLowerCase().includes(q),
              )
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
                  const state = mentionStateRef.current
                  const item = state.items[state.selectedIndex]
                  if (item && state.command) {
                    state.command(item)
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
      // 程序性 setContent 触发的 onUpdate，不回调父组件，避免循环覆盖
      if (isSettingContentRef.current) return
      let md = editor.getMarkdown()
      // @tiptap/markdown 会将 @task:ID 中的冒号转义为 \:，归一化回来
      md = md.replace(/@(task|todo)\\:/g, '@$1:')
      // 防序列化完全丢失：仅当文档无任何节点时跳过
      if (lastEmittedRef.current.length > 20 && md.trim().length === 0 && editor.state.doc.childCount === 0) return
      lastEmittedRef.current = md
      if (hiddenTaRef.current) hiddenTaRef.current.value = md
      if (isInitializedRef.current) {
        onChangeRef.current(md)
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
              uploadFileRef.current(file)
              return true
            }
          }
        }
        return false
      },
      handleKeyDown: (view, event) => {
        // 斜杠命令面板导航
        const slash = slashStateRef.current
        if (slash.active) {
          if (event.key === 'Escape') {
            setSlashState(prev => ({ ...prev, active: false }))
            return true
          }
          if (event.key === 'ArrowDown') {
            setSlashState(prev => ({ ...prev, selectedIndex: Math.min(prev.selectedIndex + 1, 1) }))
            return true
          }
          if (event.key === 'ArrowUp') {
            setSlashState(prev => ({ ...prev, selectedIndex: Math.max(prev.selectedIndex - 1, 0) }))
            return true
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            setSlashState(prev => ({ ...prev, active: false }))
            view.dispatch(view.state.tr.delete(view.state.selection.from - 1, view.state.selection.from))
            fileInputRef.current?.click()
            return true
          }
        }
        // 触发斜杠命令
        if (event.key === '/') {
          const coords = view.coordsAtPos(view.state.selection.from)
          setSlashState({ active: true, position: { top: coords.bottom + 4, left: coords.left }, selectedIndex: 0 })
          return false // 让 "/" 正常插入，面板只是覆盖层
        }
        return false
      },
    },
  })

  // 同步 editorRef
  useEffect(() => { editorRef.current = editor }, [editor])

  // 更新编辑器内容（当外部 value 变化时）
  useEffect(() => {
    if (!editor) return
    if (!isInitializedRef.current) return
    const currentMd = editor.getMarkdown()
    if (value === currentMd) return
    if (value === lastEmittedRef.current) return

    isSettingContentRef.current = true
    editor.commands.setContent(value, { contentType: 'markdown' })
    isSettingContentRef.current = false
    lastEmittedRef.current = value
    if (hiddenTaRef.current) hiddenTaRef.current.value = value
  }, [editor, value])

  // todos/tasks/attachments 变化后，触发 decoration 重新计算
  useEffect(() => {
    if (!editor) return
    editor.view.dispatch(editor.state.tr)
  }, [editor, todos, tasks, attachments])

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

  // 斜杠命令选择
  function handleSlashSelect(_index: number) {
    const ed = editorRef.current
    if (!ed) return
    const { state } = ed.view
    ed.view.dispatch(state.tr.delete(state.selection.from - 1, state.selection.from))
    setSlashState(prev => ({ ...prev, active: false }))
    fileInputRef.current?.click()
  }

  return (
    <div
      className={`${styles.editorBox} ${textareaClassName ?? ''}`}
      style={{ minHeight }}
    >
      {/* 隐藏文件选择器 */}
      <input ref={fileInputRef} type="file" style={{ display: 'none' }}
        onChange={e => { const f = e.target.files?.[0]; if (f) uploadFile(f); e.target.value = '' }} />
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
      {/* / 斜杠命令面板 */}
      {slashState.active && (
        <SlashCommandPortal
          selectedIndex={slashState.selectedIndex}
          position={slashState.position}
          onSelect={handleSlashSelect}
          onClose={() => setSlashState(prev => ({ ...prev, active: false }))}
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
// SlashCommandPortal · / 斜杠命令面板
// ---------------------------------------------------------------------------
const SLASH_COMMANDS = [
  { label: '上传附件', desc: '图片 / 文件', icon: '📎' },
]

interface SlashCommandPortalProps {
  selectedIndex: number
  position: { top: number; left: number }
  onSelect: (index: number) => void
  onClose: () => void
}

function SlashCommandPortal({ selectedIndex, position, onSelect, onClose }: SlashCommandPortalProps) {
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (listRef.current && !listRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [onClose])

  return createPortal(
    <div
      ref={listRef}
      className={styles.slashPopup}
      style={{ position: 'fixed', top: position.top, left: position.left, zIndex: 9999 }}
    >
      <div className={styles.slashHeader}>插入</div>
      {SLASH_COMMANDS.map((cmd, i) => (
        <div
          key={i}
          className={`${styles.slashItem} ${i === selectedIndex ? styles.slashItemActive : ''}`}
          onMouseDown={e => e.preventDefault()}
          onClick={() => onSelect(i)}
        >
          <span className={styles.slashIcon}>{cmd.icon}</span>
          <span className={styles.slashLabel}>{cmd.label}</span>
          <span className={styles.slashDesc}>{cmd.desc}</span>
        </div>
      ))}
    </div>,
    document.body,
  )
}
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

  // 选中项变化时滚动到可视区域
  useEffect(() => {
    if (!listRef.current) return
    const el = listRef.current.children[selectedIndex] as HTMLElement | undefined
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

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