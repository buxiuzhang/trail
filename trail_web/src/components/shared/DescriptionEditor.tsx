/**
 * DescriptionEditor · 基于 Milkdown Crepe 的 Markdown WYSIWYG 编辑器
 *
 * 设计原则：
 *   - 外部 props / ref 与旧 textarea+mirror 版本**完全一致**：3 个调用点零改动
 *   - 内部用 Crepe 接管：所见即所得编辑 / 图片粘贴 / ProseMirror 撤销栈
 *   - 图片交互（25/50/75/100 缩放 + 删除 + 409 引用提示）保留，
 *     通过容器 mouseover 监听 + Portal 浮层实现，不 hack Crepe NodeView
 *
 * 关键不变量：
 *   - value 同步：lastEmittedRef 防循环 + pendingValueRef 处理 create() 未 resolve
 *   - ref 兼容：useImperativeHandle 返回 Proxy adapter，.focus() 委托 ProseMirror
 *   - 全局 .logbook textarea 选择器：内部 hidden textarea（视觉隐藏，DOM 存在）
 *   - StrictMode 双 effect：DOM 元素 __milkdownCrepeInit__ 同步标记，cleanup 不清
 *
 * 故意不做：
 *   - 不引新 UI 库（确认弹窗走 useModalContext.openModal）
 *   - 不写裸 fetch（上传走 useUploadAttachment.mutateAsync）
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
import { CrepeBuilder } from '@milkdown/crepe'
import { placeholder as placeholderFeature } from '@milkdown/crepe/feature/placeholder'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { imageBlock } from '@milkdown/crepe/feature/image-block'
import { replaceAll } from '@milkdown/kit/utils'
import {
  useUploadAttachment,
  useUpdateAttachment,
  useDeleteAttachment,
  type DeleteInUseError,
} from '@/api/attachments'
import { useToastContext } from '@/context/ToastContext'
import { useModalContext } from '@/context/ModalContext'
import { extractImageRefs } from './richtext-utils'
import styles from './DescriptionEditor.module.css'
import '@milkdown/crepe/theme/common/style.css'

interface DescriptionEditorProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  /** 保留 prop（textarea 时代的语义，Milkdown 静默忽略） */
  rows?: number
  minHeight?: number
  /** 透传给 Milkdown 容器 div 的额外 className（如 "field__textarea"） */
  textareaClassName?: string
}

// 4 档尺寸预设
const SIZE_PRESETS = [25, 50, 75, 100] as const

