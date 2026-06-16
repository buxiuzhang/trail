import { useState, useEffect } from 'react'
import {
  useLLMSettings, useSaveLLMSettings,
  useMotto, useSaveMotto,
  useDataDir, useSaveDataDir,
  usePlaceholders, useSavePlaceholders, DEFAULT_PLACEHOLDERS,
} from '@/api/settings'
import { rsaDecrypt } from '@/api/crypto'
import { useToastContext } from '@/context/ToastContext'
import { useSettingsContext } from '@/App'
import { Crumbs } from '@/components/shared/Crumbs'
import { DescriptionEditorWithMode, type EditorMode } from '@/components/shared/DescriptionEditorWithMode'
import { useConfirm } from '@/utils/confirm'
import styles from './SettingsPage.module.css'

// 默认 Prompt 模板
export const DEFAULT_POLISH_PROMPT =
  '你是中文文本润色助手。把用户给的工作日志原文化、书面化，保留原意和事实细节，不要添加用户没写过的信息，不要改日期和数字。用第一人称（我）。如果原文没有标点，末尾补全句号。只输出润色后的纯文本，不要任何解释、Markdown 包裹、前后缀。'

export const DEFAULT_POLISH_TODO_PROMPT =
  '你是中文文本润色助手。把用户给的待办事项补充说明润色为清晰、简洁的描述。保持原意，不要添加用户没写过的信息。可以适当调整语序、补充标点，使表达更流畅。如果是技术内容（接口、参数、步骤等），保持准确性。只输出润色后的纯文本，不要任何解释、Markdown 包裹、前后缀。'

export const DEFAULT_SUMMARIZE_PROMPT =
  '你是中文写作助手。基于用户提供的多条工作日志，提炼成一段 200-400 字的主体阶段总结。结构：开头一句总体目标；中间按时间或主题列关键动作；结尾一句结果或遗留。不要添加日志中不存在的事实。不要用 Markdown 标题，只输出连续段落。第一人称（我）。'

export const DEFAULT_SUMMARIZE_MAINTENANCE_PROMPT =
  '你是中文写作助手。基于维护期工作日志，写一段 150-300 字的维护情况总结。重点：偶发问题、调整内容、对外影响。不要堆砌每天做了什么。第一人称（我）。只输出连续段落，不用 Markdown。'

export const DEFAULT_ASK_MAINTENANCE_PROMPT =
  '你是任务收尾助手。根据用户给出的工作日志整体特征，判断（仅作为建议，最终由用户决定）：任务是否长期存在（还可能偶发出现）、是否需要后续小修小补。用 1-2 句中文回答。给出明确建议（\'建议进入维护期\' 或 \'建议直接关闭\'）并附一句理由。不要 Markdown 包裹。'

export const DEFAULT_CHAT_PROMPT =
  '你是 Trail 工作日志助教。你帮助用户回顾工作进展、整理任务状态、回答关于工作日志的问题。回答使用中文，简洁、有条理，用第二人称（你/您）。回答可以适当使用条目列表，但不要用 Markdown 标题（#）。'

export const DEFAULT_TOOLS_DESC = `你可以通过六个工具与 Trail 系统交互：

**渐进式披露（推荐流程）**
1. list_controllers() - 列出所有功能模块（Controller）
   - 不确定有哪些功能时先调用，了解系统全貌
   - 返回模块名称、描述、接口数量

2. list_endpoints(controller) - 列出指定模块的所有接口
   - 已确定模块后，查看具体有哪些操作
   - 参数：controller 为模块名称（如"工作日志"、"待办事项"）

3. get_api_docs(search?, path?) - 查询具体接口的参数详情
   - 已确定接口后，查看参数定义
   - path 参数获取接口详情，search 参数搜索接口

4. call_api(method, path, ...) - 执行 API 调用
   - GET 请求直接执行
   - POST/PUT 需要 confirmed=true 才能执行
   - 禁止执行 DELETE 请求

5. export_daily_report(date?) - 导出今日工作日报

6. export_weekly_report(start_date?, end_date?) - 导出本周工作周报

**推荐流程**
- 不熟悉系统：list_controllers → list_endpoints → get_api_docs → call_api
- 熟悉系统：直接用 get_api_docs 搜索或 call_api 执行

**时间相关查询**
- 用户说"今日工作"、"今天做了什么" → 直接调用 export_daily_report
- 用户说"本周工作"、"这周做了什么" → 直接调用 export_weekly_report

**错误处理**
- 工具调用失败时，最多重试 1 次
- 2 次失败后向用户说明情况，不要继续尝试

**重要原则**
- 用户看到的是标题，API 需要的是 ID，你负责转换
- 禁止编造接口或参数
- 写入操作必须用户确认`

