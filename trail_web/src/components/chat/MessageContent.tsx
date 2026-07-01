import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import { useDownloadQueue } from '@/context/DownloadQueueContext'
import CopyIcon from './copy.svg'
import CopiedIcon from './copied.svg'
import styles from './ChatWindow.module.css'

function CodeBlock({ children }: { children: React.ReactNode }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const text = typeof children === 'string'
      ? children
      : (children as React.ReactElement<{ children?: unknown }>)?.props?.children ?? ''
    navigator.clipboard.writeText(String(text)).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  return (
    <div className={styles.codeBlock}>
      <button
        type="button"
        className={`${styles.codeCopyBtn} ${copied ? styles.codeCopyBtnCopied : ''}`}
        onClick={handleCopy}
        title={copied ? '已复制' : '复制'}
        aria-label={copied ? '已复制' : '复制'}
      >
        <img src={copied ? CopiedIcon : CopyIcon} width={13} height={13} alt="" aria-hidden="true" />
      </button>
      <pre style={{ background: 'var(--card-deep)', padding: '6px 10px', borderRadius: 2, overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: 12, margin: 0, maxWidth: '100%' }}>
        <code>{children}</code>
      </pre>
    </div>
  )
}

export function MessageContent({
  content,
  onAction,
}: {
  content: string
  onAction?: (action: string) => void
}) {
  const navigate = useNavigate()
  const { enqueueDownload } = useDownloadQueue()

  return (
    <div className={styles.msgContent}>
      <ReactMarkdown
        urlTransform={(url) => url}
        components={{
          // 标题降级为加粗段落（避免聊天窗口出现大标题）
          h1: ({ children }) => <p><strong>{children}</strong></p>,
          h2: ({ children }) => <p><strong>{children}</strong></p>,
          h3: ({ children }) => <p><strong>{children}</strong></p>,
          h4: ({ children }) => <p><strong>{children}</strong></p>,
          h5: ({ children }) => <p><strong>{children}</strong></p>,
          h6: ({ children }) => <p><strong>{children}</strong></p>,
          // 链接路由分发
          a: ({ href, children }) => {
            if (!href) return <span>{children}</span>

            if (href.startsWith('action:')) {
              return (
                <button className={styles.actionLink} onClick={() => onAction?.(href.slice(7))}>
                  {children}
                </button>
              )
            }

            if (href.startsWith('/task/')) {
              return (
                <button className={styles.actionLink} onClick={() => navigate(href)}>
                  {children}
                </button>
              )
            }

            const normalized = href.startsWith('api/') ? '/' + href : href
            if (normalized.startsWith('/api/')) {
              return (
                <button
                  className={styles.actionLink}
                  onClick={() => enqueueDownload(normalized, typeof children === 'string' ? children : undefined)}
                >
                  {children}
                </button>
              )
            }

            return (
              <a href={href} className={styles.link} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            )
          },
          p:     ({ children }) => <p style={{ margin: '3px 0' }}>{children}</p>,
          ul:    ({ children }) => <ul style={{ paddingLeft: 18, margin: '3px 0' }}>{children}</ul>,
          ol:    ({ children }) => <ol style={{ paddingLeft: 18, margin: '3px 0' }}>{children}</ol>,
          li:    ({ children }) => <li style={{ margin: '2px 0' }}>{children}</li>,
          code:  ({ children, className }) =>
            className
              ? <CodeBlock>{children}</CodeBlock>
              : <code style={{ background: 'var(--card-deep)', padding: '1px 5px', borderRadius: 2, fontSize: '0.9em', wordBreak: 'break-all', overflowWrap: 'anywhere' }}>{children}</code>,
          table: ({ children }) => <table style={{ borderCollapse: 'collapse', fontSize: 13, margin: '4px 0', width: '100%' }}>{children}</table>,
          th:    ({ children }) => <th style={{ border: '0.5px solid var(--rule)', padding: '4px 8px', textAlign: 'left', background: 'var(--card-deep)' }}>{children}</th>,
          td:    ({ children }) => <td style={{ border: '0.5px solid var(--rule)', padding: '4px 8px' }}>{children}</td>,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
