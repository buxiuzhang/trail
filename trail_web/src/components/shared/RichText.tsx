/**
 * RichText · 描述/正文渲染
 *
 * 设计原则：**文本无图时与原版完全一致**，只在有图时才插入 `<img>` 元素。
 *   - 文本-only + 有 className：渲染为 `<p class="...">text</p>`，与原 `<p>` 完全一致
 *   - 文本-only + 无 className：渲染为 fragment，文本作为调用方容器的直接子节点
 *   - 有图：把文本和图片作为 children 放进 `<p class="...">`（或 'div' / 'span'）
 *
 * M11 新增（不破坏现有调用方）：
 *   - getImgSize?(id) → 1-100  渲染时叠加 style.width = NN%
 *   - onImgSizeChange?(id, size)  编辑场景下提供尺寸按钮回调
 *   - onImgDelete?(id)           编辑场景下提供删除按钮回调
 *   - 不传上述 prop → 行为与 M10 完全一致
 *
 * 故意不做：
 *   - 不解析其它 markdown：保持档案美学的字面感
 *   - 不走 `dangerouslySetInnerHTML`：所有插值都是 React 子节点，无 XSS
 *   - 不接受用户任意 URL：regex 锚定 `/api/attachments/\d+`
 */
import { Fragment, useState } from 'react'
import { parseRichText } from './richtext-utils'
import { MarkdownRenderer } from './MarkdownRenderer'
import { ImageLightbox } from './ImageLightbox'
import styles from './RichText.module.css'

interface RichTextProps {
  text: string | null | undefined
  className?: string
  /** 单图最大高度（px），卡片里压成缩略图用。默认 480 */
  maxImgHeight?: number
  /** 包装元素类型。默认 'p'，对齐项目里描述位原本用的标签。 */
  as?: 'p' | 'div' | 'span'
  /** 4 档预设尺寸：25/50/75/100。返回 1-100 数字，默认 100。 */
  getImgSize?: (id: number) => number
  /** 尺寸按钮点击回调。 */
  onImgSizeChange?: (id: number, size: number) => void
  /** 删除按钮点击回调。 */
  onImgDelete?: (id: number) => void
  /** 是否启用点击预览。默认 true。 */
  enablePreview?: boolean
}

const SIZE_PRESETS = [25, 50, 75, 100] as const

/** 检测文本是否包含 markdown 语法(需要渲染) */
function hasMarkdown(text: string): boolean {
  // 加粗 **text** 或 __text__
  // 斜体 *text* 或 _text_
  // 链接 [text](url)
  // 标题 # ## ###
  // 列表 - * 1.
  // 代码 `code`
  return /(\*\*|__).*?(\*\*|__)|(\*|_).*?(\*|_)|#\s|^\s*[-*+]\s|^\s*\d+\.\s|`[^`]+`/m.test(text)
}

export function RichText({
  text,
  className,
  maxImgHeight = 480,
  as: As = 'p',
  getImgSize,
  onImgSizeChange,
  onImgDelete,
  enablePreview = true,
}: RichTextProps) {
  const [previewSrc, setPreviewSrc] = useState<string | null>(null)
  const [previewAlt, setPreviewAlt] = useState<string>('')

  if (!text) return null

  // 如果有图片交互需求 或 包含 markdown 语法,用 MarkdownRenderer
  const needsMarkdown = hasMarkdown(text) || getImgSize || onImgSizeChange || onImgDelete

  if (needsMarkdown && !getImgSize && !onImgSizeChange && !onImgDelete) {
    // 只有 markdown 语法,无图片交互 -> 用 MarkdownRenderer
    return <MarkdownRenderer text={text} className={className} />
  }
  const parts = parseRichText(text)

  const interactive = !!(getImgSize || onImgSizeChange || onImgDelete)

  const handleImgClick = (url: string, alt: string) => {
    if (enablePreview) {
      setPreviewSrc(url)
      setPreviewAlt(alt)
    }
  }

  const content = parts.map((p, i) =>
    p.kind === 'text' ? (
      <Fragment key={i}>{p.value}</Fragment>
    ) : (
      <ImgNode
        key={i}
        url={p.url}
        alt={p.alt}
        maxHeight={maxImgHeight}
        getImgSize={getImgSize}
        onImgSizeChange={onImgSizeChange}
        onImgDelete={onImgDelete}
        interactive={interactive}
        enablePreview={enablePreview}
        onClick={() => handleImgClick(p.url, p.alt)}
        inlineCount={p.inlineCount}
      />
    ),
  )

  if (!className) {
    return (
      <>
        {content}
        {previewSrc && (
          <ImageLightbox
            src={previewSrc}
            alt={previewAlt}
            onClose={() => setPreviewSrc(null)}
          />
        )}
      </>
    )
  }

  return (
    <>
      {As === 'div' ? (
        <div className={className}>{content}</div>
      ) : As === 'span' ? (
        <span className={className}>{content}</span>
      ) : (
        <p className={className}>{content}</p>
      )}
      {previewSrc && (
        <ImageLightbox
          src={previewSrc}
          alt={previewAlt}
          onClose={() => setPreviewSrc(null)}
        />
      )}
    </>
  )
}

interface ImgNodeProps {
  url: string
  alt: string
  maxHeight: number
  getImgSize?: (id: number) => number
  onImgSizeChange?: (id: number, size: number) => void
  onImgDelete?: (id: number) => void
  interactive: boolean
  enablePreview: boolean
  onClick: () => void
  /** 同一行有多少张图片，用于自动均分宽度 */
  inlineCount?: number
}

function ImgNode({ url, alt, maxHeight, getImgSize, onImgSizeChange, onImgDelete, interactive, enablePreview, onClick, inlineCount }: ImgNodeProps) {
  const [hovered, setHovered] = useState(false)
  const id = Number(url.split('/').pop() ?? '0')
  // 优先用用户设置的尺寸
  const userSize = getImgSize?.(id)
  // 单图占满一行，多图并排时宽度用 calc 减去间距
  const size = userSize ?? (inlineCount && inlineCount > 1 ? `calc(50% - 2px)` : '100%')
  return (
    <span
      className={styles.imgWrapper}
      style={{ width: `${size}%` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <img
        src={url}
        alt={alt}
        className={styles.inlineImg}
        style={{ maxHeight: `${maxHeight}px` }}
        loading="lazy"
        onClick={enablePreview ? (e) => { e.stopPropagation(); onClick(); } : undefined}
      />
      {interactive && hovered && (onImgSizeChange || onImgDelete) && (
        <span className={styles.imgToolbar}>
          {onImgSizeChange &&
            SIZE_PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                className={`${styles.sizeBtn} ${size === preset ? styles.sizeBtnActive : ''}`}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  onImgSizeChange(id, preset)
                }}
                title={`展示宽度 ${preset}%`}
              >
                {preset}
              </button>
            ))}
          {onImgDelete && (
            <button
              type="button"
              className={styles.delBtn}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                onImgDelete(id)
              }}
              title="删除"
              aria-label="删除图片"
            >
              🗑
            </button>
          )}
        </span>
      )}
    </span>
  )
}
