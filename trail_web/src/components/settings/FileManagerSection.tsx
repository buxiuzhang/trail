import { useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAttachmentList, useAttachmentTasks, useDeleteAttachment, type AttachmentListItem } from '@/api/attachments'
import { MultiSelect } from '@/components/shared/MultiSelect'
import { useConfirm } from '@/utils/confirm'
import { useToastContext } from '@/context/ToastContext'
import { useModalContext } from '@/context/ModalContext'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'

const FILE_TYPE_GROUPS = [
  { label: '图片',   value: 'image',    mimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] },
  { label: 'PDF',    value: 'pdf',      mimes: ['application/pdf'] },
  { label: '文档',   value: 'document', mimes: ['application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'] },
  { label: '表格',   value: 'sheet',    mimes: ['application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'] },
]
const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

function groupToMimes(groups: string[]): string[] {
  if (groups.length === 0) return []
  return groups.flatMap(g => FILE_TYPE_GROUPS.find(t => t.value === g)?.mimes ?? [])
}
function mimeToGroupLabel(mime: string): string {
  for (const g of FILE_TYPE_GROUPS) {
    if (g.mimes.includes(mime)) return g.label
  }
  return mime.split('/')[1]?.toUpperCase() ?? mime
}
function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function formatDate(iso: string): string {
  return iso ? iso.substring(0, 10) : ''
}

