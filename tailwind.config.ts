import type { Config } from 'tailwindcss'

export default {
  content: [
    './src/renderer/src/**/*.{ts,tsx}',
    './src/renderer/index.html'
  ],
  theme: {
    extend: {
      colors: {
        background:       'var(--color-background)',
        surface: {
          1:        'var(--color-surface-1)',
          2:        'var(--color-surface-2)',
          offset:   'var(--color-surface-offset)',
          elevated: 'var(--color-surface-elevated)'
        },
        primary: {
          DEFAULT: 'var(--color-primary)',
          hover:   'var(--color-primary-hover)',
          muted:   'var(--color-primary-muted)'
        },
        secondary: {
          DEFAULT: 'var(--color-secondary)',
          muted:   'var(--color-secondary-muted)'
        },
        balance:  'var(--color-balance)',
        success:  'var(--color-success)',
        warning:  'var(--color-warning)',
        error:    'var(--color-error)',
        text: {
          base:     'var(--color-text-base)',
          muted:    'var(--color-text-muted)',
          faint:    'var(--color-text-faint)',
          inverted: 'var(--color-text-inverted)'
        }
      },
      fontFamily: {
        sans: ['Inter', 'SF Pro Display', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Cascadia Code', 'ui-monospace', 'monospace']
      },
      borderRadius: {
        sm:   'var(--radius-sm)',
        md:   'var(--radius-md)',
        lg:   'var(--radius-lg)',
        xl:   'var(--radius-xl)',
        full: '9999px'
      },
      boxShadow: {
        sm:  'var(--shadow-sm)',
        md:  'var(--shadow-md)',
        lg:  'var(--shadow-lg)',
        hud: 'var(--shadow-hud)'
      },
      transitionDuration: {
        instant: 'var(--duration-instant)',
        fast:    'var(--duration-fast)',
        normal:  'var(--duration-normal)',
        slow:    'var(--duration-slow)'
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '1rem' }],
        xs:    ['0.75rem',  { lineHeight: '1rem' }],
        sm:    ['0.875rem', { lineHeight: '1.25rem' }],
        base:  ['1rem',     { lineHeight: '1.5rem' }],
        lg:    ['1.125rem', { lineHeight: '1.75rem' }],
        xl:    ['1.25rem',  { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem',   { lineHeight: '2rem' }]
      }
    }
  },
  plugins: []
} satisfies Config
