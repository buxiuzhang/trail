/**
 * HighlightedCodeBlock · 集成 lowlight 语法高亮 + @tiptap/markdown 解析/序列化
 *
 * 同时解决两个问题：
 *   1. 代码块语法高亮（CodeBlockLowlight）
 *   2. @tiptap/markdown 不识别 `` ``` `` 代码块的缺陷（添加 parseMarkdown/renderMarkdown）
 */
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { common, createLowlight } from 'lowlight'

const lowlight = createLowlight(common)

export const HighlightedCodeBlock = CodeBlockLowlight.extend({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight,
    }
  },

  // 注册为 marked 的 'code' token 类型，让 @tiptap/markdown 能解析代码块
  markdownTokenName: 'code',

  parseMarkdown(token) {
    return {
      type: 'codeBlock',
      attrs: { language: token.lang || null },
      content: token.text ? [{ type: 'text', text: token.text }] : [],
    }
  },

  renderMarkdown(node) {
    const lang = node.attrs.language || ''
    const code = node.textContent || ''
    const fence = '```' + lang + '\n'
    return fence + code + (code.endsWith('\n') ? '' : '\n') + '```\n'
  },
})
