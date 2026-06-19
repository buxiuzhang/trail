import { useCallback, useRef } from 'react'

export function useInfiniteScroll(
  fetchNextPage: () => void,
  hasNextPage: boolean,
  isFetchingNextPage: boolean,
) {
  const fetchNextPageRef = useRef(fetchNextPage)
  const hasNextPageRef = useRef(hasNextPage)
  const isFetchingRef = useRef(isFetchingNextPage)
  fetchNextPageRef.current = fetchNextPage
  hasNextPageRef.current = hasNextPage
  isFetchingRef.current = isFetchingNextPage

  const sentinelRef = useCallback((el: HTMLDivElement | null) => {
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
  }, [])

  return sentinelRef
}
