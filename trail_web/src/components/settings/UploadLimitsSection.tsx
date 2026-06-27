import { useState, useEffect, useRef } from 'react'
import {
  useAttachmentSettings,
  useSaveAttachmentSettings,
  DEFAULT_ATTACHMENT_MAX_MB,
} from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import styles from './UploadLimitsSection.module.css'
import pageStyles from '@/pages/SettingsPage.module.css'

interface MimeEntry {
  mime: string
  ext: string      // display label e.g. ".png"
  builtin: boolean
}

interface TypeGroup {
  label: string
  entries: MimeEntry[]
}

const DEFAULT_GROUPS: TypeGroup[] = [
  {
    label: '图片',
    entries: [
      { mime: 'image/png',  ext: '.png',  builtin: true },
      { mime: 'image/jpeg', ext: '.jpeg', builtin: true },
      { mime: 'image/gif',  ext: '.gif',  builtin: true },
      { mime: 'image/webp', ext: '.webp', builtin: true },
    ],
  },
  {
    label: '文档',
    entries: [
      { mime: 'application/pdf', ext: '.pdf', builtin: true },
      { mime: 'application/msword', ext: '.doc', builtin: true },
      { mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', ext: '.docx', builtin: true },
      { mime: 'application/vnd.ms-excel', ext: '.xls', builtin: true },
      { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', ext: '.xlsx', builtin: true },
      { mime: 'application/vnd.ms-powerpoint', ext: '.ppt', builtin: true },
      { mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', ext: '.pptx', builtin: true },
    ],
  },
  {
    label: '文本',
    entries: [
      { mime: 'text/plain', ext: '.txt', builtin: true },
      { mime: 'text/csv',   ext: '.csv', builtin: true },
    ],
  },
  {
    label: '编程',
    entries: [
      { mime: 'text/html',              ext: '.html', builtin: true },
      { mime: 'text/javascript',        ext: '.js',   builtin: true },
      { mime: 'text/typescript',        ext: '.ts',   builtin: true },
      { mime: 'application/json',       ext: '.json', builtin: true },
      { mime: 'application/xml',        ext: '.xml',  builtin: true },
      { mime: 'text/x-python',          ext: '.py',   builtin: true },
      { mime: 'text/x-java-source',     ext: '.java', builtin: true },
      { mime: 'text/x-csrc',            ext: '.c',    builtin: true },
      { mime: 'text/x-sh',              ext: '.sh',   builtin: true },
      { mime: 'text/markdown',          ext: '.md',   builtin: true },
      { mime: 'text/yaml',              ext: '.yaml', builtin: true },
      { mime: 'application/sql',        ext: '.sql',  builtin: true },
    ],
  },
  {
    label: '压缩包',
    entries: [
      { mime: 'application/zip',           ext: '.zip', builtin: true },
      { mime: 'application/x-rar-compressed', ext: '.rar', builtin: true },
      { mime: 'application/x-7z-compressed',  ext: '.7z',  builtin: true },
    ],
  },
]

// 后端硬编码白名单对应的 MIME 集合（不含编程分组）
const DEFAULT_ENABLED_MIMES = new Set(
  DEFAULT_GROUPS
    .filter(g => g.label !== '编程')
    .flatMap(g => g.entries.map(e => e.mime))
)

export function UploadLimitsSection() {
  const { data: serverSettings } = useAttachmentSettings()
  const save = useSaveAttachmentSettings()
  const { showToast } = useToastContext()

  const [maxMB, setMaxMB] = useState(DEFAULT_ATTACHMENT_MAX_MB)
  const [groups, setGroups] = useState<TypeGroup[]>(DEFAULT_GROUPS.map(g => ({ ...g, entries: [...g.entries] })))
  const [enabledMimes, setEnabledMimes] = useState<Set<string>>(new Set(DEFAULT_ENABLED_MIMES))
  // adding state per group
  const [addingGroup, setAddingGroup] = useState<string | null>(null)
  const [addInput, setAddInput] = useState('')
  const addInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (addingGroup && addInputRef.current) addInputRef.current.focus()
  }, [addingGroup])

  useEffect(() => {
    if (!serverSettings) return
    setMaxMB(Math.round(serverSettings.max_bytes / 1024 / 1024) || DEFAULT_ATTACHMENT_MAX_MB)
    const saved = serverSettings.allowed_mimes
    if (!saved) {
      setEnabledMimes(new Set(DEFAULT_ENABLED_MIMES))
      setGroups(DEFAULT_GROUPS.map(g => ({ ...g, entries: [...g.entries] })))
      return
    }
    const savedSet = new Set(saved.split(',').map(s => s.trim()).filter(Boolean))
    const knownMimes = new Set(DEFAULT_GROUPS.flatMap(g => g.entries.map(e => e.mime)))
    const customMimes = [...savedSet].filter(m => !knownMimes.has(m))
    const newGroups = DEFAULT_GROUPS.map(g => ({ ...g, entries: [...g.entries] }))
    const extras: MimeEntry[] = customMimes.map(m => ({
      mime: m,
      ext: '.' + (m.split('/')[1] ?? m),
      builtin: false,
    }))
    if (extras.length > 0) {
      const otherGroup = newGroups.find(g => g.label === '其他')
      if (otherGroup) otherGroup.entries.push(...extras)
      else newGroups.push({ label: '其他', entries: extras })
    }
    setGroups(newGroups)
    setEnabledMimes(savedSet)
  }, [serverSettings])

  function toggleMime(mime: string) {
    setEnabledMimes(prev => {
      const next = new Set(prev)
      if (next.has(mime)) next.delete(mime)
      else next.add(mime)
      return next
    })
  }

  function commitAdd(groupLabel: string) {
    const raw = addInput.trim().toLowerCase()
    if (!raw) { setAddingGroup(null); setAddInput(''); return }
    // accept either "mime/type" or ".ext"
    let mime = raw
    let ext = raw.startsWith('.') ? raw : '.' + raw.split('/')[1]
    if (raw.startsWith('.')) {
      const extName = raw.slice(1)
      mime = 'application/' + extName
      ext = raw
    }
    setGroups(prev => prev.map(g => {
      if (g.label !== groupLabel) return g
      if (g.entries.some(e => e.mime === mime)) return g
      return { ...g, entries: [...g.entries, { mime, ext, builtin: false }] }
    }))
    setEnabledMimes(prev => new Set([...prev, mime]))
    setAddInput('')
    setAddingGroup(null)
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    try {
      await save.mutateAsync({
        allowed_mimes: [...enabledMimes].join(','),
        max_bytes: maxMB * 1024 * 1024,
      })
      showToast('附件设置已保存')
    } catch {
      showToast('保存失败')
    }
  }

  function handleReset() {
    setMaxMB(DEFAULT_ATTACHMENT_MAX_MB)
    setGroups(DEFAULT_GROUPS.map(g => ({ ...g, entries: [...g.entries] })))
    setEnabledMimes(new Set(DEFAULT_ENABLED_MIMES))
  }

  return (
    <section id="files-upload-limits" className={pageStyles.section}>
      <h2 className={pageStyles.sectionTitle}>附件设置</h2>
      <p className={pageStyles.sectionHint}>配置允许上传的文件类型和单文件大小上限。</p>
      <form onSubmit={handleSave}>
        {/* 文件大小 */}
        <div className={styles.sizeRow}>
          <span className={styles.sizeLabel}>大小上限</span>
          <input
            type="number"
            className={styles.sizeInput}
            value={maxMB}
            min={1}
            max={50}
            step={1}
            onChange={e => setMaxMB(Number(e.target.value) || DEFAULT_ATTACHMENT_MAX_MB)}
          />
          <span className={styles.sizeUnit}>MB</span>
        </div>

        {/* 文件类型分组 */}
        <div className="field">
          <div className="field__label"><span>允许的文件类型</span></div>
          <div style={{ marginTop: 8 }}>
            {groups.map(group => (
              <div key={group.label} className={styles.typeGroup}>
                <div className={styles.groupHeader}>
                  <span className={styles.groupLabel}>{group.label}</span>
                  <div className={styles.tagList}>
                    {group.entries.map(entry => (
                      <button
                        key={entry.mime}
                        type="button"
                        className={`${styles.tag} ${enabledMimes.has(entry.mime) ? styles.tagActive : ''} ${!entry.builtin ? styles.tagCustom : ''}`}
                        onClick={() => toggleMime(entry.mime)}
                        title={entry.mime}
                      >
                        {entry.ext}
                      </button>
                    ))}
                    {addingGroup === group.label ? (
                      <input
                        ref={addInputRef}
                        className={styles.tagInput}
                        value={addInput}
                        placeholder="mime/type 或 .ext"
                        onChange={e => setAddInput(e.target.value)}
                        onBlur={() => commitAdd(group.label)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') { e.preventDefault(); commitAdd(group.label) }
                          if (e.key === 'Escape') { setAddingGroup(null); setAddInput('') }
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        className={styles.tagAdd}
                        onClick={() => setAddingGroup(group.label)}
                      >
                        +
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className={styles.foot}>
          <button type="button" className="btn btn--ghost" onClick={handleReset}>恢复默认</button>
          <button type="submit" className="btn btn--primary" disabled={save.isPending}>
            {save.isPending ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </section>
  )
}
