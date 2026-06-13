/** 对接渠道类型 */
export const CHANNEL_KINDS = [
  { v: 'group',  zh: '对接群' },
  { v: 'person', zh: '对接人' },
  { v: 'email',  zh: '邮箱' },
  { v: 'phone',  zh: '电话' },
  { v: 'other',  zh: '其他' },
] as const;

/** 对接渠道平台 */
export const CHANNEL_PLATFORMS = [
  { v: 'dingtalk', zh: '钉钉' },
  { v: 'wechat',   zh: '微信' },
  { v: 'elink',    zh: 'elink' },
  { v: 'lark',     zh: 'lark' },
  { v: 'feishu',   zh: '飞书' },
  { v: 'email',    zh: '邮箱' },
  { v: 'phone',    zh: '电话' },
  { v: 'other',    zh: '其他' },
] as const;

/** kind 值 → 中文标签 */
export const KIND_LABELS: Record<string, string> = Object.fromEntries(
  CHANNEL_KINDS.map(k => [k.v, k.zh])
);

/** platform 值 → 中文标签 */
export const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  CHANNEL_PLATFORMS.map(p => [p.v, p.zh])
);

/** 平台颜色编码（对应 CSS 变量） */
export const PLATFORM_COLORS: Record<string, string> = {
  dingtalk: 'var(--dingtalk-blue)',
  wechat:   'var(--wechat-green)',
  elink:    'var(--elink-gray)',
  lark:     'var(--lark-teal)',
  feishu:   'var(--feishu-blue)',
  email:    'var(--email-ink)',
  phone:    'var(--phone-ink)',
  other:    'var(--ink-ghost)',
};
