import { useSettingsContext } from '@/context/SettingsContext'
import { Crumbs } from '@/components/shared/Crumbs'
import { UploadLimitsSection } from '@/components/settings/UploadLimitsSection'
import { FileManagerSection } from '@/components/settings/FileManagerSection'
import { McpSection } from '@/components/settings/McpSection'
import { SkillsSection } from '@/components/settings/SkillsSection'
import { LlmConnectionSection } from '@/components/settings/LlmConnectionSection'
import { VectorSection } from '@/components/settings/VectorSection'
import { LlmRecordPromptsSection } from '@/components/settings/LlmRecordPromptsSection'
import { LlmDialogPromptsSection } from '@/components/settings/LlmDialogPromptsSection'
import { LlmDisabledPromptsSection } from '@/components/settings/LlmDisabledPromptsSection'
import { DataDirSection } from '@/components/settings/DataDirSection'
import { GeneralSection } from '@/components/settings/GeneralSection'
import { WatchSection } from '@/components/settings/WatchSection'
import { TodoAlertSection } from '@/components/settings/TodoAlertSection'
import { PlaceholdersSection } from '@/components/settings/PlaceholdersSection'
import { WeatherSection } from '@/components/settings/WeatherSection'
import styles from './SettingsPage.module.css'

export function SettingsPage() {
  const settingsCtx = useSettingsContext()
  const activeSection = settingsCtx?.activeSection ?? 'interface'

  return (
    <article className={styles.page}>
      <Crumbs items={[{ label: '任务清单', href: '/archive' }, { label: '设置' }]} />

      <header className={styles.header}>
        <h1 className={styles.title}>设置</h1>
        <span className={styles.sub}>偏好与配置</span>
      </header>

      {activeSection === 'files' && (
        <>
          <UploadLimitsSection />
          <section className={styles.section}>
            <h2 className={styles.sectionTitle}>文件管理</h2>
            <p className={styles.sectionHint}>管理任务描述、日报、待办中上传的附件，支持按文件类型和任务筛选。</p>
            <FileManagerSection />
          </section>
        </>
      )}

      {activeSection === 'llm' && (
        <>
          <LlmConnectionSection />
          <VectorSection />
          <LlmRecordPromptsSection />
          <LlmDialogPromptsSection />
          <section id="llm-mcp" className={styles.section}>
            <h2 className={styles.sectionTitle}>MCP 工具服务</h2>
            <McpSection />
          </section>
          <section id="llm-skills" className={styles.section}>
            <h2 className={styles.sectionTitle}>Skills 扩展</h2>
            <SkillsSection />
          </section>
          <LlmDisabledPromptsSection />
        </>
      )}

      {activeSection === 'interface' && (
        <>
          <DataDirSection />
          <GeneralSection />
          <WatchSection />
          <TodoAlertSection />
          <PlaceholdersSection />
          <WeatherSection />
        </>
      )}
    </article>
  )
}
