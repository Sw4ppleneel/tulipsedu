import { useEffect, useState } from 'preact/hooks'

// One breakpoint for the whole app. At or below it (phones, narrow windows) views
// switch to stacked/card layouts; anything wider keeps the dense desktop tables.
// Kept as a hook (not CSS) because the table rows are inline-styled and inline
// styles can't carry @media queries.
export function useIsMobile(breakpoint = 640): boolean {
  const query = `(max-width: ${breakpoint}px)`
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setIsMobile(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return isMobile
}