// ── 文件图标 ──────────────────────────────────────────────────
function FileIcon({ mime }: { mime: string }) {
  const isPdf   = mime === 'application/pdf'
  const isSheet = mime.includes('excel') || mime.includes('spreadsheet')
  const color = isPdf ? '#e55' : isSheet ? '#2a7' : '#67a'
  const label = isPdf ? 'PDF' : isSheet ? 'XLS' : 'DOC'
  return (
    <div style={{
      width: 40, height: 40, flexShrink: 0,
      background: color + '22', border: `0.5px solid ${color}44`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--mono)', fontSize: 10, fontWeight: 600,
      color, letterSpacing: '0.05em',
    }}>{label}</div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────
export function FileManagerSection() {
  const [selectedTypes, setSelectedTypes] = useState<string[]>([])
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([])
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(10)
  const [expandedRefs, setExpandedRefs] = useState<Record<number, any[]>>({})
  const [loadingRefs, setLoadingRefs] = useState<Record<number, boolean>>({})
  const [rowCtxMenu, setRowCtxMenu] = useState<{ x: number; y: number; item: AttachmentListItem } | null>(null)

  const navigate = useNavigate()
  const mimes = groupToMimes(selectedTypes)
  const taskIds = selectedTaskIds.map(Number)

  const { data: attachments = [], isLoading } = useAttachmentList({ mimes, taskIds })
  const { data: referencedTasks = [] } = useAttachmentTasks()
  const deleteAttachment = useDeleteAttachment()
  const confirm = useConfirm()
  const { showToast } = useToastContext()
  const { openModal } = useModalContext()
  const qc = useQueryClient()

  const handleTypeChange = (v: string[]) => { setSelectedTypes(v); setPage(1) }
  const handleTaskChange = (v: string[]) => { setSelectedTaskIds(v); setPage(1) }

  const taskOptions = referencedTasks.map(t => ({ value: String(t.id), label: t.title }))

  const totalPages = Math.max(1, Math.ceil(attachments.length / pageSize))
  const paged = attachments.slice((page - 1) * pageSize, page * pageSize)

  const toggleRefs = useCallback(async (id: number) => {
    if (expandedRefs[id]) {
      setExpandedRefs(prev => { const next = { ...prev }; delete next[id]; return next })
      return
    }
    setLoadingRefs(prev => ({ ...prev, [id]: true }))
    try {
      const data = await fetch(`/api/attachments/${id}/references`).then(r => r.json())
      const grouped: Record<number, { task_id: number; title: string | null; sources: string[]; allDeleted: boolean }> = {}
      for (const r of data) {
        const tid = r.task_id
        if (!grouped[tid]) grouped[tid] = { task_id: tid, title: r.title, sources: [], allDeleted: true }
        const label = r.source_type === 'task' ? '任务描述'
          : r.source_type === 'log' ? (r.log_date ? `日志 · ${r.log_date}` : '日志')
          : '待办'
        if (!grouped[tid].sources.includes(label)) grouped[tid].sources.push(label)
        if (!r.deleted) grouped[tid].allDeleted = false
      }
      setExpandedRefs(prev => ({ ...prev, [id]: Object.values(grouped) }))
    } finally {
      setLoadingRefs(prev => { const next = { ...prev }; delete next[id]; return next })
    }
  }, [expandedRefs])

  const handleDelete = useCallback(async (item: AttachmentListItem) => {
    if (item.active_ref_count > 0) {
      const refs = await fetch(`/api/attachments/${item.id}/references`).then(r => r.json())
      openModal({
        eyebrow: '无法删除',
        title: '此文件正在被引用',
        titleMode: 'zh',
        body: (
          <div>
            <p style={{ marginBottom: 12, color: 'var(--ink-soft)', fontSize: 14 }}>
              该文件被 <strong>{item.active_ref_count}</strong> 处有效引用，请先在对应的任务日志或描述中删除该附件引用，再回来删除此文件。
            </p>
            <ul style={{ paddingLeft: 16, fontSize: 13, color: 'var(--ink-faded)', lineHeight: 1.8 }}>
              {refs.filter((r: any) => !r.deleted).map((r: any, i: number) => (
                <li key={i}>
                  [{r.sourceType === 'task' ? '任务' : r.sourceType === 'log' ? '日志' : '待办'}]
                  {' '}{r.title || ''}{r.logDate ? ` · ${r.logDate}` : ''}
                </li>
              ))}
            </ul>
          </div>
        ),
        buttons: [
          { label: '知道了', className: 'btn btn--primary', action: () => {} },
        ],
      })
      return
    }
    const ok = await confirm({
      level: 'moderate', title: '删除此文件？',
      body: <p>将永久删除 {item.original_name || `附件 #${item.id}`}，无法恢复。</p>,
      confirmLabel: '删除',
    })
    if (!ok) return
    try {
      await deleteAttachment.mutateAsync(item.id)
      showToast('已删除')
      qc.invalidateQueries({ queryKey: ['attachments', 'list'] })
    } catch { showToast('删除失败') }
  }, [confirm, deleteAttachment, openModal, showToast, qc])

  const handleRename = useCallback((item: AttachmentListItem) => {
    let newName = item.original_name || ''
    openModal({
      eyebrow: '重命名',
      title: '修改文件名',
      titleMode: 'zh',
      body: (
        <div>
          <input
            type="text"
            defaultValue={newName}
            autoFocus
            onChange={e => { newName = e.target.value }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.form?.requestSubmit?.() }}
            style={{
              width: '100%', fontFamily: 'var(--mono)', fontSize: 14,
              border: 'none', borderBottom: '0.5px solid var(--ink)',
              padding: '6px 0', background: 'transparent', color: 'var(--ink)',
              outline: 'none',
            }}
          />
        </div>
      ),
      buttons: [
        { label: '取消', className: 'btn btn--ghost', action: () => {} },
        {
          label: '确认', className: 'btn btn--primary',
          action: async () => {
            const trimmed = newName.trim()
            if (!trimmed) return
            try {
              await api.put(`/api/attachments/${item.id}`, { originalName: trimmed })
              showToast('已重命名')
              qc.invalidateQueries({ queryKey: ['attachments', 'list'] })
            } catch { showToast('重命名失败') }
          },
        },
      ],
    })
  }, [openModal, showToast, qc])

  return (
    <div>
      {/* 筛选栏 */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <MultiSelect
          value={selectedTypes}
          options={FILE_TYPE_GROUPS.map(g => ({ value: g.value, label: g.label }))}
          onChange={handleTypeChange}
          placeholder="全部类型"
          searchPlaceholder="搜索类型…"
          noArrow
          underline
        />
        <MultiSelect
          value={selectedTaskIds}
          options={taskOptions}
          onChange={handleTaskChange}
          placeholder="全部任务"
          searchPlaceholder="搜索任务名…"
          noArrow
          underline
          minWidth={240}
        />
        {(selectedTypes.length > 0 || selectedTaskIds.length > 0) && (
          <button
            type="button"
            onClick={() => { setSelectedTypes([]); setSelectedTaskIds([]); setPage(1) }}
            style={{
              background: 'none', border: 'none',
              borderBottom: '0.5px solid var(--rule-soft)',
              padding: '4px 0', cursor: 'pointer',
              fontFamily: 'var(--mono)', fontSize: 11,
              color: 'var(--ink-ghost)', letterSpacing: '0.06em',
            }}
          >
            清除筛选
          </button>
        )}
        <span style={{
          marginLeft: 'auto', alignSelf: 'center',
          fontFamily: 'var(--mono)', fontSize: 11,
          color: 'var(--ink-ghost)', letterSpacing: '0.05em',
        }}>
          {isLoading ? '加载中…' : `共 ${attachments.length} 个文件`}
        </span>
      </div>

      {/* 列表 */}
      {isLoading ? (
        <p style={{ fontFamily: 'var(--body)', fontSize: 14, color: 'var(--ink-ghost)', padding: '24px 0' }}>载入中…</p>
      ) : attachments.length === 0 ? (
        <p style={{ fontFamily: 'var(--body)', fontSize: 14, color: 'var(--ink-ghost)', fontStyle: 'italic', padding: '24px 0' }}>暂无文件</p>
      ) : (
        <div style={{ border: '0.5px solid var(--rule)' }}>
          {paged.map((item, i) => {
            const refs = expandedRefs[item.id]
            const isLast = i === paged.length - 1
            return (
            <div key={item.id} style={{ borderBottom: (!isLast || refs) ? '0.5px solid var(--rule-soft)' : 'none' }}>
              {/* 主行 */}
              <div
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '10px 12px', background: 'var(--card)',
                }}
                onContextMenu={e => { e.preventDefault(); setRowCtxMenu({ x: e.clientX, y: e.clientY, item }) }}
              >
                {item.mime.startsWith('image/') ? (
                  <img
                    src={item.url} alt={item.original_name || ''}
                    onClick={() => setPreviewUrl(item.url)}
                    style={{ width: 40, height: 40, objectFit: 'cover', cursor: 'zoom-in', flexShrink: 0, border: '0.5px solid var(--rule-soft)' }}
                  />
                ) : <FileIcon mime={item.mime} />}

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--body)', fontSize: 14,
                      color: (item.ref_count > 0 && item.active_ref_count === 0) ? 'var(--ink-ghost)' : 'var(--ink)',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      textDecoration: (item.ref_count > 0 && item.active_ref_count === 0) ? 'line-through' : 'none',
                      textDecorationColor: 'var(--ink-ghost)',
                    }}>
                      {item.original_name || `附件 #${item.id}`}
                    </div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-ghost)', letterSpacing: '0.04em', marginTop: 2, display: 'flex', gap: 10 }}>
                    <span>{mimeToGroupLabel(item.mime)}</span>
                    <span>{formatBytes(item.byte_size)}</span>
                    <span>{formatDate(item.created_at)}</span>
                  </div>
                </div>

                {/* 引用按钮 */}
                <div style={{ flexShrink: 0 }}>
                  {item.ref_count > 0 ? (
                    <button type="button" onClick={() => toggleRefs(item.id)} style={{
                      fontFamily: 'var(--mono)', fontSize: 11, letterSpacing: '0.04em',
                      padding: '2px 6px', background: 'var(--card-deep)',
                      border: '0.5px solid var(--rule-soft)',
                      color: refs ? 'var(--ink)' : 'var(--ink-faded)', cursor: 'pointer',
                    }}>
                      {loadingRefs[item.id] ? '…' : refs ? '收起' : `${item.ref_count} 处引用`}
                    </button>
                  ) : (
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-ghost)' }}>未引用</span>
                  )}
                </div>

                {/* 操作 */}
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {!item.mime.startsWith('image/') && (
                    <a href={item.url} download={item.original_name || true} style={{
                      fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em',
                      textTransform: 'uppercase', color: 'var(--ink-ghost)',
                      textDecoration: 'none', padding: '3px 6px', border: '0.5px solid var(--rule-soft)',
                    }}>下载</a>
                  )}
                  <button type="button" onClick={() => handleDelete(item)} style={{
                    background: 'none', border: '0.5px solid var(--rule-soft)',
                    padding: '3px 6px', cursor: 'pointer',
                    fontFamily: 'var(--mono)', fontSize: 10, letterSpacing: '0.06em',
                    textTransform: 'uppercase', color: 'var(--ink-ghost)', transition: 'color 150ms',
                  }}
                    onMouseEnter={e => { e.currentTarget.style.color = '#c55'; e.currentTarget.style.borderColor = '#c55' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--ink-ghost)'; e.currentTarget.style.borderColor = 'var(--rule-soft)' }}
                  >删除</button>
                </div>
              </div>

              {/* 引用展开区 — 行下方 */}
              {refs && refs.length > 0 && (
                <div style={{
                  padding: '6px 12px 6px 64px',
                  background: 'var(--paper-warm)',
                  borderTop: '0.5px solid var(--rule-soft)',
                }}>
                  {refs.map((r: any, ri: number) => {
                    const taskTitle = referencedTasks.find(t => t.id === r.task_id)?.title
                      || r.title
                      || `任务 #${r.task_id}`
                    return (
                      <button key={ri} type="button"
                        onClick={r.allDeleted ? undefined : () => navigate(`/task/${r.task_id}`)}
                        style={{
                          display: 'flex', alignItems: 'baseline', gap: 6,
                          background: 'none', border: 'none', padding: '2px 0',
                          cursor: r.allDeleted ? 'not-allowed' : 'pointer',
                          textAlign: 'left',
                          fontFamily: 'var(--body)', fontSize: 13, lineHeight: 1.8,
                          opacity: r.allDeleted ? 0.5 : 1,
                        }}
                        onMouseEnter={e => { if (!r.allDeleted) e.currentTarget.style.opacity = '0.7' }}
                        onMouseLeave={e => { e.currentTarget.style.opacity = r.allDeleted ? '0.5' : '1' }}
                      >
                        <span style={{
                          fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--ink-ghost)',
                          letterSpacing: '0.04em', flexShrink: 0, minWidth: 16,
                        }}>{ri + 1}.</span>
                        <span style={{
                          color: r.allDeleted ? 'var(--ink-ghost)' : 'var(--green-ink, #2a7)',
                          textDecoration: r.allDeleted ? 'none' : 'underline',
                          textDecorationColor: 'var(--rule)',
                          textUnderlineOffset: '3px',
                        }}>{taskTitle}</span>
                        <span style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                          {r.sources.map((s: string, si: number) => (
                            <span key={si} style={{
                              fontFamily: 'var(--mono)', fontSize: 10,
                              color: 'var(--ink-ghost)', letterSpacing: '0.04em',
                              background: 'var(--card-deep)', padding: '0 4px',
                            }}>{s}</span>
                          ))}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
            )
          })}
        </div>
      )}

      {/* 行右键菜单 */}
      {rowCtxMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 999 }} onClick={() => setRowCtxMenu(null)} />
          <div style={{
            position: 'fixed', top: rowCtxMenu.y, left: rowCtxMenu.x, zIndex: 1000,
            background: 'var(--card)', border: '0.5px solid var(--rule)',
            boxShadow: 'var(--shadow-md)', minWidth: 120, padding: '4px 0',
          }}>
            {[
              { label: '重命名', action: () => { setRowCtxMenu(null); handleRename(rowCtxMenu.item) } },
              { label: '删除',   action: () => { setRowCtxMenu(null); handleDelete(rowCtxMenu.item) } },
            ].map(opt => (
              <div key={opt.label} onClick={opt.action} style={{
                padding: '7px 14px', cursor: 'pointer',
                fontFamily: 'var(--body)', fontSize: 13.5, color: 'var(--ink-soft)',
                transition: 'background 80ms',
              }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--card-deep)'; e.currentTarget.style.color = 'var(--ink)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--ink-soft)' }}
              >{opt.label}</div>
            ))}
          </div>
        </>
      )}

      {/* 分页 */}
      {!isLoading && attachments.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 12 }}>
          <button type="button" disabled={page <= 1} onClick={() => setPage(p => p - 1)} style={{
            background: 'none', border: '0.5px solid var(--rule-soft)', padding: '4px 8px',
            cursor: page <= 1 ? 'default' : 'pointer', opacity: page <= 1 ? 0.4 : 1,
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-faded)',
          }}>‹</button>
          <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-ghost)' }}>
            {page} / {totalPages}
          </span>
          <button type="button" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{
            background: 'none', border: '0.5px solid var(--rule-soft)', padding: '4px 8px',
            cursor: page >= totalPages ? 'default' : 'pointer', opacity: page >= totalPages ? 0.4 : 1,
            fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-faded)',
          }}>›</button>
          <select
            value={pageSize}
            onChange={e => { setPageSize(Number(e.target.value)); setPage(1) }}
            style={{
              fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--ink-faded)',
              background: 'var(--card)', border: '0.5px solid var(--rule-soft)',
              padding: '4px 6px', cursor: 'pointer',
            }}
          >
            {PAGE_SIZE_OPTIONS.map(s => <option key={s} value={s}>{s} 条/页</option>)}
          </select>
        </div>
      )}

      {/* 图片预览 overlay */}
      {previewUrl && (
        <div onClick={() => setPreviewUrl(null)} style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.75)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'zoom-out',
        }}>
          <img src={previewUrl} style={{ maxWidth: '90vw', maxHeight: '90vh', objectFit: 'contain' }} onClick={e => e.stopPropagation()} />
        </div>
      )}
    </div>
  )
}
