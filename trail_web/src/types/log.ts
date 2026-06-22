/** 日志阶段 */
export type LogPhase = 'main' | 'maintenance';

/** 创建日志请求 */
export interface LogCreate {
  log_date: string;   // "YYYY-MM-DD"
  content: string;
  phase?: string;     // 默认 "main"
  hours?: number;     // M11：工时（小时），默认 1.0
  todo_ids?: number[];  // M12：关联待办 ID 列表
  task_ids?: number[];  // 关联任务 ID 列表
}

/** 更新日志请求（全部字段可选） */
export interface LogUpdate {
  content?: string;
  log_date?: string;
  phase?: string;
  hours?: number;     // M11：工时（小时）
  todo_ids?: number[];  // M12：关联待办 ID 列表（null = 不改，空数组 = 清空）
  task_ids?: number[];  // 关联任务 ID 列表（null = 不改，空数组 = 清空）
}

/** 日志输出（API 返回） */
export interface LogOut {
  id: number;
  task_id: number;
  log_date: string;
  phase: string;
  ordinal: number;
  content: string;
  polished_content: string | null;
  hours: number;      // M11：工时（小时）
  is_deleted: boolean;
  deleted_at: string | null;
  updated_at: string | null;
  edit_count: number;
  created_at: string | null;
  todo_ids: number[];  // M12：关联待办 ID 列表
  task_ids: number[];  // 关联任务 ID 列表
  attachment_ids: number[];  // 附件 ID 列表
}
