/** 待办输出（API 返回） */
export interface TodoOut {
  id: number;
  task_id: number;
  title: string;
  description: string | null;
  is_completed: boolean;
  is_abandoned: boolean;
  created_at: string | null;
  updated_at: string | null;
}

/** 新建待办请求 */
export interface TodoCreate {
  title: string;
  description?: string;
}

/** 更新待办请求（全部字段可选） */
export interface TodoUpdate {
  title?: string;
  description?: string;
}
