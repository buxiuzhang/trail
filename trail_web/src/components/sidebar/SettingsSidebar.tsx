/**
 * SettingsSidebar · 设置页面导航侧边栏
 *
 * 进入设置页面后显示，替代任务筛选侧边栏。
 * 点击导航项切换不同设置分类。
 */
import { useState } from 'react'
import styles from './SettingsSidebar.module.css'

interface SettingsSidebarProps {
  activeSection: string
  onSectionChange: (section: string) => void
}

const SECTIONS = [
  { key: 'interface', label: '界面偏好' },
  { key: 'llm', label: '大模型' },
  { key: 'files', label: '文件管理' },
]

const LLM_SUB = [
  { id: 'llm-record', label: '工作记录' },
  { id: 'llm-dialog', label: '对话与报表' },
  { id: 'llm-vector', label: '向量模型' },
  { id: 'llm-mcp', label: 'MCP 工具服务' },
  { id: 'llm-skills', label: 'Skills 扩展' },
  { id: 'llm-disabled', label: '暂不可用' },
]

const INTERFACE_SUB = [
  { id: 'interface-data', label: '数据目录' },
  { id: 'interface-general', label: '通用设置' },
  { id: 'interface-watch', label: '特别关注推送配置' },
  { id: 'interface-todo-alert', label: '待办事项推送配置' },
  { id: 'interface-placeholders', label: '占位提示语' },
]

const FILES_SUB = [
  { id: 'files-upload-limits', label: '附件设置' },
]

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  const [activeSubId, setActiveSubId] = useState<string | null>(null)

  function handleSubClick(id: string, section: string) {
    setActiveSubId(id)
    if (activeSection !== section) {
      onSectionChange(section)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
        })
      })
    } else {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }

  return (
    <aside className={styles.sidebar} aria-label="设置导航">
      <section className={styles.block}>
        <h2 className={styles.title}>设置</h2>
        <ul className={styles.list} role="list">
          {SECTIONS.map(item => (
            <li key={item.key}>
              <div
                className={`${styles.item} ${activeSection === item.key ? styles.isActive : ''}`}
                onClick={() => {
                  onSectionChange(item.key)
                  setActiveSubId(null)
                  document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    onSectionChange(item.key)
                    setActiveSubId(null)
                    document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })
                  }
                }}
              >
                <span>{item.label}</span>
              </div>
              {item.key === 'interface' && activeSection === 'interface' && (
                <ul className={styles.subList} role="list">
                  {INTERFACE_SUB.map(sub => (
                    <li
                      key={sub.id}
                      className={`${styles.subItem} ${activeSubId === sub.id ? styles.subItemActive : ''}`}
                      onClick={() => handleSubClick(sub.id, 'interface')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSubClick(sub.id, 'interface') }}
                    >
                      <span>{sub.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {item.key === 'llm' && activeSection === 'llm' && (
                <ul className={styles.subList} role="list">
                  {LLM_SUB.map(sub => (
                    <li
                      key={sub.id}
                      className={`${styles.subItem} ${activeSubId === sub.id ? styles.subItemActive : ''}`}
                      onClick={() => handleSubClick(sub.id, 'llm')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSubClick(sub.id, 'llm') }}
                    >
                      <span>{sub.label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {item.key === 'files' && activeSection === 'files' && (
                <ul className={styles.subList} role="list">
                  {FILES_SUB.map(sub => (
                    <li
                      key={sub.id}
                      className={`${styles.subItem} ${activeSubId === sub.id ? styles.subItemActive : ''}`}
                      onClick={() => handleSubClick(sub.id, 'files')}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSubClick(sub.id, 'files') }}
                    >
                      <span>{sub.label}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
