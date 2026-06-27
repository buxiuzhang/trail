import { useConfirm } from '@/utils/confirm'
import { useChatContext, type PolishConfig } from '@/context/ChatContext'
import { useToastContext } from '@/context/ToastContext'

const TYPE_BODY: Record<PolishConfig['type'], string> = {
  log:       '当前日报内容将作为初始参考发送给 AI，生成润色建议后你可选择是否采用。',
  todo:      '当前补充说明将作为初始参考发送给 AI，生成润色建议后你可选择是否采用。',
  task_desc: '当前任务描述将作为初始参考发送给 AI，生成润色建议后你可选择是否采用。',
}

export function usePolish() {
  const confirm = useConfirm()
  const { openPolish } = useChatContext()
  const { showToast } = useToastContext()

  return async (config: PolishConfig): Promise<void> => {
    const ok = await confirm({
      level: 'safe',
      title: '启用 AI 润色？',
      body: <p>{TYPE_BODY[config.type]}</p>,
      confirmLabel: '开始润色',
      eyebrow: 'AI 润色',
    })
    if (!ok) return
    const started = openPolish(config)
    if (!started) showToast('工作对话已开启，请先关闭后再使用润色')
  }
}
