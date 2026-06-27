import { useState, useRef } from 'react'
import {
  useMcpServers, useCreateMcpServer, useUpdateMcpServer,
  useDeleteMcpServer, useTestMcpServer,
  type McpServer, type McpServerSaveRequest,
} from '@/api/mcp'
import { useConfirm } from '@/utils/confirm'
import { useToastContext } from '@/context/ToastContext'
import CloseCircleIcon from '@/icons/close-circle.svg'
import EditIcon from '@/icons/edit.svg'
import TestIcon from '@/icons/test.svg'
import DeleteIcon from '@/icons/delete.svg'
import styles from './McpSection.module.css'

interface FormState {
  name: string
  type: 'stdio' | 'sse'
  command: string
  args: string
  env: string
  url: string
  headers: string
}

const EMPTY_FORM: FormState = {
  name: '', type: 'stdio', command: '', args: '', env: '', url: '', headers: '',
}

function serverToForm(s: McpServer): FormState {
  return {
    name: s.name,
    type: s.type,
    command: s.command ?? '',
    args: s.args ?? '',
    env: s.env ?? '',
    url: s.url ?? '',
    headers: s.headers ?? '',
  }
}

export function McpSection() {
  const { data: servers = [], isLoading } = useMcpServers()
  const createServer = useCreateMcpServer()
  const updateServer = useUpdateMcpServer()
  const deleteServer = useDeleteMcpServer()
  const testServer = useTestMcpServer()
  const confirm = useConfirm()
  const { showToast } = useToastContext()

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; tools?: { name: string; description: string }[]; error?: string }>>({})
  const [testingId, setTestingId] = useState<string | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  function scrollToForm() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    })
  }

  function openCreate() {
    setEditingId(null)
    setForm(EMPTY_FORM)
    setShowForm(true)
    scrollToForm()
  }

  function openEdit(server: McpServer) {
    setEditingId(server.id)
    setForm(serverToForm(server))
    setShowForm(true)
    scrollToForm()
  }

  function closeForm() {
    setShowForm(false)
    setEditingId(null)
    setForm(EMPTY_FORM)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const payload: McpServerSaveRequest = {
      name: form.name,
      type: form.type,
      command: form.type === 'stdio' ? form.command : undefined,
      args: form.type === 'stdio' && form.args ? form.args : undefined,
      env: form.type === 'stdio' && form.env ? form.env : undefined,
      url: form.type === 'sse' ? form.url : undefined,
      headers: form.type === 'sse' && form.headers ? form.headers : undefined,
    }
    try {
      if (editingId) {
        await updateServer.mutateAsync({ id: editingId, ...payload })
        showToast('MCP Server 已更新')
      } else {
        await createServer.mutateAsync(payload)
        showToast('MCP Server 已添加')
      }
      closeForm()
    } catch (err: unknown) {
      showToast((err as Error).message ?? '保存失败')
    }
  }

  async function handleDelete(server: McpServer) {
    const ok = await confirm({
      level: 'dangerous',
      title: `删除「${server.name}」？`,
      body: <p>此操作不可撤销，MCP Server 配置将被永久删除。</p>,
      confirmLabel: '删除',
    })
    if (!ok) return
    try {
      await deleteServer.mutateAsync(server.id)
      showToast('已删除')
    } catch (err: unknown) {
      showToast((err as Error).message ?? '删除失败')
    }
  }

  async function handleToggle(server: McpServer) {
    try {
      await updateServer.mutateAsync({ id: server.id, name: server.name, type: server.type, enabled: server.enabled ? 0 : 1 })
    } catch (err: unknown) {
      showToast((err as Error).message ?? '操作失败')
    }
  }

  async function handleTest(server: McpServer) {
    setTestingId(server.id)
    setTestResults(prev => ({ ...prev, [server.id]: { ok: false } }))
    try {
      const result = await testServer.mutateAsync(server.id)
      setTestResults(prev => ({ ...prev, [server.id]: result }))
    } catch (err: unknown) {
      setTestResults(prev => ({ ...prev, [server.id]: { ok: false, error: (err as Error).message } }))
    } finally {
      setTestingId(null)
    }
  }

  if (isLoading) return <div className={styles.empty}>加载中…</div>

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        配置 MCP Server 后，聊天时 AI 可自动调用其暴露的工具。支持 stdio（本地进程）和 SSE（HTTP 远程）两种方式。
      </p>

      {servers.length === 0 && !showForm && (
        <div className={styles.empty}>暂无配置，点击下方按钮添加第一个 MCP Server</div>
      )}

      <div className={styles.list}>
        {servers.map((server, index) => (
          <div key={server.id} className={`${styles.card} ${!server.enabled ? styles.cardDisabled : ''}`}>
            <span className={styles.cardIndex}>{index + 1}</span>
            <div className={styles.cardMain}>
              <div className={styles.cardInfo}>
                <span className={styles.cardName}>{server.name}</span>
                <span className={styles.cardBadge}>{server.type}</span>
                <span className={styles.cardMeta}>
                  {server.type === 'stdio' ? server.command : server.url}
                </span>
              </div>
              <div className={styles.cardActions}>
                <label
                  className={styles.toggle}
                  title={server.enabled ? '已启用，点击禁用' : '已禁用，点击启用'}
                >
                  <input
                    type="checkbox"
                    checked={!!server.enabled}
                    onChange={() => handleToggle(server)}
                  />
                  <span className={styles.toggleSlider} />
                </label>
                <button
                  type="button"
                  className={`${styles.iconBtn} ${testingId === server.id ? styles.iconBtnLoading : ''}`}
                  onClick={() => handleTest(server)}
                  disabled={testingId === server.id}
                  title="测试连接"
                >
                  <img src={TestIcon} width={16} height={16} alt="测试" />
                </button>
                <button type="button" className={styles.iconBtn} onClick={() => openEdit(server)} title="编辑">
                  <img src={EditIcon} width={16} height={16} alt="编辑" />
                </button>
                <button type="button" className={`${styles.iconBtn} ${styles.iconBtnDanger}`} onClick={() => handleDelete(server)} title="删除">
                  <img src={DeleteIcon} width={16} height={16} alt="删除" />
                </button>
              </div>
            </div>

            {testResults[server.id] && (
              <div className={`${styles.testResult} ${testResults[server.id].ok ? styles.testOk : styles.testFail}`}>
                <button
                  type="button"
                  className={styles.testClose}
                  onClick={() => setTestResults(prev => { const next = { ...prev }; delete next[server.id]; return next })}
                  aria-label="关闭"
                >
                  <img src={CloseCircleIcon} width={14} height={14} alt="" aria-hidden="true" />
                </button>
                {testResults[server.id].ok ? (
                  <>
                    <span>连接成功，发现 {testResults[server.id].tools?.length ?? 0} 个工具</span>
                    {testResults[server.id].tools && testResults[server.id].tools!.length > 0 && (
                      <ul className={styles.toolList}>
                        {testResults[server.id].tools!.map(t => (
                          <li key={t.name}><code>{t.name}</code> — {t.description}</li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <span>连接失败：{testResults[server.id].error ?? '未知错误'}</span>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {showForm && (
        <form ref={formRef} className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formTitle}>{editingId ? '编辑 MCP Server' : '添加 MCP Server'}</div>

          <div className={styles.field}>
            <label className={styles.label}>名称</label>
            <input
              className={styles.input}
              value={form.name}
              onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              placeholder="例：文件系统"
              required
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>类型</label>
            <div className={styles.radioGroup}>
              <label className={styles.radio}>
                <input type="radio" value="stdio" checked={form.type === 'stdio'} onChange={() => setForm(p => ({ ...p, type: 'stdio' }))} />
                <span>stdio（本地进程）</span>
              </label>
              <label className={styles.radio}>
                <input type="radio" value="sse" checked={form.type === 'sse'} onChange={() => setForm(p => ({ ...p, type: 'sse' }))} />
                <span>SSE（HTTP 远程）</span>
              </label>
            </div>
          </div>

          {form.type === 'stdio' ? (
            <>
              <div className={styles.field}>
                <label className={styles.label}>命令</label>
                <input
                  className={styles.input}
                  value={form.command}
                  onChange={e => setForm(p => ({ ...p, command: e.target.value }))}
                  placeholder='例：npx'
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>参数（JSON 数组）</label>
                <input
                  className={styles.input}
                  value={form.args}
                  onChange={e => setForm(p => ({ ...p, args: e.target.value }))}
                  placeholder='例：["@modelcontextprotocol/server-filesystem", "/tmp"]'
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>环境变量（JSON 对象，可选）</label>
                <input
                  className={styles.input}
                  value={form.env}
                  onChange={e => setForm(p => ({ ...p, env: e.target.value }))}
                  placeholder='例：{"NODE_ENV": "production"}'
                />
              </div>
            </>
          ) : (
            <>
              <div className={styles.field}>
                <label className={styles.label}>SSE 端点 URL</label>
                <input
                  className={styles.input}
                  value={form.url}
                  onChange={e => setForm(p => ({ ...p, url: e.target.value }))}
                  placeholder='例：http://localhost:3000/sse'
                  required
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label}>请求头（JSON 对象，可选）</label>
                <input
                  className={styles.input}
                  value={form.headers}
                  onChange={e => setForm(p => ({ ...p, headers: e.target.value }))}
                  placeholder='例：{"Authorization": "Bearer token"}'
                />
              </div>
            </>
          )}

          <div className={styles.formActions}>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={createServer.isPending || updateServer.isPending}>
              {editingId ? '保存修改' : '添加'}
            </button>
            <button type="button" className={styles.btn} onClick={closeForm}>取消</button>
          </div>
        </form>
      )}

      {!showForm && (
        <button type="button" className={`${styles.btn} ${styles.btnPrimary} ${styles.addBtn}`} onClick={openCreate}>
          + 添加 MCP Server
        </button>
      )}
    </div>
  )
}
