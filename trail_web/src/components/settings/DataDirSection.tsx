import { useState, useEffect } from 'react'
import { useDataDir, useSaveDataDir } from '@/api/settings'
import { useToastContext } from '@/context/ToastContext'
import { useConfirm } from '@/utils/confirm'
import styles from '@/pages/SettingsPage.module.css'

export function DataDirSection() {
  const { showToast } = useToastContext()
  const confirm = useConfirm()
  const { data: dataDir, isLoading: dirLoading } = useDataDir({ enabled: true })
  const saveDir = useSaveDataDir()
  const [dirDraft, setDirDraft] = useState('')

  useEffect(() => {
    if (dataDir?.dataDir) setDirDraft(dataDir.dataDir)
  }, [dataDir])

  async function handleSave(e: React.SyntheticEvent) {
    e.preventDefault()
    const path = dirDraft.trim()
    if (!path) { showToast('路径不能为空'); return }
    if (!path.startsWith('/') && !/^[a-zA-Z]:[/\\]/.test(path)) {
      showToast('请输入绝对路径'); return
    }
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
      setTimeout(() => window.location.reload(), 600)
    } catch (err: unknown) {
      showToast('切换失败：' + (err as Error).message)
    }
  }

  return (
    <section id="interface-data" className={styles.section}>
      <h2 className={styles.sectionTitle}>数据目录</h2>
      <p className={styles.sectionHint}>
        SQLite 主库、密钥、导出、附件、运行日志都保存在这个目录下（系统自动分子目录）。
        {!dataDir?.configured && ' 系统已为你准备了默认目录，点击按钮确认后开始初始化。'}
      </p>
      {dirLoading ? (
        <p className={styles.sectionHint}>载入中...</p>
      ) : (
        <form onSubmit={handleSave}>
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
  )
}
