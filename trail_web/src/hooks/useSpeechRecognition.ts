/**
 * useSpeechRecognition · 语音识别 Hook
 *
 * 封装 Web Speech API，用于聊天窗口语音输入。
 * 浏览器兼容：Chrome/Edge 完全支持，Safari 部分支持，Firefox 不支持。
 */
import { useState, useEffect, useRef, useCallback } from 'react'

// Web Speech API 类型定义
interface SpeechRecognition extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  onspeechstart: (() => void) | null
  onspeechend: (() => void) | null
  onaudiostart: (() => void) | null
  onaudioend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionResultList {
  length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionResult {
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string
  message: string
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition
}

interface UseSpeechRecognitionResult {
  /** 是否正在录音 */
  isListening: boolean
  /** 录音进度 0-1 */
  progress: number
  /** 开始录音 */
  start: () => void
  /** 停止录音 */
  stop: () => void
  /** 浏览器是否支持 */
  isSupported: boolean
  /** 错误信息 */
  error: string | null
}

// 扩展 Window 接口以支持 webkit 前缀
declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

// 默认录音时长（秒）
const DEFAULT_MAX_DURATION = 10

/**
 * 语音识别 Hook
 *
 * 注意：不返回 transcript state，而是通过回调参数传递识别结果。
 * 这样可以避免 React state 更新延迟问题。
 */
export function useSpeechRecognition(
  /** 识别结果回调，每次识别成功时调用 */
  onResult?: (text: string) => void,
  /** 录音最大时长（秒），默认 10 */
  maxDuration?: number
): UseSpeechRecognitionResult {
  const [isListening, setIsListening] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recognitionRef = useRef<SpeechRecognition | null>(null)
  // 用 ref 保存回调，避免 useEffect 依赖变化导致重新创建 recognition
  const onResultRef = useRef(onResult)
  // 进度定时器
  const progressTimerRef = useRef<number | null>(null)
  // 录音最大时长（秒）
  const MAX_DURATION = maxDuration ?? DEFAULT_MAX_DURATION

  // 更新回调 ref
  useEffect(() => {
    onResultRef.current = onResult
  }, [onResult])

  // 检测浏览器支持
  const isSupported =
    typeof window !== 'undefined' &&
    (typeof window.SpeechRecognition !== 'undefined' ||
      typeof window.webkitSpeechRecognition !== 'undefined')

  // 初始化 recognition 实例（只执行一次）
  useEffect(() => {
    if (!isSupported) {
      return
    }

    const SpeechRecognitionAPI =
      window.SpeechRecognition || window.webkitSpeechRecognition

    if (!SpeechRecognitionAPI) return

    const recognition = new SpeechRecognitionAPI()
    recognition.lang = 'zh-CN'
    recognition.continuous = false
    recognition.interimResults = true

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      // 获取当前最完整的识别结果（包括中间结果）
      // event.resultIndex 是本次事件开始的结果索引
      let resultText = ''
      for (let i = 0; i < event.results.length; i++) {
        resultText += event.results[i][0].transcript
      }

      // 使用 ref 调用回调（实时更新，不管是否 isFinal）
      if (resultText && onResultRef.current) {
        onResultRef.current(resultText)
      }
    }

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === 'not-allowed') {
        setError('未授权麦克风访问')
      } else if (event.error === 'no-speech') {
        // 未检测到语音，静默处理
      } else if (event.error === 'aborted') {
        // 用户中断，忽略
      } else if (event.error === 'network') {
        setError('网络错误，无法连接语音服务')
      } else {
        setError(`识别错误: ${event.error}`)
      }
      setIsListening(false)
    }

    recognition.onend = () => {
      setIsListening(false)
      setProgress(0)
      // 清除进度定时器
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
        progressTimerRef.current = null
      }
    }

    recognition.onstart = () => {
      setIsListening(true)
      setProgress(0)
      // 启动进度定时器
      const startTime = Date.now()
      progressTimerRef.current = window.setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000
        const p = Math.min(elapsed / MAX_DURATION, 1)
        setProgress(p)
        // 进度满了自动停止
        if (p >= 1) {
          // 先清除定时器，再停止识别
          if (progressTimerRef.current) {
            clearInterval(progressTimerRef.current)
            progressTimerRef.current = null
          }
          recognitionRef.current?.stop()
        }
      }, 100)
    }

    recognitionRef.current = recognition

    return () => {
      recognition.abort()
      if (progressTimerRef.current) {
        clearInterval(progressTimerRef.current)
      }
    }
  }, [isSupported, MAX_DURATION])

  const start = useCallback(() => {
    if (!recognitionRef.current) {
      return
    }
    if (isListening) {
      return
    }

    setError(null)

    try {
      recognitionRef.current.start()
    } catch {
      // 可能是之前还在运行，先停止再启动
      try {
        recognitionRef.current.stop()
        setTimeout(() => {
          recognitionRef.current?.start()
        }, 100)
      } catch {
        setError('启动语音识别失败')
      }
    }
  }, [isListening])

  const stop = useCallback(() => {
    if (!recognitionRef.current) return
    recognitionRef.current.stop()
    setIsListening(false)
    setProgress(0)
    if (progressTimerRef.current) {
      clearInterval(progressTimerRef.current)
      progressTimerRef.current = null
    }
  }, [])

  return {
    isListening,
    progress,
    start,
    stop,
    isSupported,
    error,
  }
}