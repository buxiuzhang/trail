/** 今天的日期（YYYY-MM-DD 格式，取本地日历） */
function getLocalToday(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
export const TODAY: string = getLocalToday();

/** 月份编号 → 英文全称 */
export const monthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** 根据 "YYYY-MM" 生成月份标签 */
export function monthLabel(monthKey: string): { zh: string; en: string; key: string; year: string } {
  if (monthKey === '未知') return { zh: '未归档', en: 'Unfiled', key: monthKey, year: '—' };
  const [y, m] = monthKey.split('-');
  const mi = parseInt(m, 10) - 1;
  return { zh: `${mi + 1} 月`, en: monthNames[mi], key: monthKey, year: y };
}
