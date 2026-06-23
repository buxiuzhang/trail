import { useState, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { type Skill } from '@/api/skills'
import { useUpdateSkill } from '@/api/skills'
import { useToastContext } from '@/context/ToastContext'
import CloseCircleIcon from '@/icons/close-circle.svg'
import styles from './SkillOptimizeDialog.module.css'

type Rating = 'good' | 'ok' | 'bad' | null
type Stage = 'idle' | 'optimizing' | 'optimized' | 'running' | 'ran'

interface OptimizeHistory {
  rating: NonNullable<Rating>
  comment: string
  currentPrompt: string
  optimizedPrompt: string
  ts: number
}

const RATING_OPTIONS: { value: NonNullable<Rating>; label: string; emoji: string }[] = [
  { value: 'good', label: '好', emoji: '👍' },
  { value: 'ok',   label: '中', emoji: '🤝' },
  { value: 'bad',  label: '差', emoji: '👎' },
]

// Mock：根据上次评价生成不同的优化 prompt
function getMockOptimized(rating: Rating, comment: string): string {
  if (rating === 'bad') {
    return `## 日志润色规范（调整版）

根据反馈「${comment || '效果不佳'}」，本次调整如下：

### 核心原则
- **只润色原文，不补充原文没有的内容**
- 不猜测原因、不捏造结论、不添加未发生的事实

### 润色范围
- 将口语改为书面语
- 补全句子结构，使表意完整
- 去除冗余词汇

### 格式要求
- 保持原文信息量，不扩写
- 不超过原文字数的 1.5 倍
- 保留所有专有名词原样`
  }
  if (rating === 'ok') {
    return `## 日志润色规范（优化版 v2）

在上一版基础上进一步精简：

### 必须保留
- 专有名词、系统名称、账号信息原样保留
- 操作对象、操作结果不得修改

### 润色方向
- 将口语化表达改为专业书面语
- 补充缺失的主语或动作主体
- 结论明确：已完成 / 待处理 / 等待回复

### 不做的事
- 不补充原文未提及的原因
- 不改变事实性内容`
  }
  return `## 日志润色规范（个人定制版）

润色时遵循以下规则：

### 必须保留
- 专有名词、系统名称、接口名称原样保留
- 具体数值、时间、环境信息不得修改

### 必须补充（若原文缺失）
- 操作的触发原因或背景（一句话）
- 处理结论或当前状态（解决了/搁置了/等待谁）

### 格式要求
- 用自然段落，不使用编号列表
- 控制在 150 字以内
- 语气专业简洁，去除口语化表达

### 不做的事
- 不凭空补充原文没有的技术细节
- 不改变事实性内容`
}

// Mock：调试运行结果（不捏造，只润色输入内容）
function mockRunResult(prompt: string, input: string): string {
  const isStrict = prompt.includes('只润色原文')
  if (isStrict) {
    return `${input}（已按书面语润色，未添加原文以外的内容）`
  }
  return `${input}\n\n已完成操作，具体执行情况如上。`
}

function streamText(text: string, setter: (fn: (p: string) => string) => void, onDone: () => void) {
  const chars = text.split('')
  let i = 0
  const tick = () => {
    if (i >= chars.length) { onDone(); return }
    setter(p => p + chars.slice(i, i + 5).join(''))
    i += 5
    setTimeout(tick, 16)
  }
  setTimeout(tick, 300)
}

function loadHistory(skillId: string): OptimizeHistory[] {
  try {
    return JSON.parse(localStorage.getItem(`skill_optimize_history_${skillId}`) ?? '[]')
  } catch { return [] }
}

function saveHistory(skillId: string, entry: OptimizeHistory) {
  const hist = loadHistory(skillId)
  hist.unshift(entry)
  localStorage.setItem(`skill_optimize_history_${skillId}`, JSON.stringify(hist.slice(0, 5)))
}

interface Props {
  skill: Skill
  onClose: () => void
}

export function SkillOptimizeDialog({ skill, onClose }: Props) {
  const [stage, setStage] = useState<Stage>('idle')
  const [currentPrompt, setCurrentPrompt] = useState(skill.system_prompt)
  const [optimizedPrompt, setOptimizedPrompt] = useState('')
  const [currentResult, setCurrentResult] = useState('')
  const [optimizedResult, setOptimizedResult] = useState('')
  const [debugInput, setDebugInput] = useState('')
  const [rating, setRating] = useState<Rating>(null)
  const [comment, setComment] = useState('')

  const updateSkill = useUpdateSkill()
  const { showToast } = useToastContext()
  const busy = stage === 'optimizing' || stage === 'running'

  // 生成优化版本（传入上次评价作为参考）
  const handleOptimize = useCallback((lastRating: Rating = null, lastComment = '') => {
    setStage('optimizing')
    setOptimizedPrompt('')
    setCurrentResult('')
    setOptimizedResult('')
    setRating(null)
    setComment('')
    streamText(getMockOptimized(lastRating, lastComment), setOptimizedPrompt, () => setStage('optimized'))
  }, [])

  // 调试运行
  const handleRun = useCallback(() => {
    if (!debugInput.trim() || !optimizedPrompt) return
    setStage('running')
    setCurrentResult('')
    setOptimizedResult('')

    let leftDone = false
    let rightDone = false
    const checkDone = () => { if (leftDone && rightDone) setStage('ran') }

    streamText(mockRunResult(currentPrompt, debugInput), setCurrentResult, () => { leftDone = true; checkDone() })
    setTimeout(() => {
      streamText(mockRunResult(optimizedPrompt, debugInput), setOptimizedResult, () => { rightDone = true; checkDone() })
    }, 150)
  }, [debugInput, currentPrompt, optimizedPrompt])

  // 应用优化版本 → 左=右，重新生成右
  function handleApply() {
    if (!rating) return
    saveHistory(skill.id, { rating, comment, currentPrompt, optimizedPrompt, ts: Date.now() })
    setCurrentPrompt(optimizedPrompt)
    handleOptimize(rating, comment)
  }

  // 重新生成（左不动）
  function handleRegenerate() {
    if (!rating) return
    saveHistory(skill.id, { rating, comment, currentPrompt, optimizedPrompt, ts: Date.now() })
    handleOptimize(rating, comment)
  }

  // 保存当前版本到 Skill
  async function handleSave() {
    try {
      await updateSkill.mutateAsync({
        id: skill.id,
        name: skill.name,
        system_prompt: currentPrompt,
      })
      showToast('Skill 已保存')
      onClose()
    } catch (e: unknown) {
      showToast((e as Error).message ?? '保存失败', 'error')
    }
  }

  function handleClose() {
    if (busy) return
    onClose()
  }

  const canRun = stage === 'optimized' || stage === 'ran'
  const canDecide = stage === 'ran' && !!rating

  return createPortal(
    <div className={styles.shroud} onClick={handleClose}>
      <div className={styles.dialog} onClick={e => e.stopPropagation()}>

        {/* 头部 */}
        <div className={styles.hd}>
          <div className={styles.hdLeft}>
            <span className={styles.eyebrow}>✦ 智能优化</span>
            <h3 className={styles.title}>{skill.name}</h3>
          </div>
          <div className={styles.hdRight}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnSave}`}
              onClick={handleSave}
              disabled={busy || updateSkill.isPending}
              title="保存当前版本到 Skill"
            >
              保存当前版本
            </button>
            <button
              type="button"
              className={styles.closeBtn}
              onClick={handleClose}
              disabled={busy}
              aria-label="关闭"
            >
              <img src={CloseCircleIcon} width={18} height={18} alt="" aria-hidden />
            </button>
          </div>
        </div>

        {/* 两栏对比 */}
        <div className={styles.compare}>

          {/* 左栏 */}
          <div className={styles.panel}>
            <div className={styles.panelHd}>
              <span className={styles.panelLabel}>当前版本</span>
            </div>
            <div className={styles.panelPrompt}>
              <pre className={styles.promptText}>{currentPrompt}</pre>
            </div>
            {(currentResult || stage === 'running') && (
              <>
                <div className={styles.resultDivider}>调试结果</div>
                <div className={styles.panelResult}>
                  <pre className={styles.resultText}>{currentResult}{stage === 'running' && !currentResult && <span className={styles.cursor}>|</span>}</pre>
                </div>
              </>
            )}
          </div>

          <div className={styles.colDivider} />

          {/* 右栏 */}
          <div className={styles.panel}>
            <div className={styles.panelHd}>
              <span className={styles.panelLabel}>
                优化后版本
                {stage === 'optimizing' && <span className={styles.streaming}>生成中…</span>}
              </span>
              {stage === 'idle' && (
                <button type="button" className={styles.optimizeHdBtn} onClick={() => handleOptimize()}>
                  ✦ 优化
                </button>
              )}
            </div>
            <div className={styles.panelPrompt}>
              {stage === 'idle' ? (
                <div className={styles.emptyHint}>点击右上角「✦ 优化」生成优化版本</div>
              ) : (
                <pre className={styles.promptText}>{optimizedPrompt}{stage === 'optimizing' && <span className={styles.cursor}>|</span>}</pre>
              )}
            </div>
            {(optimizedResult || (stage === 'running' && optimizedPrompt)) && (
              <>
                <div className={styles.resultDivider}>调试结果</div>
                <div className={styles.panelResult}>
                  <pre className={styles.resultText}>{optimizedResult}{stage === 'running' && !optimizedResult && <span className={styles.cursor}>|</span>}</pre>
                </div>
              </>
            )}
          </div>
        </div>

        {/* 评价 + 调试输入 */}
        <div className={styles.debugBlock}>
          {stage === 'ran' && (
          <div className={styles.ratingRow}>
            <div className={styles.ratingTop}>
              <span className={styles.ratingLabel}>评价</span>
              <div className={styles.ratingOptions}>
                {RATING_OPTIONS.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    className={`${styles.ratingBtn} ${rating === opt.value ? styles[`rating_${opt.value}`] : ''}`}
                    onClick={() => setRating(opt.value)}
                    disabled={stage !== 'ran'}
                  >
                    {opt.emoji} {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className={styles.ratingBottom}>
              <input
                type="text"
                className={styles.commentInput}
                value={comment}
                onChange={e => setComment(e.target.value)}
                placeholder="意见（可选）"
              />
              <button
                type="button"
                className={styles.btn}
                onClick={handleRegenerate}
                disabled={!canDecide || busy}
              >
                重新生成
              </button>
            </div>
          </div>
          )}
          <div className={styles.debugLabel} style={{ marginTop: stage === 'ran' ? 'var(--space-md)' : 0 }}>调试内容</div>
          <textarea
            className={styles.debugInput}
            value={debugInput}
            onChange={e => setDebugInput(e.target.value)}
            placeholder="输入真实内容（如一条日志、一段任务描述），运行后查看两个版本的处理效果…"
            disabled={busy}
          />
          <div className={styles.debugActions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnRun}`}
              onClick={handleRun}
              disabled={!canRun || !debugInput.trim() || busy}
            >
              {stage === 'running' ? '运行中…' : '▶ 运行'}
            </button>
          </div>
        </div>

        {/* 操作按钮 */}
        <div className={styles.ft}>
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              onClick={handleApply}
              disabled={!canDecide || busy}
            >
              应用优化版本
            </button>
          </div>
        </div>

      </div>
    </div>,
    document.body
  )
}
