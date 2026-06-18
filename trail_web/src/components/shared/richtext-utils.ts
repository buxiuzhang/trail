/**
 * 描述/正文里识别 markdown 图片引用和待办/任务提及的纯函数。
 * 单独成文件是因为 react-refresh/only-export-components 不允许 .tsx 组件文件同时 export 非组件。
 */

/** 提取文本里所有待办提及的 ID（用于保存关联） */
export function extractTodoMentionIds(text: string): number[] {
  const ids: number[] = []
  const re = /@todo:(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    ids.push(parseInt(m[1], 10))
  }
  return [...new Set(ids)] // 去重
}

/** 提取文本里所有任务引用的 ID */
export function extractTaskRefIds(text: string): number[] {
  const ids: number[] = []
  const re = /@task:(\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    ids.push(parseInt(m[1], 10))
  }
  return [...new Set(ids)] // 去重
}

/** 规范化提及格式：确保每个提及后面有空格
 *  在保存前调用，让保存的内容包含空格，便于后续编辑时光标定位
 */
export function normalizeMentions(text: string): string {
  // 匹配所有 @todo:ID 或 @task:ID，检查后面是否有空格/换行
  // 如果没有则添加空格（包括末尾的引用）
  return text.replace(/@(todo|task):(\d+)/g, (match, _type, _id, offset, str) => {
    const afterIdx = offset + match.length
    const afterChar = str[afterIdx]
    // 如果后面是空格或换行，不处理
    if (afterChar === ' ' || afterChar === '\n') {
      return match
    }
    // 否则添加空格（包括后面没有字符的情况，即行末）
    return match + ' '
  })
}
