/** 今天的日期（YYYY-MM-DD 格式，取本地日历） */
export const TODAY: string = new Date().toISOString().slice(0, 10);

/** 月份编号 → 英文全称 */
export const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 月份编号 → 中文名 */
const MONTH_NAMES_ZH = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];

/** 根据 "YYYY-MM" 生成月份标签 */
export function monthLabel(monthKey: string): { zh: string; en: string; key: string; year: string } {
  if (monthKey === '未知') return { zh: '未归档', en: 'Unfiled', key: monthKey, year: '—' };
  const [y, m] = monthKey.split('-');
  const mi = parseInt(m, 10) - 1;
  return { zh: `${mi + 1} 月`, en: monthNames[mi], key: monthKey, year: y };
}
