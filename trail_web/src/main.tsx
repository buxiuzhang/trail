import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App'
import { DataDirNotConfiguredError } from './api/client'
import './App.css'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30s 内不会重新请求
      // M8：NEEDS_DATA_DIR 不重试（让 DataDirGate 第一时间挂上遮罩），
      //      其他错误重试 1 次（保持 DuckDB 锁兼容的体感）
      retry: (failureCount, error) => {
        if (error instanceof DataDirNotConfiguredError) return false
        return failureCount < 1
      },
      refetchOnWindowFocus: false,
    },
  },
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
)
