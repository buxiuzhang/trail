/** 任务状态列表 */
export const STATUS_LIST = ['未开始', '进行中', '已完成', '已作废'] as const;
export type TaskStatus = typeof STATUS_LIST[number];

/** 任务性质列表 */
export const NATURE_LIST = ['长期', '临时', '维护'] as const;
export type TaskNature = typeof NATURE_LIST[number];

/** 合法状态转移表：from → Set<to> */
export const ALLOWED_TRANSITIONS: Record<string, Set<string>> = {
  '未开始': new Set(['进行中', '已作废']),
  '进行中': new Set(['已完成', '已作废']),
  '已完成': new Set(['进行中', '已作废']),
  '已作废': new Set(), // 终态
};

/** 状态 → 中文标签（冗余映射，保持一致性） */
export const STATUS_LABELS: Record<string, string> = Object.fromEntries(
  STATUS_LIST.map(s => [s, s])
);

/** 性质 → 中文标签 */
export const NATURE_LABELS: Record<string, string> = Object.fromEntries(
  NATURE_LIST.map(n => [n, n])
);

/** 合法状态转移：Map 版本（方便查找） */
export const ALLOWED_TARGETS: Record<string, string[]> = Object.fromEntries(
  Object.entries(ALLOWED_TRANSITIONS).map(([from, toSet]) => [from, [...toSet]])
);

/** 是否封版：已完成+非维护、已作废 */
export function isSealed(task: { status: string; nature: string }): boolean {
  return task.status === '已作废' || (task.status === '已完成' && task.nature !== '维护');
}
