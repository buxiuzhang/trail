import { useEffect, useRef } from 'react'

export function useInfiniteScroll(
  fetchNextPage: () => void,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const fetchNextPageRef = useRef(fetchNextPage)
  const hasNextPageRef = useRef(hasNextPage)
  const isFetchingRef = useRef(isFetchingNextPage)
  fetchNextPageRef.current = fetchNextPage
  hasNextPageRef.current = hasNextPage
  isFetchingRef.current = isFetchingNextPage

  useEffect(() => {
    const el = sentinelRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasNextPageRef.current && !isFetchingRef.current) {
          fetchNextPageRef.current()
        }
      },
      { rootMargin: '200px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, []) // observer 只创建一次，状态通过 ref 读取

  return sentinelRef
}
