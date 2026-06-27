import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { FilterProvider } from './context/FilterContext'
import { ModalProvider } from './context/ModalContext'
import { ToastProvider } from './context/ToastContext'
import { ChatProvider } from './context/ChatContext'
import { UploadQueueProvider } from './context/UploadQueueContext'
import { DownloadQueueProvider } from './context/DownloadQueueContext'
import { Masthead } from './components/layout/Masthead'
import { Shell } from './components/layout/Shell'
import { Sidebar } from './components/sidebar/Sidebar'
import { SettingsSidebar } from './components/sidebar/SettingsSidebar'
import { WorkbenchSidebar } from './components/sidebar/WorkbenchSidebar'
import { Modal } from './components/modal/Modal'
import { Toast } from './components/shared/Toast'
import { UploadQueuePanel } from './components/shared/UploadQueue'
import { DownloadQueuePanel } from './components/shared/DownloadQueue'
import { ChatBubble } from './components/chat/ChatBubble'
import { ChatWindow } from './components/chat/ChatWindow'
import { DataDirGate } from './components/layout/DataDirGate'
import { IndexPage } from './pages/IndexPage'
import { WorkbenchPage } from './pages/WorkbenchPage'
import { QuickLogPage } from './pages/QuickLogPage'
import { DetailPage } from './pages/DetailPage'
import { FormPage } from './pages/FormPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SettingsPage } from './pages/SettingsPage'
import { WorkbenchProvider } from './context/WorkbenchContext'
import { useWatchAlerts } from './hooks/useWatchAlerts'
import { createContext, useContext, useState, type ReactNode } from 'react'

// 设置页面分类状态上下文
interface SettingsContextType {
  activeSection: string
  setActiveSection: (section: string) => void
}

const SettingsContext = createContext<SettingsContextType | null>(null)

export function useSettingsContext() {
  const ctx = useContext(SettingsContext)
  return ctx
}

/** 始终挂载，确保 WebSocket 长连接不依赖 ChatWindow 是否打开。 */
function WatchAlertsMount() {
  useWatchAlerts()
  return null
}

// 布局组件：根据路由决定显示哪个侧边栏
function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  const isSettingsPage = location.pathname === '/settings'
  const isWorkbench = location.pathname === '/' || location.pathname === '/workbench'
  const [activeSection, setActiveSection] = useState('interface')

  return (
    <SettingsContext.Provider value={{ activeSection, setActiveSection }}>
      <Shell>
        {isWorkbench ? (
          <WorkbenchSidebar />
        ) : isSettingsPage ? (
          <SettingsSidebar activeSection={activeSection} onSectionChange={setActiveSection} />
        ) : (
          <Sidebar />
        )}
        {children}
      </Shell>
    </SettingsContext.Provider>
  )
}

export default function App() {
  return (
    <HashRouter>
      <FilterProvider>
        <ModalProvider>
          <ToastProvider>
            <ChatProvider>
              <UploadQueueProvider>
              <DownloadQueueProvider>
              <DataDirGate>
                <div className="grain" aria-hidden="true" />
                <WatchAlertsMount />
                <Masthead />
                <WorkbenchProvider>
                <AppLayout>
                  <main className="main">
                    <Routes>
                      <Route path="/" element={<WorkbenchPage />} />
                      <Route path="/workbench" element={<WorkbenchPage />} />
                      <Route path="/archive" element={<IndexPage />} />
                      <Route path="/quick-log" element={<QuickLogPage />} />
                      <Route path="/task/:id" element={<DetailPage />} />
                      <Route path="/edit/:id" element={<FormPage />} />
                      <Route path="/new" element={<FormPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </main>
                </AppLayout>
                </WorkbenchProvider>
                <Modal />
                <Toast />
                <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 1100, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
                  <DownloadQueuePanel />
                  <UploadQueuePanel />
                </div>
                <ChatBubble />
                <ChatWindow />
              </DataDirGate>
              </DownloadQueueProvider>
              </UploadQueueProvider>
            </ChatProvider>
          </ToastProvider>
        </ModalProvider>
      </FilterProvider>
    </HashRouter>
  )
}
