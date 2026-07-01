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
  borderRadius = 'var(--radius-md, 6px)',
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