export const DEFAULT_MOTTO = '凡录入者，皆为正典。\n凡未录者，皆为虚构。'

// 默认日报/周报模板
export const DEFAULT_DAILY_REPORT_TEMPLATE = `# 今日工作日报

## 工作内容
[按任务列出今日完成的工作]

## 明日计划
[待办事项或下一步计划]

## 备注
[需要说明的事项]`

export const DEFAULT_WEEKLY_REPORT_TEMPLATE = `# 本周工作周报

## 本周完成
[按任务列出本周完成的工作]

## 进行中
[正在进行的工作及进度]

## 下周计划
[下周重点工作安排]

## 备注
[需要说明的事项]`

export function SettingsPage() {
  const { showToast } = useToastContext()
  const settingsCtx = useSettingsContext()
  const activeSection = settingsCtx?.activeSection ?? 'interface'
  const confirm = useConfirm()

  // 按需加载：只有切换到对应 section 才请求数据
  const { data: settings, isLoading } = useLLMSettings({
    enabled: activeSection === 'llm',
  })
  const saveLLM = useSaveLLMSettings()

  const { data: motto } = useMotto({
    enabled: activeSection === 'interface',
  })
  const saveMotto = useSaveMotto()

  // M8：数据目录
  const { data: dataDir, isLoading: dirLoading } = useDataDir({
    enabled: activeSection === 'data',
  })
  const saveDir = useSaveDataDir()
  const [dirDraft, setDirDraft] = useState('')

  // LLM 表单
  const [apiKey, setApiKey] = useState('')
  const [apiKeyPlaceholder, setApiKeyPlaceholder] = useState('')  // 遮蔽值作为 placeholder
  const [apiKeyEncrypted, setApiKeyEncrypted] = useState('')      // 加密的完整值
  const [apiKeyDecrypted, setApiKeyDecrypted] = useState('')     // 解密后的明文（点击显示时）
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [authType, setAuthType] = useState<'bearer' | 'x-api-key'>('bearer')
  const [maxTokens, setMaxTokens] = useState('1000')
  const [minTokens, setMinTokens] = useState('100')
  const [showKey, setShowKey] = useState(false)
  const [isDecrypting, setIsDecrypting] = useState(false)

  // Prompt 模板
  const [chatPrompt, setChatPrompt] = useState('')
  const [polishPrompt, setPolishPrompt] = useState('')
  const [polishTodoPrompt, setPolishTodoPrompt] = useState('')
  const [summarizePrompt, setSummarizePrompt] = useState('')
  const [summarizeMaintenancePrompt, setSummarizeMaintenancePrompt] = useState('')
  const [askMaintenancePrompt, setAskMaintenancePrompt] = useState('')
  const [toolsDesc, setToolsDesc] = useState('')

  // Prompt 模板编辑器模式（默认源码模式）
  const [chatPromptMode, setChatPromptMode] = useState<EditorMode>('source')
  const [polishPromptMode, setPolishPromptMode] = useState<EditorMode>('source')
  const [polishTodoPromptMode, setPolishTodoPromptMode] = useState<EditorMode>('source')
  const [summarizePromptMode, setSummarizePromptMode] = useState<EditorMode>('source')
  const [summarizeMaintenancePromptMode, setSummarizeMaintenancePromptMode] = useState<EditorMode>('source')
  const [askMaintenancePromptMode, setAskMaintenancePromptMode] = useState<EditorMode>('source')
  const [toolsDescMode, setToolsDescMode] = useState<EditorMode>('source')

  // 日报/周报模板
  const [dailyReportTemplate, setDailyReportTemplate] = useState('')
  const [weeklyReportTemplate, setWeeklyReportTemplate] = useState('')

  // 日报/周报模板编辑器模式
  const [dailyReportTemplateMode, setDailyReportTemplateMode] = useState<EditorMode>('source')
  const [weeklyReportTemplateMode, setWeeklyReportTemplateMode] = useState<EditorMode>('source')

  // 语音输入时长
  const [speechDuration, setSpeechDuration] = useState('10')

  // 其他设置
  const [mottoDraft, setMottoDraft] = useState('')
  const [taskDescDraft, setTaskDescDraft] = useState('')
  const [logDraft, setLogDraft] = useState('')
  const [todoNoteDraft, setTodoNoteDraft] = useState('')

  const { data: placeholders, isLoading: placeholdersLoading } = usePlaceholders({
    enabled: activeSection === 'placeholders',
  })
  const savePlaceholders = useSavePlaceholders()

  useEffect(() => {
    if (settings) {
      // API Key 返回遮蔽值，作为 placeholder 显示
      setApiKeyPlaceholder(settings.api_key_masked || '')
      setApiKeyEncrypted(settings.api_key_encrypted || '')
      setApiKeyDecrypted('')  // 重置解密值
      setApiKey('')  // 输入框初始为空，用户需要输入新的 API Key
      setBaseUrl(settings.base_url || '')
      setModel(settings.model || '')
      setAuthType((settings.auth_type as 'bearer' | 'x-api-key') || 'bearer')
      setMaxTokens(settings.max_tokens || '1000')
      setMinTokens(settings.min_tokens || '100')
      // Prompt 模板
      setChatPrompt(settings.chat_system_prompt || '')
      setPolishPrompt(settings.polish_system_prompt || '')
      setPolishTodoPrompt(settings.polish_todo_system_prompt || '')
      setSummarizePrompt(settings.summarize_system_prompt || '')
      setSummarizeMaintenancePrompt(settings.summarize_maintenance_prompt || '')
      setAskMaintenancePrompt(settings.ask_maintenance_prompt || '')
      setToolsDesc(settings.tools_desc || '')
      // 日报/周报模板
      setDailyReportTemplate(settings.daily_report_template || '')
      setWeeklyReportTemplate(settings.weekly_report_template || '')
      // 语音输入时长
      setSpeechDuration(settings.speech_duration || '10')
    }
  }, [settings])

  useEffect(() => {
    if (motto !== undefined) setMottoDraft(motto || '')
  }, [motto])

  useEffect(() => {
    if (placeholders) {
      setTaskDescDraft(placeholders.task_desc || DEFAULT_PLACEHOLDERS.task_desc)
      setLogDraft(placeholders.log || DEFAULT_PLACEHOLDERS.log)
      setTodoNoteDraft(placeholders.todo_note || DEFAULT_PLACEHOLDERS.todo_note)
    } else if (!placeholdersLoading) {
      // API 返回空或未实现时,用默认值填充
      setTaskDescDraft(DEFAULT_PLACEHOLDERS.task_desc)
      setLogDraft(DEFAULT_PLACEHOLDERS.log)
      setTodoNoteDraft(DEFAULT_PLACEHOLDERS.todo_note)
    }
  }, [placeholders, placeholdersLoading])

  // M8：dataDir 拉回后填入草稿
  useEffect(() => {
    if (dataDir?.dataDir) setDirDraft(dataDir.dataDir)
  }, [dataDir])

  async function handleSaveLLM(e: React.SyntheticEvent) {
    e.preventDefault()

    // 二次确认
    const ok = await confirm({
      level: 'moderate',
      title: '保存 LLM 设置？',
      body: <p>将保存 API Key、Base URL、模型配置及所有 Prompt 模板。</p>,
      confirmLabel: '保存',
    })
    if (!ok) return

    // API Key 可以为空（用户不修改时）
    try {
      await saveLLM.mutateAsync({
        // 只有用户输入了新的 API Key 才传递
        ...(apiKey.trim() ? { api_key: apiKey.trim() } : {}),
        base_url: baseUrl.trim(),
        model: model.trim(),
        auth_type: authType,
        max_tokens: maxTokens.trim(),
        min_tokens: minTokens.trim(),
        // Prompt 模板
        chat_system_prompt: chatPrompt.trim(),
        polish_system_prompt: polishPrompt.trim(),
        polish_todo_system_prompt: polishTodoPrompt.trim(),
        summarize_system_prompt: summarizePrompt.trim(),
        summarize_maintenance_prompt: summarizeMaintenancePrompt.trim(),
        ask_maintenance_prompt: askMaintenancePrompt.trim(),
        tools_desc: toolsDesc.trim(),
        // 日报/周报模板
        daily_report_template: dailyReportTemplate.trim(),
        weekly_report_template: weeklyReportTemplate.trim(),
        // 语音输入时长
        speech_duration: speechDuration.trim(),
      })
      showToast('已保存')
    } catch (err: any) {
      showToast('保存失败：' + err.message)
    }
  }

  // 解密并显示完整 API Key
  async function handleShowApiKey() {
    if (!apiKeyEncrypted) {
      showToast('无 API Key')
      return
    }

    setIsDecrypting(true)
    try {
      const decrypted = await rsaDecrypt(apiKeyEncrypted)
      setApiKeyDecrypted(decrypted)
      setShowKey(true)
    } catch (err: any) {
      showToast('解密失败：' + err.message)
    } finally {
      setIsDecrypting(false)
    }
  }

  // 保存界面偏好（卷首语 + 语音时长）
  async function handleSaveInterface() {
    // 防止重复调用
    if (saveMotto.isPending || saveLLM.isPending) return

    // 二次确认
    const ok = await confirm({
      level: 'moderate',
      title: '保存界面偏好？',
      body: <p>将保存卷首语和语音输入时长设置。</p>,
      confirmLabel: '保存',
    })
    if (!ok) return

    try {
      // 保存卷首语
      await saveMotto.mutateAsync(mottoDraft.trim())
      // 保存语音时长
      await saveLLM.mutateAsync({
        speech_duration: speechDuration.trim(),
      })
      showToast('已保存')
    } catch (err: any) {
      showToast('保存失败：' + err.message)
    }
  }

  async function handleSavePlaceholders() {
    // 二次确认
    const ok = await confirm({
      level: 'moderate',
      title: '保存占位提示语？',
      body: <p>将保存任务描述、编年日志、补充说明的占位提示。</p>,
      confirmLabel: '保存',
    })
    if (!ok) return

    try {
      await savePlaceholders.mutateAsync({
        task_desc: taskDescDraft.trim() || DEFAULT_PLACEHOLDERS.task_desc,
        log: logDraft.trim() || DEFAULT_PLACEHOLDERS.log,
        todo_note: todoNoteDraft.trim() || DEFAULT_PLACEHOLDERS.todo_note,
      })
      showToast('占位提示语已更新')
    } catch (err: any) {
      showToast('保存失败：' + err.message)
    }
  }

  async function handleSaveDir(e: React.SyntheticEvent) {
    e.preventDefault()
    const path = dirDraft.trim()
    if (!path) { showToast('路径不能为空'); return }
    if (!path.startsWith('/') && !/^[a-zA-Z]:[\\\/]/.test(path)) {
      showToast('请输入绝对路径'); return
    }

    // 二次确认
    const ok = await confirm({
      level: 'critical',
      title: '切换数据目录？',
      body: (
        <div>
          <p>新目录：<em style={{ fontFamily: 'var(--mono)' }}>{path}</em></p>
          <p>后端将关闭旧连接、在新目录建库并初始化子目录。</p>
          <p style={{ color: 'var(--oxblood)', fontWeight: 500 }}>
            此操作立即生效，页面将自动刷新。
          </p>
        </div>
      ),
      confirmLabel: '确认切换',
    })
    if (!ok) return

    try {
      await saveDir.mutateAsync(path)
      showToast('数据目录已切换')
      // 后端连接已重建，前端缓存全部失效，强制刷新
      setTimeout(() => window.location.reload(), 600)
    } catch (err: any) {
      showToast('切换失败：' + err.message)
    }
  }

  return (
    <article className={styles.page}>
      <Crumbs items={[{ label: '编年档', href: '/' }, { label: '设置' }]} />

      <header className={styles.header}>
        <h1 className={styles.title}>设置</h1>
        <span className={styles.sub}>偏好与配置</span>
      </header>

      {/* 数据目录 */}
      {activeSection === 'data' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>数据目录</h2>
          <p className={styles.sectionHint}>
            SQLite 主库、密钥、导出、附件、运行日志都保存在这个目录下（系统自动分子目录）。
            {!dataDir?.configured && ' 系统已为你准备了默认目录，点击按钮确认后开始初始化。'}
          </p>
        {dirLoading ? (
          <p className={styles.sectionHint}>载入中...</p>
        ) : (
          <form onSubmit={handleSaveDir}>
            <div className="field">
              <div className="field__label">
                <span>目录绝对路径</span>
                <span className="field__hint">{dataDir?.configured ? '已配置' : '待确认'}</span>
              </div>
              <input
                className="field__input"
                value={dirDraft}
                onChange={e => setDirDraft(e.target.value)}
                placeholder="/Users/you/Documents/trail-data"
                style={{ fontFamily: 'var(--mono)', fontSize: '13.5px' }}
                required
              />
              <p className={styles.fieldHint}>
                {dataDir?.configured
                  ? '必须是绝对路径。保存即切换：后端关旧连接、在新目录建库并跑建表、初始化子目录。'
                  : '确认后系统将在该目录创建 db/、exports/、attachments/、logs/ 及 .secret_key 等文件。'}
              </p>
            </div>

            {dataDir?.configured && dataDir.dataDir && (
              <div className={styles.statusLine}>
                <span>当前目录 <span className={`${styles.statusValue} ${styles.statusMono}`}>{dataDir.dataDir}</span></span>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
              <span style={{ fontFamily: 'var(--mono)', fontSize: '10.5px', color: 'var(--ink-faded)', letterSpacing: '0.06em', flex: 1, alignSelf: 'center' }}>
                — {dataDir?.configured ? '即时生效 · 配置写入 ~/.trail/config.yaml —' : '确认即初始化 · 配置写入 ~/.trail/config.yaml —'}
              </span>
              <button type="submit" className="btn btn--primary" disabled={saveDir.isPending || !dirDraft.trim()}>
                {saveDir.isPending ? '处理中...' : dataDir?.configured ? '保存并切换' : '确认并初始化'}
              </button>
            </div>
          </form>
        )}
      </section>
      )}

      {/* 大模型配置 */}
      {activeSection === 'llm' && (
        <>
        {/* 卡片 1：连接配置 */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>大模型</h2>
          {isLoading ? (
            <p className={styles.sectionHint}>载入中...</p>
          ) : (
            <form onSubmit={handleSaveLLM}>
            <div className="field">
              <div className="field__label">
                <span>API Key</span>
                <span className="field__hint">加密保存</span>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="field__input"
                  type={showKey ? 'text' : 'password'}
                  value={showKey && apiKeyDecrypted ? apiKeyDecrypted : apiKey}
                  onChange={e => {
                    setApiKey(e.target.value)
                    setApiKeyDecrypted('')  // 用户输入时清除解密值
                  }}
                  placeholder={apiKeyPlaceholder || 'sk-...'}
                  style={{ flex: 1 }}
                  disabled={!!(showKey && apiKeyDecrypted)}
                />
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  onClick={() => {
                    if (showKey) {
                      setShowKey(false)
                      setApiKeyDecrypted('')
                    } else {
                      handleShowApiKey()
                    }
                  }}
                  disabled={isDecrypting}
                >
                  {isDecrypting ? '解密中...' : showKey ? '隐藏' : '显示'}
                </button>
              </div>
              <p className={styles.fieldHint}>
                {apiKeyPlaceholder
                  ? `当前：${apiKeyPlaceholder}。输入新值将替换，留空则保持不变。点击"显示"可查看完整值。`
                  : '输入您的 LLM API Key，将加密传输并存储。'}
              </p>
            </div>

            <div className="field">
              <div className="field__label"><span>Base URL</span></div>
              <input
                className="field__input"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="https://api.minimaxi.com/anthropic"
              />
            </div>

            <div className="field">
              <div className="field__label">
                <span>认证方式</span>
                <span className="field__hint">{authType === 'bearer' ? 'Authorization: Bearer' : 'x-api-key header'}</span>
              </div>
              <select
                className="field__input"
                value={authType}
                onChange={e => setAuthType(e.target.value as 'bearer' | 'x-api-key')}
                style={{ cursor: 'pointer' }}
              >
                <option value="bearer">Bearer（智谱、DeepSeek、MiniMax 等）</option>
                <option value="x-api-key">x-api-key（Anthropic 原生）</option>
              </select>
              <p className={styles.fieldHint}>
                {authType === 'bearer'
                  ? '使用 Authorization: Bearer &lt;key&gt; 认证，适用于大多数第三方 API'
                  : '使用 x-api-key: &lt;key&gt; 认证，适用于 Anthropic 官方 API'}
              </p>
            </div>

            <div className="field-row">
              <div className="field">
                <div className="field__label"><span>模型</span></div>
                <input
                  className="field__input"
                  value={model}
                  onChange={e => setModel(e.target.value)}
                  placeholder="glm-5"
                />
              </div>
            </div>

            <div className="field-row">
              <div className="field">
                <div className="field__label"><span>Max Tokens</span><span className="field__hint">输出上限</span></div>
                <input
                  className="field__input"
                  type="number"
                  min="1"
                  step="1"
                  value={maxTokens}
                  onChange={e => setMaxTokens(e.target.value.replace(/\D/g, ''))}
                  placeholder="1000"
                />
              </div>
              <div className="field">
                <div className="field__label"><span>Min Tokens</span><span className="field__hint">输出下限，0=不限制</span></div>
                <input
                  className="field__input"
                  type="number"
                  min="0"
                  step="1"
                  value={minTokens}
                  onChange={e => setMinTokens(e.target.value.replace(/\D/g, ''))}
                  placeholder="100"
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="submit" className="btn btn--primary" disabled={saveLLM.isPending}>
                {saveLLM.isPending ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </section>

      {/* 卡片 2：Prompt 模板 */}
      <section className={styles.section}>
        <h2 className={styles.sectionTitle}>Prompt 模板</h2>
        <p className={styles.sectionHint}>自定义各场景的 AI 提示词，留空则使用默认值。</p>
        {isLoading ? (
          <p className={styles.sectionHint}>载入中...</p>
        ) : (
          <form onSubmit={handleSaveLLM}>
            {/* 润色提示词 */}
            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  待办润色提示词
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置待办润色提示词？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setPolishTodoPrompt(DEFAULT_POLISH_TODO_PROMPT)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setPolishTodoPromptMode(polishTodoPromptMode === 'source' ? 'preview' : 'source')}
                >
                  {polishTodoPromptMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>润色待办事项的补充说明，使其更清晰简洁</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={polishTodoPrompt || DEFAULT_POLISH_TODO_PROMPT}
                  onChange={setPolishTodoPrompt}
                  mode={polishTodoPromptMode}
                  onModeChange={setPolishTodoPromptMode}
                  minHeight={150}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            {/* 润色提示词 */}
            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  润色提示词
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置润色提示词？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setPolishPrompt(DEFAULT_POLISH_PROMPT)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setPolishPromptMode(polishPromptMode === 'source' ? 'preview' : 'source')}
                >
                  {polishPromptMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>润色工作日志，使其书面化、正式化</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={polishPrompt || DEFAULT_POLISH_PROMPT}
                  onChange={setPolishPrompt}
                  mode={polishPromptMode}
                  onModeChange={setPolishPromptMode}
                  minHeight={150}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            {/* 总结提示词 */}
            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  总结提示词
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置总结提示词？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setSummarizePrompt(DEFAULT_SUMMARIZE_PROMPT)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setSummarizePromptMode(summarizePromptMode === 'source' ? 'preview' : 'source')}
                >
                  {summarizePromptMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>主体阶段结束时，基于日志提炼总结</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={summarizePrompt || DEFAULT_SUMMARIZE_PROMPT}
                  onChange={setSummarizePrompt}
                  mode={summarizePromptMode}
                  onModeChange={setSummarizePromptMode}
                  minHeight={150}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            {/* 维护期总结提示词 */}
            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  维护期总结提示词
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置维护期总结提示词？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setSummarizeMaintenancePrompt(DEFAULT_SUMMARIZE_MAINTENANCE_PROMPT)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setSummarizeMaintenancePromptMode(summarizeMaintenancePromptMode === 'source' ? 'preview' : 'source')}
                >
                  {summarizeMaintenancePromptMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>维护阶段结束时的总结，侧重偶发问题和对外影响</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={summarizeMaintenancePrompt || DEFAULT_SUMMARIZE_MAINTENANCE_PROMPT}
                  onChange={setSummarizeMaintenancePrompt}
                  mode={summarizeMaintenancePromptMode}
                  onModeChange={setSummarizeMaintenancePromptMode}
                  minHeight={150}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            {/* 维护建议提示词 */}
            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  维护建议提示词
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置维护建议提示词？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setAskMaintenancePrompt(DEFAULT_ASK_MAINTENANCE_PROMPT)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setAskMaintenancePromptMode(askMaintenancePromptMode === 'source' ? 'preview' : 'source')}
                >
                  {askMaintenancePromptMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>判断任务是否应进入维护期或直接关闭</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={askMaintenancePrompt || DEFAULT_ASK_MAINTENANCE_PROMPT}
                  onChange={setAskMaintenancePrompt}
                  mode={askMaintenancePromptMode}
                  onModeChange={setAskMaintenancePromptMode}
                  minHeight={150}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            {/* 对话提示词 */}
            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  对话提示词
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置对话提示词？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setChatPrompt(DEFAULT_CHAT_PROMPT)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setChatPromptMode(chatPromptMode === 'source' ? 'preview' : 'source')}
                >
                  {chatPromptMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>聊天窗口的系统提示，定义 AI 的角色和行为</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={chatPrompt || DEFAULT_CHAT_PROMPT}
                  onChange={setChatPrompt}
                  mode={chatPromptMode}
                  onModeChange={setChatPromptMode}
                  minHeight={120}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            {/* 工具说明 */}
            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  工具说明
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置工具说明？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setToolsDesc(DEFAULT_TOOLS_DESC)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setToolsDescMode(toolsDescMode === 'source' ? 'preview' : 'source')}
                >
                  {toolsDescMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>告诉 LLM 有哪些工具可用及如何使用</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={toolsDesc || DEFAULT_TOOLS_DESC}
                  onChange={setToolsDesc}
                  mode={toolsDescMode}
                  onModeChange={setToolsDescMode}
                  minHeight={200}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            {/* 日报/周报模板 */}
            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  今日工作模板
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置今日工作模板？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setDailyReportTemplate(DEFAULT_DAILY_REPORT_TEMPLATE)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setDailyReportTemplateMode(dailyReportTemplateMode === 'source' ? 'preview' : 'source')}
                >
                  {dailyReportTemplateMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>聊天说「导出今日工作」时使用</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={dailyReportTemplate || DEFAULT_DAILY_REPORT_TEMPLATE}
                  onChange={setDailyReportTemplate}
                  mode={dailyReportTemplateMode}
                  onModeChange={setDailyReportTemplateMode}
                  minHeight={180}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            <div className={styles.promptField}>
              <div className={styles.promptLabel}>
                <span className={styles.promptName}>
                  本周工作模板
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = await confirm({
                        level: 'moderate',
                        title: '重置本周工作模板？',
                        body: <p>将恢复为系统默认值，您的自定义内容将被覆盖。</p>,
                        confirmLabel: '重置',
                      })
                      if (ok) setWeeklyReportTemplate(DEFAULT_WEEKLY_REPORT_TEMPLATE)
                    }}
                    className={styles.resetBtn}
                  >
                    重置
                  </button>
                </span>
                <button
                  type="button"
                  className={styles.modeToggle}
                  onClick={() => setWeeklyReportTemplateMode(weeklyReportTemplateMode === 'source' ? 'preview' : 'source')}
                >
                  {weeklyReportTemplateMode === 'source' ? '预览模式' : '源码模式'}
                </button>
              </div>
              <p className={styles.promptDesc}>聊天说「导出本周工作」时使用</p>
              <div style={{ marginTop: '8px' }}>
                <DescriptionEditorWithMode
                  value={weeklyReportTemplate || DEFAULT_WEEKLY_REPORT_TEMPLATE}
                  onChange={setWeeklyReportTemplate}
                  mode={weeklyReportTemplateMode}
                  onModeChange={setWeeklyReportTemplateMode}
                  minHeight={180}
                  textareaClassName="field__textarea"
                  hideInlineToggle
                />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button type="submit" className="btn btn--primary" disabled={saveLLM.isPending}>
                {saveLLM.isPending ? '保存中...' : '保存'}
              </button>
            </div>
          </form>
        )}
      </section>
      </>
      )}

      {/* 界面偏好 */}
      {activeSection === 'interface' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>界面偏好</h2>
          <p className={styles.sectionHint}>自定义界面风格和行为。</p>

          {/* 卷首语 */}
          <div className="field">
          <div className="field__label">
            <span>卷首语</span>
            <span className="field__hint">显示在侧栏底部</span>
          </div>
          <textarea
            className="field__textarea"
            value={mottoDraft}
            onChange={e => setMottoDraft(e.target.value)}
            placeholder={DEFAULT_MOTTO}
            rows={3}
            style={{ fontSize: '13px', lineHeight: 1.6 }}
          />
        </div>

        {/* 语音输入时长 */}
        <div className="field">
          <div className="field__label">
            <span>语音输入时长</span>
            <span className="field__hint">{speechDuration} 秒</span>
          </div>
          <input
            type="range"
            min="5"
            max="60"
            value={speechDuration}
            onChange={e => setSpeechDuration(e.target.value)}
            className={styles.slider}
          />
          <p className={styles.fieldHint}>
            聊天窗口语音输入的最大时长，拖动调整。
          </p>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={async () => {
              const ok = await confirm({
                level: 'dangerous',
                title: '恢复所有默认值？',
                body: <p>卷首语和语音时长将全部恢复为默认值。</p>,
                confirmLabel: '恢复默认',
              })
              if (ok) {
                setMottoDraft('')
                setSpeechDuration('10')
              }
            }}
            title="恢复默认"
          >
            恢复默认
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={handleSaveInterface}
            disabled={saveMotto.isPending || saveLLM.isPending}
          >
            {(saveMotto.isPending || saveLLM.isPending) ? '保存中...' : '保存'}
          </button>
        </div>
      </section>
      )}

      {/* 占位提示语 */}
      {activeSection === 'placeholders' && (
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>占位提示语</h2>
          <p className={styles.sectionHint}>编辑器输入框为空时显示的灰色提示文字。</p>
          {placeholdersLoading ? (
            <p className={styles.sectionHint}>载入中...</p>
          ) : (
            <>
            <div className="field">
              <div className="field__label">
                <span>任务描述</span>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      level: 'moderate',
                      title: '重置任务描述提示语？',
                      body: <p>将恢复为系统默认值。</p>,
                      confirmLabel: '重置',
                    })
                    if (ok) setTaskDescDraft(DEFAULT_PLACEHOLDERS.task_desc)
                  }}
                  title="恢复为默认"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 0, fontFamily: 'inherit', fontSize: 'inherit',
                    letterSpacing: 'inherit', textTransform: 'inherit',
                    color: 'var(--ink-ghost)',
                  }}
                >
                  重置 ↺
                </button>
              </div>
              <textarea
                className="field__textarea"
                value={taskDescDraft}
                onChange={e => setTaskDescDraft(e.target.value)}
                rows={2}
                style={{ fontSize: '13px', lineHeight: 1.6 }}
              />
            </div>
            <div className="field">
              <div className="field__label">
                <span>编年日志</span>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      level: 'moderate',
                      title: '重置编年日志提示语？',
                      body: <p>将恢复为系统默认值。</p>,
                      confirmLabel: '重置',
                    })
                    if (ok) setLogDraft(DEFAULT_PLACEHOLDERS.log)
                  }}
                  title="恢复为默认"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 0, fontFamily: 'inherit', fontSize: 'inherit',
                    letterSpacing: 'inherit', textTransform: 'inherit',
                    color: 'var(--ink-ghost)',
                  }}
                >
                  重置 ↺
                </button>
              </div>
              <textarea
                className="field__textarea"
                value={logDraft}
                onChange={e => setLogDraft(e.target.value)}
                rows={2}
                style={{ fontSize: '13px', lineHeight: 1.6 }}
              />
            </div>
            <div className="field">
              <div className="field__label">
                <span>补充说明</span>
                <button
                  type="button"
                  onClick={async () => {
                    const ok = await confirm({
                      level: 'moderate',
                      title: '重置补充说明提示语？',
                      body: <p>将恢复为系统默认值。</p>,
                      confirmLabel: '重置',
                    })
                    if (ok) setTodoNoteDraft(DEFAULT_PLACEHOLDERS.todo_note)
                  }}
                  title="恢复为默认"
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    padding: 0, fontFamily: 'inherit', fontSize: 'inherit',
                    letterSpacing: 'inherit', textTransform: 'inherit',
                    color: 'var(--ink-ghost)',
                  }}
                >
                  重置 ↺
                </button>
              </div>
              <textarea
                className="field__textarea"
                value={todoNoteDraft}
                onChange={e => setTodoNoteDraft(e.target.value)}
                rows={2}
                style={{ fontSize: '13px', lineHeight: 1.6 }}
              />
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16, gap: 8 }}>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={async () => {
                  const ok = await confirm({
                    level: 'dangerous',
                    title: '重置所有占位提示语？',
                    body: <p>任务描述、编年日志、补充说明的提示语将全部恢复为默认值。</p>,
                    confirmLabel: '全部重置',
                  })
                  if (ok) {
                    setTaskDescDraft(DEFAULT_PLACEHOLDERS.task_desc)
                    setLogDraft(DEFAULT_PLACEHOLDERS.log)
                    setTodoNoteDraft(DEFAULT_PLACEHOLDERS.todo_note)
                  }
                }}
              >
                全部重置
              </button>
              <button
                type="button"
                className="btn btn--primary"
                onClick={handleSavePlaceholders}
                disabled={savePlaceholders.isPending}
              >
                {savePlaceholders.isPending ? '保存中...' : '保存'}
              </button>
            </div>
          </>
        )}
      </section>
      )}
    </article>
  )
}
