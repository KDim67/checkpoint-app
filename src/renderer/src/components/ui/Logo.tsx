import React from 'react'
import logoSvg from '../../assets/checkpoint_logo.svg'

export interface LogoProps {
  size?: number
  variant?: 'full' | 'mark'
  showText?: boolean
  className?: string
  style?: React.CSSProperties
}

export default function Logo({
  size = 28,
  variant = 'mark',
  showText = false,
  className,
  style
}: LogoProps) {
  return (
    <div
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: `${Math.max(8, size * 0.38)}px`,
        userSelect: 'none',
        ...style
      }}
    >
      <img
        src={logoSvg}
        alt="Checkpoint Logo"
        style={{
          width: `${size}px`,
          height: `${size}px`,
          objectFit: 'contain',
          flexShrink: 0,
          filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.5))'
        }}
      />

      {(showText || variant === 'full') && (
        <span
          style={{
            fontSize: `${Math.max(14, size * 0.68)}px`,
            fontWeight: 800,
            letterSpacing: '0.04em',
            color: 'var(--color-text-base)',
            fontFamily: 'var(--font-sans)',
            lineHeight: 1
          }}
        >
          Checkpoint
        </span>
      )}
    </div>
  )
}
