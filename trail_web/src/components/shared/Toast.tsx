import { useToastContext } from '@/context/ToastContext'
import clsx from 'clsx'

export function Toast() {
  const { message, visible } = useToastContext()

  return (
    <div className={clsx('toast', visible && 'is-visible')} aria-live="polite">
      {message}
    </div>
  )
}
