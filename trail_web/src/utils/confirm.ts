import type { ReactNode } from 'react'
import { useModalContext } from '@/context/ModalContext'

/**
 * 危险等级
 * - critical: 极高危险，不可逆，影响全局（如数据目录切换）
 * - dangerous: 高危险，批量操作（如全部重置）
 * - moderate: 中等风险，配置保存（如单个保存/重置）
 * - safe: 低风险（保留备用）
 */
export type DangerLevel = 'critical' | 'dangerous' | 'moderate' | 'safe'

export interface ConfirmOptions {
  /** 危险等级，影响按钮样式和默认文案 */
  level?: DangerLevel
  /** 标题 */
  title: string
  /** 说明内容 */
  body: ReactNode
  /** 确认按钮文案，默认根据 level 自动生成 */
  confirmLabel?: string
  /** 取消按钮文案，默认 '取消' */
  cancelLabel?: string
  /** eyebrow，默认 '确认' */
  eyebrow?: string
}

/**
 * 通用确认 hook
 *
 * @example
 * const confirm = useConfirm()
 * const ok = await confirm({
 *   level: 'critical',
 *   title: '切换数据目录？',
 *   body: <p>此操作将关闭旧数据库连接。</p>,
 *   confirmLabel: '确认切换',
 * })
 * if (ok) { /* 执行操作 *\/ }
 */
export function useConfirm() {
  const { openModal, closeModal } = useModalContext()

  return (options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      const {
        level = 'moderate',
        title,
        body,
        confirmLabel,
        cancelLabel = '取消',
        eyebrow = '确认',
      } = options

      // 根据危险等级决定按钮样式
      const confirmBtnClass =
        level === 'critical' || level === 'dangerous'
          ? 'btn btn--danger'
          : 'btn btn--primary'

      // 默认确认按钮文案
      const defaultConfirmLabels: Record<DangerLevel, string> = {
        critical: '确认执行',
        dangerous: '确认',
        moderate: '确认',
        safe: '确定',
      }

      openModal({
        eyebrow,
        title,
        titleMode: 'zh',
        body,
        buttons: [
          {
            label: cancelLabel,
            className: 'btn btn--ghost',
            action: () => {
              closeModal()
              resolve(false)
            },
          },
          {
            label: confirmLabel || defaultConfirmLabels[level],
            className: confirmBtnClass,
            action: () => {
              closeModal()
              resolve(true)
            },
          },
        ],
      })
    })
  }
}
