import { HashRouter, Routes, Route, useLocation } from 'react-router-dom'
import { FilterProvider } from './context/FilterContext'
import { ModalProvider } from './context/ModalContext'
import { ToastProvider } from './context/ToastContext'
import { ChatProvider } from './context/ChatContext'
import { Masthead } from './components/layout/Masthead'
import { Shell } from './components/layout/Shell'
import { Sidebar } from './components/sidebar/Sidebar'
import { SettingsSidebar } from './components/sidebar/SettingsSidebar'
import { Modal } from './components/modal/Modal'
import { Toast } from './components/shared/Toast'
import { ChatBubble } from './components/chat/ChatBubble'
import { ChatWindow } from './components/chat/ChatWindow'
import { DataDirGate } from './components/layout/DataDirGate'
import { IndexPage } from './pages/IndexPage'
import { DetailPage } from './pages/DetailPage'
import { FormPage } from './pages/FormPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SettingsPage } from './pages/SettingsPage'
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

// 布局组件：根据路由决定显示哪个侧边栏
function AppLayout({ children }: { children: ReactNode }) {
  const location = useLocation()
  // HashRouter 下 location.pathname 不含 #，直接是路径
  const isSettingsPage = location.pathname === '/settings'
  const [activeSection, setActiveSection] = useState('interface')

  return (
    <SettingsContext.Provider value={{ activeSection, setActiveSection }}>
      <Shell>
        {isSettingsPage ? (
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
              <DataDirGate>
                <div className="grain" aria-hidden="true" />
                <Masthead />
                <AppLayout>
                  <main className="main">
                    <Routes>
                      <Route path="/" element={<IndexPage />} />
                      <Route path="/task/:id" element={<DetailPage />} />
                      <Route path="/edit/:id" element={<FormPage />} />
                      <Route path="/new" element={<FormPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="*" element={<NotFoundPage />} />
                    </Routes>
                  </main>
                </AppLayout>
                <Modal />
                <Toast />
                <ChatBubble />
                <ChatWindow />
              </DataDirGate>
            </ChatProvider>
          </ToastProvider>
        </ModalProvider>
      </FilterProvider>
    </HashRouter>
  )
}
