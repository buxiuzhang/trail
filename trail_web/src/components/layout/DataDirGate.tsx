import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useDataDir } from '../../api/settings'
import styles from './DataDirGate.module.css'

/**
 * M8 数据目录未配置遮罩。
 *
 * - 探测 /api/settings/data-dir（永远 200）
 * - configured=true：不渲染遮罩
 * - configured=false：自动跳到 #/settings + 渲染小条提示条（不挡页面，让用户能填路径）
 * - 探测中（isLoading）暂不渲染遮罩（避免遮罩闪一下就消失）
 *
 * 为什么不挂全屏 modal：用户点"去设置"跳转后必须能立刻填表单/点保存。挂全屏
 * 遮罩会让按钮被挡、不能交互。改成页内固定小条（不阻塞），等同
 * "强引导 + 可操作"。
 */
export function DataDirGate({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useDataDir()
  const location = useLocation()
  const navigate = useNavigate()

  // 未配置时自动跳到 settings（让引导一气呵成）
  useEffect(() => {
    if (!isLoading && data && !data.configured && location.pathname !== '/settings') {
      navigate('/settings', { replace: true })
    }
  }, [isLoading, data, location.pathname, navigate])

  if (isLoading) return <>{children}</>
  if (data?.configured) return <>{children}</>
  return (
    <>
      {children}
      {/* 顶条提示：固定位、不挡内容、自动消失 */}
      <div className={styles.banner} role="status" aria-live="polite">
        <span className={styles.bannerEyebrow}>首次使用</span>
        <span className={styles.bannerText}>
          系统已准备默认数据目录 <strong>~/.trail/data</strong>，请确认后开始使用。
        </span>
        <a className={styles.bannerLink} href="#/settings">去确认 →</a>
      </div>
    </>
  )
}
