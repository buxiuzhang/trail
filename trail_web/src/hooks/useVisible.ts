import { useEffect, useRef, useState } from 'react'

/**
 * 元素进入视口时返回 true，之后永远保持 true（fire-once）。
 * rootMargin 默认提前 400px 预加载，避免滚动时内容闪出。
 */
export function useVisible(rootMargin = '400px'): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement>(null!)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true)
          observer.disconnect()
        }
      },
      { rootMargin },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [rootMargin])

  return [ref, visible]
}
