import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import { rsaEncrypt } from './crypto'

export interface LLMSettings {
  api_key_masked: string      // 遮蔽值（如 sk-****...****）
  api_key_encrypted: string   // RSA 加密后的完整值（请求解密端点获取明文）
  base_url: string
  model: string
  max_tokens: string
  min_tokens: string
  auth_type: 'bearer' | 'x-api-key'  // 认证方式：bearer（智谱、DeepSeek 等）或 x-api-key（Anthropic 原生）
  // Prompt 模板
  chat_system_prompt: string
  polish_system_prompt: string
  polish_todo_system_prompt: string
  polish_task_desc_system_prompt: string
  summarize_system_prompt: string
  summarize_maintenance_prompt: string
  ask_maintenance_prompt: string
  draft_log_system_prompt: string
  // 特别关注阈值
  watch_idle_hot_days: string
  watch_idle_warn_days: string
  watch_snooze_minutes: string
  watch_cron: string             // cron 表达式，默认工作日 9 点和 14 点
  // 待办事项超期预警
  todo_idle_warn_days: string
  todo_cron: string
  // 推送消息模板
  watch_alert_template: string
  todo_alert_template: string
  // 日报/周报模板
  daily_report_template: string
  weekly_report_template: string
  // 语音输入时长（秒）
  speech_duration: string
  // 工具调用最大迭代次数
  max_tool_iterations: string
}

/** LLM 设置保存请求（支持 API Key 加密传输） */
export interface LLMSettingsSaveRequest extends Partial<Omit<LLMSettings, 'api_key_masked' | 'api_key_encrypted'>> {
  /** 明文 API Key（将被加密传输） */
  api_key?: string
  /** RSA 加密后的 API Key（由 useSaveLLMSettings 自动生成） */
  api_key_encrypted?: string
}

export function useLLMSettings(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['settings', 'llm'],
    queryFn: () => api.get<LLMSettings>('/api/settings/llm'),
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  })
}

export function useSaveLLMSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (data: LLMSettingsSaveRequest) => {
      // 如果有明文 api_key，先加密
      if (data.api_key && data.api_key.trim()) {
        const encrypted = await rsaEncrypt(data.api_key.trim())
        data.api_key_encrypted = encrypted
        delete data.api_key
      }
      return api.put('/api/settings/llm', data)
    },
    onSuccess: (_, data: LLMSettingsSaveRequest) => {
      // 乐观更新：合并现有数据，避免不必要的 GET refetch
      qc.setQueryData(['settings', 'llm'], (old: LLMSettings | undefined) =>
        old ? { ...old, ...data } : data
      )
    },
  })
}

export const DEFAULT_WATCH_SETTINGS = {
  watch_idle_hot_days: 3,
  watch_idle_warn_days: 14,
  watch_snooze_minutes: 30,
  watch_cron: '0 9,14 * * 1-5',
  watch_alert_template: '**${task_title}** 特别关注预警：\n\n该任务已 **${idle_days} 天**未记录日志，请关注进展。',
}

export const DEFAULT_TODO_SETTINGS = {
  todo_idle_warn_days: 7,
  todo_cron: '0 9,14 * * 1-5',
  todo_alert_template: '**${task_title}** 待办事项超期提醒：\n\n你有一条关于 **${todo_title}** 的待办超期提醒：该待办已创建 **${idle_days} 天**，尚未完成，请关注进展。',
}

/** 特别关注阈值：从 LLM 设置中取，返回数字；未配置时回退到默认值。 */
export function useWatchSettings() {
  const { data } = useLLMSettings()
  return {
    hotDays: parseInt(data?.watch_idle_hot_days || '') || DEFAULT_WATCH_SETTINGS.watch_idle_hot_days,
    warnDays: parseInt(data?.watch_idle_warn_days || '') || DEFAULT_WATCH_SETTINGS.watch_idle_warn_days,
    snoozeMinutes: parseInt(data?.watch_snooze_minutes || '') || DEFAULT_WATCH_SETTINGS.watch_snooze_minutes,
  }
}

/** 卷首语（侧栏底部"凡录入者..."那两行） */
export function useMotto(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['settings', 'motto'],
    queryFn: async () => {
      const r = await api.get<{ motto: string }>('/api/settings/motto')
      return r.motto
    },
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  })
}

export function useSaveMotto() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (motto: string) => api.put('/api/settings/motto', { motto }),
    onSuccess: (_, motto) => {
      // 乐观更新：直接设置缓存，避免不必要的 GET refetch
      qc.setQueryData(['settings', 'motto'], motto)
    },
  })
}

// ============================================================
// 数据源配置（M3+）
// ============================================================

export interface DbSettings {
  backend: 'duckdb' | 'mysql'
  duckdb: {
    path: string
    absolute_path: string
  }
  mysql: {
    host: string
    port: number
    user: string
    password: string
    database: string
  }
  defaults: {
    duckdb_path: string
  }
}

export function useDbSettings() {
  return useQuery({
    queryKey: ['settings', 'db'],
    queryFn: () => api.get<DbSettings>('/api/settings/db'),
    staleTime: 60_000,
  })
}

export function useSaveDbSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { backend: string; duckdb?: { path: string }; mysql?: Record<string, unknown> }) =>
      api.put('/api/settings/db', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'db'] })
    },
  })
}

// ============================================================
// 数据目录（M8：Java + SQLite + 运行时切换）
// ============================================================

export interface DataDirStatus {
  /** 已配置时为绝对路径；未配置时为 null */
  dataDir: string | null
  configured: boolean
}

export function useDataDir(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['settings', 'data-dir'],
    queryFn: () => api.get<DataDirStatus>('/api/settings/data-dir'),
    // 配置状态变了要立刻感知（首屏遮罩依赖）
    staleTime: 0,
    refetchOnMount: 'always',
    enabled: options?.enabled ?? true,
  })
}

export function useSaveDataDir() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (dataDir: string) => api.put<{ ok: true; data_dir: string }>(
      '/api/settings/data-dir', { data_dir: dataDir }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'data-dir'] })
    },
  })
}

// ============================================================
// 占位提示语（任务描述 / 编年日志 / 补充说明）
// ============================================================

export const DEFAULT_PLACEHOLDERS = {
  task_desc: '把要做什么写清楚。先粗糙后润色。',
  log: '今日所记……',
  todo_note: '需要先申请测试 key、跨团队协调人 …',
}

export interface PlaceholderSettings {
  task_desc: string
  log: string
  todo_note: string
}

export function usePlaceholders(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['settings', 'placeholders'],
    queryFn: async () => {
      const r = await api.get<PlaceholderSettings>('/api/settings/placeholders')
      return {
        task_desc: r.task_desc || DEFAULT_PLACEHOLDERS.task_desc,
        log: r.log || DEFAULT_PLACEHOLDERS.log,
        todo_note: r.todo_note || DEFAULT_PLACEHOLDERS.todo_note,
      }
    },
    staleTime: 60_000,
    enabled: options?.enabled ?? true,
  })
}

export function useSavePlaceholders() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: PlaceholderSettings) => api.put('/api/settings/placeholders', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings', 'placeholders'] })
    },
  })
}
