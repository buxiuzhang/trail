/** 总览统计（API 返回） */
export interface OverviewOut {
  total_tasks: number;
  by_status: Record<string, number>;
  by_nature: Record<string, number>;
  by_tag: Record<string, number>;
  by_month: Record<string, number>;
  total_logs: number;
  todo_active_count?: number;
  todo_completed_count?: number;
}

/** 闲置任务（API 返回） */
export interface StaleOut {
  id: number;
  title: string;
  status: string;
  nature: string;
  last_log_date: string | null;
  days_idle: number | null;
}
