/**
 * 描述/正文里识别 markdown 图片引用的纯函数。
 * 单独成文件是因为 react-refresh/only-export-components 不允许 .tsx 组件文件同时 export 非组件。
 */
export interface ImageRef {
  alt: string
  url: string
}

const IMG_RE = /!\[([^\]]*)\]\((\/api\/attachments\/\d+)\)/g

/** 提取文本里所有 `![]()` 图片引用（描述/正文回显用，DescriptionEditor 也用） */
export function extractImageRefs(text: string): ImageRef[] {
  const out: ImageRef[] = []
  let m: RegExpExecArray | null
  IMG_RE.lastIndex = 0  // 安全：避免调用方传了 stateful regex
  const re = /!\[([^\]]*)\]\((\/api\/attachments\/\d+)\)/g
  while ((m = re.exec(text)) !== null) {
    out.push({ alt: m[1] || '', url: m[2] })
  }
  return out
}

/** 把文本切成 [textPart, imgPart, ...] 序列，供 RichText 渲染。 */
export function parseRichText(text: string): Array<
  | { kind: 'text'; value: string }
  | { kind: 'img'; alt: string; url: string }
> {
  const out: Array<
    | { kind: 'text'; value: string }
    | { kind: 'img'; alt: string; url: string }
  > = []
  let last = 0
  const re = /!\[([^\]]*)\]\((\/api\/attachments\/\d+)\)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push({ kind: 'text', value: text.slice(last, m.index) })
    }
    out.push({ kind: 'img', alt: m[1] || '', url: m[2] })
    last = re.lastIndex
  }
  if (last < text.length) {
    out.push({ kind: 'text', value: text.slice(last) })
  }
  return out
}
