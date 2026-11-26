import React from 'react'

interface LogoProps {
  size?: number
  variant?: 'full' | 'mark'
  showText?: boolean
  className?: string
  style?: React.CSSProperties
}

export function Wordmark({
  height = 15,
  className,
  style
}: {
  height?: number
  className?: string
  style?: React.CSSProperties
}) {
  const width = Math.round(height * (822 / 130) * 10) / 10
  return (
    <svg
      role="img"
      aria-label="Checkpoint"
      viewBox="270 313 822 130"
      width={width}
      height={height}
      className={className}
      style={{
        display: 'block',
        height: `${height}px`,
        width: 'auto',
        flexShrink: 0,
        ...style
      }}
    >
      <g fill="var(--color-text-base)">
        <polyline points="638.52 424.05 689.63 424.05 653.7 387.34 687.75 355.92 638.52 355.92" />
        <rect x="1058.86" y="355.32" width="15.45" height="16.99" />
        <rect x="1074.31" y="355.32" width="15.45" height="16.99" />
        <rect x="1043.42" y="355.41" width="15.45" height="16.99" />
        <rect x="1043.42" y="338.42" width="15.45" height="16.99" />
        <rect x="902.02" y="354.97" width="15.45" height="17.21" />
        <rect x="1043.42" y="372.4" width="15.45" height="16.99" />
        <rect x="1043.42" y="389.39" width="15.45" height="16.99" />
        <rect x="1043.42" y="406.37" width="15.45" height="16.99" />
        <rect x="1058.86" y="406.37" width="15.45" height="16.99" />
        <rect x="1074.31" y="406.37" width="15.45" height="16.99" />
        <rect x="994.97" y="406.37" width="15.45" height="16.99" />
        <rect x="994.97" y="389.39" width="15.45" height="16.99" />
        <rect x="994.97" y="372.4" width="15.45" height="16.99" />
        <path d="M994.97,355.41h7.2c4.55,0,8.25,3.7,8.25,8.25v8.74h-15.45v-16.99h0Z" />
        <rect x="979.52" y="355.41" width="15.45" height="16.99" />
        <rect x="964.07" y="355.41" width="15.45" height="16.99" />
        <rect x="948.62" y="355.41" width="15.45" height="16.99" />
        <rect x="948.62" y="372.4" width="15.45" height="16.99" />
        <rect x="948.62" y="389.39" width="15.45" height="16.99" />
        <rect x="948.62" y="406.37" width="15.45" height="16.99" />
        <rect x="406.8" y="406.9" width="15.45" height="16.99" />
        <rect x="406.8" y="389.92" width="15.45" height="16.99" />
        <rect x="406.8" y="373.02" width="15.45" height="16.99" />
        <rect x="360.45" y="373.02" width="15.45" height="16.99" />
        <path d="M406.8,355.94h7.2c4.55,0,8.25,3.7,8.25,8.25v8.74h-15.45v-16.99h0Z" />
        <rect x="391.35" y="355.94" width="15.45" height="16.99" />
        <rect x="375.9" y="355.94" width="15.45" height="16.99" />
        <rect x="360.45" y="339.05" width="15.45" height="16.99" />
        <rect x="360.45" y="356.03" width="15.45" height="16.99" />
        <rect x="360.45" y="389.92" width="15.45" height="16.99" />
        <rect x="360.45" y="406.9" width="15.45" height="16.99" />
        <rect x="592.17" y="356.01" width="15.45" height="16.99" />
        <rect x="576.73" y="356.01" width="15.45" height="16.99" />
        <rect x="561.28" y="356.01" width="15.45" height="16.99" />
        <path d="M554.06,355.9h7.22v16.99h-15.45v-8.76c0-4.54,3.69-8.23,8.23-8.23Z" />
        <rect x="545.83" y="372.88" width="15.45" height="16.99" />
        <rect x="545.83" y="389.87" width="15.45" height="16.99" />
        <rect x="576.73" y="406.97" width="15.45" height="16.99" />
        <rect x="561.28" y="406.86" width="15.45" height="16.99" />
        <rect x="592.17" y="406.97" width="15.45" height="16.99" />
        <path d="M545.83,406.86h15.45v16.99h-7.19c-4.56,0-8.26-3.7-8.26-8.26v-8.73h0Z" />
        <path d="M499.49,355.94h7.18c4.56,0,8.27,3.71,8.27,8.27v8.72h-15.45v-16.99h0Z" />
        <rect x="484.04" y="355.94" width="15.45" height="16.99" />
        <rect x="468.59" y="355.94" width="15.45" height="16.99" />
        <path d="M461.32,356.08h7.27v16.99h-15.45v-8.81c0-4.52,3.67-8.18,8.18-8.18Z" />
        <rect x="453.14" y="373.07" width="15.45" height="16.99" />
        <rect x="453.14" y="390.05" width="15.45" height="16.99" />
        <rect x="484.04" y="408.58" width="15.45" height="15.45" />
        <rect x="468.59" y="408.58" width="15.45" height="15.45" />
        <rect x="499.49" y="408.58" width="15.45" height="15.45" />
        <rect x="499.49" y="372.84" width="15.45" height="16.99" />
        <rect x="468.59" y="372.84" width="15.45" height="16.99" />
        <rect x="484.04" y="372.84" width="15.45" height="16.99" />
        <path d="M453.14,407.04h15.45v16.99h-7.2c-4.55,0-8.25-3.7-8.25-8.25v-8.74h0Z" />
        <rect x="302.37" y="339.05" width="15.45" height="16.95" />
        <rect x="317.81" y="339.05" width="15.45" height="16.95" />
        <rect x="286.92" y="339.05" width="15.45" height="16.95" />
        <rect x="271.47" y="356" width="15.45" height="16.95" />
        <path d="M279.71,339.05h7.21v16.95h-15.45v-8.71c0-4.55,3.69-8.24,8.24-8.24Z" />
        <rect x="271.47" y="372.95" width="15.45" height="16.95" />
        <rect x="271.47" y="389.9" width="15.45" height="16.95" />
        <rect x="286.92" y="406.85" width="15.45" height="16.95" />
        <rect x="302.37" y="406.85" width="15.45" height="16.95" />
        <rect x="317.81" y="406.85" width="15.45" height="16.95" />
        <path d="M271.47,406.85h15.45v16.95h-7.19c-4.56,0-8.25-3.7-8.25-8.25v-8.7h0Z" />
        <path d="M851.84,406.97h15.45v8.78c0,4.53-3.68,8.21-8.21,8.21h-7.24v-16.99h0Z" />
        <rect x="836.39" y="406.97" width="15.45" height="16.99" />
        <rect x="820.94" y="406.97" width="15.45" height="16.99" />
        <rect x="851.84" y="389.99" width="15.45" height="16.99" />
        <rect x="851.84" y="373" width="15.45" height="16.99" />
        <path d="M851.84,356.01h7.21c4.55,0,8.24,3.69,8.24,8.24v8.75h-15.45v-16.99h0Z" />
        <rect x="836.39" y="356.01" width="15.45" height="16.99" />
        <rect x="820.94" y="356.01" width="15.45" height="16.99" />
        <path d="M813.74,356.01h7.2v16.99h-15.45v-8.74c0-4.55,3.7-8.25,8.25-8.25Z" />
        <rect x="805.49" y="373" width="15.45" height="16.99" />
        <rect x="805.49" y="389.99" width="15.45" height="16.99" />
        <rect x="805.49" y="406.97" width="15.45" height="16.99" />
        <path d="M759.15,406.97h15.45v8.78c0,4.53-3.68,8.21-8.21,8.21h-7.24v-16.99h0Z" />
        <rect x="743.7" y="406.97" width="15.45" height="16.99" />
        <rect x="728.25" y="406.97" width="15.45" height="16.99" />
        <rect x="759.15" y="373" width="15.45" height="16.99" />
        <rect x="759.15" y="389.99" width="15.45" height="16.99" />
        <path d="M759.15,356.01h7.21c4.55,0,8.24,3.69,8.24,8.24v8.75h-15.45v-16.99h0Z" />
        <rect x="743.7" y="356.01" width="15.45" height="16.99" />
        <rect x="728.25" y="356.01" width="15.45" height="16.99" />
        <path d="M721.05,356.01h7.2v16.99h-15.45v-8.74c0-4.55,3.7-8.25,8.25-8.25Z" />
        <rect x="712.81" y="373" width="15.45" height="16.99" />
        <rect x="712.81" y="389.99" width="15.45" height="16.99" />
        <rect x="712.81" y="406.97" width="15.45" height="16.99" />
        <rect x="712.81" y="424.05" width="15.45" height="16.99" />
        <rect x="902.02" y="372.18" width="15.45" height="17.21" />
        <rect x="902.02" y="389.39" width="15.45" height="17.21" />
        <rect x="902.02" y="406.59" width="15.45" height="17.21" />
        <rect x="638.52" y="373" width="15.45" height="16.99" />
        <rect x="638.52" y="356.19" width="15.45" height="16.99" />
        <rect x="638.52" y="389.99" width="15.45" height="16.99" />
        <rect x="638.52" y="406.97" width="15.45" height="16.99" />
        <rect x="1027.97" y="355.32" width="15.45" height="16.99" />
      </g>
      <polygon fill="var(--color-secondary)" points="917.46 314.66 897.41 327.69 917.46 340.72" />
    </svg>
  )
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
      <svg
        role="img"
        aria-label="Checkpoint Logo"
        viewBox="498 206 370 370"
        width={size}
        height={size}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          flexShrink: 0,
          display: 'block',
          filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.22))'
        }}
      >
        <g fill="var(--color-text-base)">
          <rect x="787.99" y="209.72" width="66.27" height="364.66" />
          <polygon points="511.74 501.51 731.02 501.32 578.01 355.3 731.02 209.25 511.74 209.72 511.74 501.51" />
        </g>
        <polygon fill="var(--color-secondary)" points="787.62 209.35 634.61 355.12 787.62 501.14" />
      </svg>

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
