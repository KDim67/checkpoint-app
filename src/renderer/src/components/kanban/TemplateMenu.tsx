import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react'
import type { Item } from '@shared/types'
import HeaderBtn from './HeaderBtn'

interface TemplateMenuProps {
  templates: Item[]
  open: boolean
  setOpen: Dispatch<SetStateAction<boolean>>
  onPick: (template: Item) => void
}

export default function TemplateMenu({ templates, open, setOpen, onPick }: TemplateMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [setOpen])

  return (
    <div className="relative" ref={menuRef}>
      <HeaderBtn
        onClick={() => setOpen(v => !v)}
        title="Create card from a reusable template"
        icon={
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect width="18" height="18" x="3" y="3" rx="2"/>
            <path d="M9 17h6M9 13h6M9 9h6"/>
          </svg>
        }
        active={open}
      >
        From Template
      </HeaderBtn>
      
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            right: 0,
            zIndex: 100,
            background: 'var(--color-surface-elevated)',
            border: '1px solid var(--color-surface-offset)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-md)',
            minWidth: '220px',
            padding: '4px 0'
          }}
        >
          <span style={{ display: 'block', fontSize: '9px', fontWeight: 'var(--weight-bold)', color: 'var(--color-text-faint)', textTransform: 'uppercase', padding: '6px 12px 4px' }}>
            Select Template
          </span>
          {templates.map(tc => (
            <button
              key={tc.id}
              onClick={() => onPick(tc)}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontSize: 'var(--text-xs)',
                color: 'var(--color-text-base)',
                textAlign: 'left'
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-offset)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'none')}
            >
              {tc.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