export const DescriptionEditor = forwardRef<HTMLTextAreaElement, DescriptionEditorProps>(function DescriptionEditor(
  {
    value,
    onChange,
    placeholder,
    rows: _rows = 4, // 保留参数，Milkdown 无行数概念
    minHeight = 120,
    textareaClassName = 'field__textarea',
  },
  ref,
) {
  const editorRootRef = useRef<HTMLDivElement>(null)
  const hiddenTaRef = useRef<HTMLTextAreaElement>(null)
  const crepeRef = useRef<CrepeBuilder | null>(null)
  const onChangeRef = useRef(onChange)

  // value 同步：lastEmittedRef 跟踪最近一次编辑器吐出的 markdown，
  // useEffect([value]) 用它防循环（onChange → setValue → useEffect → replaceAll → 回调）
  const lastEmittedRef = useRef<string>(value)
  // create() 异步未完成时缓存外部 value，resolve 后 flush
  const pendingValueRef = useRef<string | null>(null)

  // 保持 onChange 引用最新
  onChangeRef.current = onChange

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

  // 上传闭包：复用 useUploadAttachment 的错误处理
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

  // Crepe 初始化 effect（仅挂载一次）
  // StrictMode 双 effect 处理：useRef 同步标记（cleanup 重置，让第二次 effect 重新初始化），
  // 不挂在 DOM 上 —— DOM 标记会被 cleanup 的 innerHTML='' 清掉导致 race
  const initRef = useRef(false)

  useEffect(() => {
    if (initRef.current) return
    initRef.current = true

    const container = editorRootRef.current
    if (!container) {
      initRef.current = false // 让下次 effect 重试
      return
    }

    const crepe = new CrepeBuilder({
      root: container,
      defaultValue: value,
    })
      .addFeature(placeholderFeature, { text: placeholder ?? '', mode: 'doc' })
      .addFeature(cursor)
      .addFeature(listItem)
      .addFeature(linkTooltip)
      .addFeature(imageBlock, {
        onUpload: uploadImage,
        inlineOnUpload: uploadImage,
        blockOnUpload: uploadImage,
      })
      .on((api) => {
        api.markdownUpdated((_ctx, md) => {
          lastEmittedRef.current = md
          if (hiddenTaRef.current) hiddenTaRef.current.value = md
          onChangeRef.current(md)
        })
      })

    crepe.create().then(() => {
      crepeRef.current = crepe
      // flush create() 期间缓存的 value
      if (
        pendingValueRef.current != null &&
        pendingValueRef.current !== lastEmittedRef.current
      ) {
        const v = pendingValueRef.current
        crepe.editor.action(replaceAll(v))
        lastEmittedRef.current = v
        pendingValueRef.current = null
      }
    }).catch(() => undefined)

    return () => {
      // destroy 可能已初始化的编辑器
      void crepe.destroy().catch(() => undefined)
      crepeRef.current = null
      container.innerHTML = ''
      // 重置 initRef：让 StrictMode 第二次 effect 或真实重挂载可以重新初始化
      initRef.current = false
    }
  }, []) // 空依赖，仅挂载

  // value prop 变化时同步进编辑器
  useEffect(() => {
    // 与上次 emit 一致，无需操作（onChange 回调循环场景）
    if (value === lastEmittedRef.current) return
    if (crepeRef.current) {
      crepeRef.current.editor.action(replaceAll(value))
      lastEmittedRef.current = value
    } else {
      // create() 还没 resolve，缓存
      pendingValueRef.current = value
    }
    if (hiddenTaRef.current) hiddenTaRef.current.value = value
  }, [value])

  // ref 兼容：返回 Proxy adapter 伪造 HTMLTextAreaElement，
  // 外部 .focus() 委托给 ProseMirror
  useImperativeHandle(
    ref,
    () => {
      const adapter = {
        focus: () => {
          const pm = editorRootRef.current?.querySelector<HTMLElement>('.ProseMirror')
          if (pm) pm.focus()
          else hiddenTaRef.current?.focus()
        },
      }
      return adapter as unknown as HTMLTextAreaElement
    },
    [],
  )

  // 图片尺寸变化
  function handleSizeChange(id: number, size: number) {
    updateSize.mutate({ id, displaySize: size })
  }

  // 图片删除
  function handleDeleteClick(id: number) {
    const refMarkdown = new RegExp(`!\\[[^\\]]*\\]\\(/api/attachments/${id}\\)`, 'g')
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
                const next = value.replace(refMarkdown, '').replace(/\n{3,}/g, '\n\n')
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

  return (
    <div
      className={`${styles.editorBox} ${textareaClassName ?? ''}`}
      style={{ minHeight }}
    >
      <div ref={editorRootRef} className={styles.milkdownContainer} />
      {/* 视觉隐藏的 textarea：DOM 存在以兼容 DetailPage.tsx:475 的 .logbook textarea 选择器 */}
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
    </div>
  )
})

// ---------------------------------------------------------------------------
// ImgToolbarPortal · 图片 hover 浮层工具条（25/50/75/100 + 🗑）
//
// 实现要点：
//   - 监听 Milkdown 容器的 mousemove 找 img，从 src 解析 id
//   - Portal 到 document.body，position: fixed 跟随 img 视口坐标
//   - 所有按钮 onMouseDown preventDefault 阻止焦点切换，编辑器不中断打字
//   - 不 hack Crepe imageBlock NodeView（升级安全）
// ---------------------------------------------------------------------------
interface ImgToolbarPortalProps {
  rootRef: React.RefObject<HTMLElement | null>
  sizeMap: Record<number, number>
  onSizeChange: (id: number, size: number) => void
  onDelete: (id: number) => void
}

function ImgToolbarPortal({ rootRef, sizeMap, onSizeChange, onDelete }: ImgToolbarPortalProps) {
  const [hovered, setHovered] = useState<{ id: number; rect: DOMRect } | null>(null)

  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const onMove = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null
      if (!t) {
        setHovered(null)
        return
      }
      const img = t.tagName === 'IMG' ? (t as HTMLImageElement) : t.closest('img') as HTMLImageElement | null
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
      // 同 id 不更新 state，避免每次 mousemove 都 rerender
      setHovered((prev) => (prev?.id === id ? prev : { id, rect: img.getBoundingClientRect() }))
    }
    const onLeave = () => setHovered(null)
    const onScroll = () => setHovered(null) // 滚动时收工具条，避免错位
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