/**
 * MilkdownEditor · 基于 Milkdown Crepe 的 Markdown 编辑器
 *
 * 双重渲染修复（关键）：在 DOM 元素上**同步**打标记，而不是用 querySelector
 *   - querySelector('.milkdown') 检查依赖异步 create() 已 resolve —— 在
 *     StrictMode 第一次 effect 还没 resolve 就 cleanup 时会失效
 *   - DOM 元素的属性是同步读写，cleanup 不会清除（我们故意不清除）
 *   - 标记只在真实的组件卸载时随元素一起被 GC
 */
import { useEffect, useRef } from 'react'
import { CrepeBuilder } from '@milkdown/crepe'
import { placeholder } from '@milkdown/crepe/feature/placeholder'
import { cursor } from '@milkdown/crepe/feature/cursor'
import { listItem } from '@milkdown/crepe/feature/list-item'
import { linkTooltip } from '@milkdown/crepe/feature/link-tooltip'
import { imageBlock } from '@milkdown/crepe/feature/image-block'
import '@milkdown/crepe/theme/common/style.css'
import styles from './MilkdownEditor.module.css'

interface MilkdownEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

// 同步标记键：挂在容器 DOM 元素自身属性上
const FLAG_KEY = '__milkdownCrepeInit__'

/** 上传图片到后端，返回 markdown URL */
async function uploadImage(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch('/api/attachments', { method: 'POST', body: form })
  if (!r.ok) {
    throw new Error(`上传失败：HTTP ${r.status}`)
  }
  const data = await r.json() as { id: number }
  return `/api/attachments/${data.id}`
}

export function MilkdownEditor({ value, onChange, placeholder: placeholderText }: MilkdownEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<CrepeBuilder | null>(null)
  const onChangeRef = useRef(onChange)

  // 保持 onChange 引用最新
  onChangeRef.current = onChange

  // 初始化编辑器
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // 【关键】同步检查 + 同步标记
    // 同一个 DOM 元素即使被 StrictMode 的 cleanup→effect 二次触发，
    // 标记依然在元素上，第二次 effect 会直接 return
    const c = container as HTMLDivElement & { [FLAG_KEY]?: boolean }
    if (c[FLAG_KEY]) {
      return
    }
    c[FLAG_KEY] = true

    const editor = new CrepeBuilder({
      root: container,
      defaultValue: value,
    })
      .addFeature(placeholder, { text: placeholderText || '', mode: 'doc' })
      .addFeature(cursor)
      .addFeature(listItem)
      .addFeature(linkTooltip)
      .addFeature(imageBlock, {
        onUpload: uploadImage,
        inlineOnUpload: uploadImage,
        blockOnUpload: uploadImage,
      })
      .on((api) => {
        api.markdownUpdated((ctx, markdown) => {
          onChangeRef.current(markdown)
        })
      })

    editor.create().then(() => {
      editorRef.current = editor
    })

    return () => {
      // 销毁可能已初始化的编辑器
      editorRef.current?.destroy()
      editorRef.current = null
      // 清空 DOM 容器
      container.innerHTML = ''
      // 【故意不清除 FLAG_KEY】
      // StrictMode 模拟的 unmount 也会走这个 cleanup，
      // 但下一个 effect 必须看到 FLAG 才能跳过第二次初始化。
      // 真正的组件卸载时，container 元素会被 React 销毁、GC，标记随之消失。
    }
  }, []) // 空依赖，只在挂载时执行

  return (
    <div className={styles.editorWrapper}>
      <div className={styles.editor} ref={containerRef} />
    </div>
  )
}