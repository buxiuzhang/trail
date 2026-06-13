/** 对接渠道输入（创建/更新任务时使用） */
export interface ContactIn {
  kind: string;   // group / person / email / phone / other
  channel: string; // dingtalk / wechat / elink / lark / feishu / email / phone / other
  name: string;
  target?: string;
  note?: string;
}

/** 对接渠道输出（API 返回） */
export interface ContactOut {
  id: number;
  task_id: number;
  kind: string;
  channel: string;
  name: string;
  target: string | null;
  note: string | null;
  created_at: string | null;
}
