import type { ContactIn, ContactOut } from './contact';

/** 任务状态：未开始 / 进行中 / 已完成 / 已作废 */
export type TaskStatus = '未开始' | '进行中' | '已完成' | '已作废';

/** 任务性质：长期 / 临时 / 维护 */
export type TaskNature = '长期' | '临时' | '维护';

/** 创建任务请求 */
export interface TaskCreate {
  title: string;
  alias?: string;
  description?: string;
  start_date?: string;        // "YYYY-MM-DD"
  processing_date?: string;   // "YYYY-MM-DD"
  nature?: string;
  status?: string;
  tags?: string[];
  contacts?: ContactIn[];
}

/** 更新任务请求（全部字段可选） */
export interface TaskUpdate {
  title?: string;
  alias?: string;
  description?: string;
  start_date?: string;
  processing_date?: string;
  end_date?: string;
  nature?: string;
  summary?: string;
  maintenance_summary?: string;
  tags?: string[];
  contacts?: ContactIn[];
  /** 编辑表单可一并改状态（走后端状态机校验） */
  status?: TaskStatus;
}

/** 状态变更请求 */
export interface StatusChange {
  new_status: string;
  end_date?: string;
  summary?: string;
  maintenance?: boolean;
}

/** 任务输出（API 返回） */
export interface TaskOut {
  id: number;
  title: string;
  alias: string | null;
  description: string | null;
  start_date: string | null;
  processing_date: string | null;
  end_date: string | null;
  status: string;
  nature: string;
  summary: string | null;
  maintenance_summary: string | null;
  tags: string[];
  original_title: string | null;
  source: string;
  pinned_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  last_log_date: string | null;  // 派生：未软删日志 max(log_date)
  // 6 聚合字段（store 层 LEFT JOIN + SUM 派生，避免 N+1）
  // 后端 Jackson 全局 SNAKE_CASE → 前端历来用 snake_case 接收
  todo_active_count: number;
  todo_completed_count: number;
  todo_abandoned_count: number;
  log_count: number;          // 未软删 work_logs 总数
  log_main_count: number;     // 未软删且 phase='main' 的 work_logs 数
  total_hours: number;        // 未软删 work_logs 的 hours 总和
  contacts: ContactOut[];
}

/** 分页响应包装（与后端 PagedResponse 对齐） */
export interface PagedResponse<T> {
  items: T[];
  total: number;
}
