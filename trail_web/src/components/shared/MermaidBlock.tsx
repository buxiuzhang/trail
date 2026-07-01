import { useCallback, useEffect, useRef, useState } from 'react'
import { NodeViewWrapper, type NodeViewProps } from '@tiptap/react'
import mermaid from 'mermaid'
import { ImagePreview } from './ImagePreview'
import styles from './MermaidBlock.module.css'

mermaid.initialize({
  startOnLoad: false,
  theme: 'neutral',
  securityLevel: 'loose',
})

let idCounter = 0

export function MermaidNodeView({ node }: NodeViewProps) {
  const code = node.textContent
  return (
    <NodeViewWrapper>
      <MermaidBlock code={code} />
    </NodeViewWrapper>
  )
}

export function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const idRef = useRef(`mermaid-${++idCounter}`)

  useEffect(() => {
    if (!code.trim()) return
    setError(null)
    mermaid
      .render(idRef.current, code)
      .then(({ svg: rendered }) => {
        setSvg(rendered)
      })
      .catch((err: unknown) => {
        setSvg(null)
        setError(err instanceof Error ? err.message : String(err))
      })
  }, [code])

  const handleClick = useCallback(() => {
    if (!svg) return
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
    setPreviewSrc(uri)
  }, [svg])

  if (error) {
    return (
      <div className={styles.mermaidError}>
        <pre className={styles.mermaidErrorCode}>{code}</pre>
        <span className={styles.mermaidErrorMsg}>流程图解析失败：{error}</span>
      </div>
    )
  }

  if (!svg) return <pre className={styles.mermaidLoading}>{code}</pre>

  return (
    <>
      <div
        className={styles.mermaidBlock}
        title="点击预览"
        onClick={handleClick}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: svg }}
      />
      {previewSrc && (
        <ImagePreview src={previewSrc} onClose={() => setPreviewSrc(null)} />
      )}
    </>
  )
}
