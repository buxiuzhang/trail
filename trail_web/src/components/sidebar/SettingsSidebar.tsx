/**
 * SettingsSidebar · 设置页面导航侧边栏
 *
 * 进入设置页面后显示，替代任务筛选侧边栏。
 * 点击导航项切换不同设置分类。
 */
import styles from './SettingsSidebar.module.css'

interface SettingsSidebarProps {
  activeSection: string
  onSectionChange: (section: string) => void
}

const SECTIONS = [
  { key: 'interface', label: '界面偏好' },
  { key: 'llm', label: '大模型' },
  { key: 'placeholders', label: '占位提示语' },
  { key: 'data', label: '数据目录' },
]

export function SettingsSidebar({ activeSection, onSectionChange }: SettingsSidebarProps) {
  return (
    <aside className={styles.sidebar} aria-label="设置导航">
      <section className={styles.block}>
        <h2 className={styles.title}>设置</h2>
        <ul className={styles.list} role="list">
          {SECTIONS.map(item => (
            <li
              key={item.key}
              className={`${styles.item} ${activeSection === item.key ? styles.isActive : ''}`}
              onClick={() => onSectionChange(item.key)}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSectionChange(item.key) }}
            >
              <span>{item.label}</span>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
