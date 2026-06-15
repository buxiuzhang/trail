import styles from './ChatWindow.module.css'

/** 解析后的文本片段 */
type TextPart =
  | { type: 'text'; text: string }
  | { type: 'link'; text: string; url: string }

/**
 * 将 Markdown 链接语法 `[text](url)` 转为可点击的 <a> 标签
 * 仅支持链接语法，不渲染其他 Markdown 元素
 */
export function MessageContent({ content }: { content: string }) {
  const parts = parseLinks(content)

  return (
    <div className={styles.msgContent}>
      {parts.map((part, i) => {
        if (part.type === 'text') {
          return <span key={i}>{part.text}</span>
        }
        // 链接
        const isExternal = part.url.startsWith('http://') || part.url.startsWith('https://')
        const isApiLink = part.url.startsWith('/api/')

        // 安全校验：只允许内部 /api/ 链接和外部 https/http 链接
        if (!isExternal && !isApiLink) {
          return <span key={i}>{part.text}</span>
        }

        return (
          <a
            key={i}
            href={part.url}
            className={styles.link}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
          >
            {part.text}
          </a>
        )
      })}
    </div>
  )
}

/**
 * 解析文本中的 Markdown 链接
 * 匹配模式：[显示文本](URL)
 */
function parseLinks(text: string): TextPart[] {
  // 正则：\[([^\]]+)\]\(([^)]+)\)
  // 匹配 [文本](URL)，文本不能含 ]，URL 不能含 )
  const LINK_REGEX = /\[([^\]]+)\]\(([^)]+)\)/g

  const parts: TextPart[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = LINK_REGEX.exec(text)) !== null) {
    // 链接前的普通文本
    if (match.index > lastIndex) {
      parts.push({ type: 'text', text: text.slice(lastIndex, match.index) })
    }

    // 链接
    parts.push({
      type: 'link',
      text: match[1],
      url: match[2],
    })

    lastIndex = match.index + match[0].length
  }

  // 剩余的普通文本
  if (lastIndex < text.length) {
    parts.push({ type: 'text', text: text.slice(lastIndex) })
  }

  // 如果没有链接，返回原文本
  if (parts.length === 0) {
    return [{ type: 'text', text }]
  }

  return parts
}
