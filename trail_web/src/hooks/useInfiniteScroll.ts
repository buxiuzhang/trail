import { useCallback, useEffect, useRef } from 'react'

export function useInfiniteScroll(
  fetchNextPage: () => void,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
) {
  const fetchNextPageRef = useRef(fetchNextPage)
  const hasNextPageRef = useRef(hasNextPage)
  const isFetchingRef = useRef(isFetchingNextPage)
  const isIntersectingRef = useRef(false)
  fetchNextPageRef.current = fetchNextPage
  hasNextPageRef.current = hasNextPage
  isFetchingRef.current = isFetchingNextPage

  // sentinel 始终在视口内时（如紧凑列表模式），IntersectionObserver 仅首次交叉触发一次。
  // 每次 fetch 完成后，若 sentinel 仍在视口内且还有下一页，继续拉取。
  useEffect(() => {
    if (!isFetchingNextPage && hasNextPage && isIntersectingRef.current) {
      fetchNextPageRef.current()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFetchingNextPage, hasNextPage])

  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        isIntersectingRef.current = entry.isIntersecting
        if (entry.isIntersecting && hasNextPageRef.current && !isFetchingRef.current) {
          fetchNextPageRef.current()
        }
      },
      { rootMargin: '200px 0px' }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  return sentinelRef
}
