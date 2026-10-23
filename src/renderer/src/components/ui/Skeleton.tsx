import React from 'react'

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string
  style?: React.CSSProperties
  className?: string
}

export default function Skeleton({
  width = '100%',
  height = '16px',
  borderRadius = 'var(--radius-md)',
  style,
  className
}: SkeletonProps) {
  const inlineStyles: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
    borderRadius,
    opacity: 0.6,
    ...style
  }

  return (
    <div
      className={`skeleton ${className ?? ''}`}
      style={inlineStyles}
      aria-hidden="true"
    />
  )
}

/** around a set of skeletons: busy to screen readers, which hear the label in their place */
export function LoadingRegion({
  label,
  children,
  style,
  className
}: {
  label: string
  children: React.ReactNode
  style?: React.CSSProperties
  className?: string
}) {
  return (
    <div role="status" aria-busy="true" className={className} style={style}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  )
}

/** a card or task drawer still loading: its title, the row of fields, the description and a short checklist */
export function DetailSkeleton({ label }: { label: string }) {
  return (
    <LoadingRegion label={label} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', padding: 'var(--space-6)' }}>
      <Skeleton height="var(--space-8)" width="70%" />
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <Skeleton height="var(--space-6)" width="6rem" borderRadius="var(--radius-full)" />
        <Skeleton height="var(--space-6)" width="5rem" borderRadius="var(--radius-full)" />
        <Skeleton height="var(--space-6)" width="7rem" borderRadius="var(--radius-full)" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <Skeleton height="var(--space-3)" width="30%" />
        <Skeleton height="8rem" />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <Skeleton height="var(--space-3)" width="25%" />
        <Skeleton height="var(--space-5)" width="85%" />
        <Skeleton height="var(--space-5)" width="70%" />
        <Skeleton height="var(--space-5)" width="78%" />
      </div>
    </LoadingRegion>
  )
}

/** a column of blocks, such as cards or rows, each the size of the real one */
export function SkeletonBlocks({
  label,
  count = 3,
  height,
  gap = 'var(--space-3)',
  style
}: {
  label: string
  count?: number
  height: string
  gap?: string
  style?: React.CSSProperties
}) {
  return (
    <LoadingRegion label={label} style={{ display: 'flex', flexDirection: 'column', gap, ...style }}>
      {Array.from({ length: count }, (_, i) => (
        <Skeleton key={i} height={height} borderRadius="var(--radius-md)" />
      ))}
    </LoadingRegion>
  )
}

// a paragraph's ragged right edge, so the lines read as text rather than bars
const LINE_WIDTHS = ['92%', '86%', '95%', '70%', '88%', '64%']

/** lines of text still on their way */
export function SkeletonLines({ label, lines = 3, style }: { label: string; lines?: number; style?: React.CSSProperties }) {
  return (
    <LoadingRegion label={label} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', ...style }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} height="var(--space-3)" width={LINE_WIDTHS[i % LINE_WIDTHS.length]} />
      ))}
    </LoadingRegion>
  )
}

/** list rows of a title over a shorter line, as notes, memories and tasks are drawn */
export function SkeletonList({ label, count = 5, style }: { label: string; count?: number; style?: React.CSSProperties }) {
  return (
    <LoadingRegion label={label} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', ...style }}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1-5)' }}>
          <Skeleton height="var(--space-3-5)" width={i % 2 ? '55%' : '68%'} />
          <Skeleton height="var(--space-2-5)" width={i % 2 ? '82%' : '74%'} />
        </div>
      ))}
    </LoadingRegion>
  )
}
