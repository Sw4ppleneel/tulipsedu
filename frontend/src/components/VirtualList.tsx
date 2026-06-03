import { useState } from 'preact/hooks'
import type { VNode } from 'preact'

interface Props<T> {
  items: T[]
  rowHeight: number
  containerHeight: number
  renderRow: (item: T, index: number) => VNode
  keyFn: (item: T) => string
}

const BUFFER = 4

export function VirtualList<T>({
  items,
  rowHeight,
  containerHeight,
  renderRow,
  keyFn,
}: Props<T>) {
  const [scrollTop, setScrollTop] = useState(0)

  const visibleCount = Math.ceil(containerHeight / rowHeight)
  const startIdx = Math.max(0, Math.floor(scrollTop / rowHeight) - BUFFER)
  const endIdx = Math.min(items.length, startIdx + visibleCount + BUFFER * 2)

  return (
    <div
      style={{ height: containerHeight, overflowY: 'auto', position: 'relative' }}
      onScroll={(e) => setScrollTop((e.currentTarget as HTMLElement).scrollTop)}
    >
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {items.slice(startIdx, endIdx).map((item, i) => (
          <div
            key={keyFn(item)}
            style={{
              position: 'absolute',
              top: (startIdx + i) * rowHeight,
              left: 0,
              right: 0,
              height: rowHeight,
              willChange: 'transform',
            }}
          >
            {renderRow(item, startIdx + i)}
          </div>
        ))}
      </div>
    </div>
  )
}
