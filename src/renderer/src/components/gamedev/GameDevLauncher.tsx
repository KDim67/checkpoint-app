import React from 'react'
import { GAMEDEV_TOOLS } from './toolCatalogue'
import type { GameDevTab } from './types'

interface Props {
  onPick: (id: GameDevTab) => void
}

/**
 * The workspace with no tool open yet.
 *
 * Ten tools used to sit in three bordered clusters in a strip along the top,
 * which read as three unrelated widgets and left the rest of the window empty.
 * Here each one gets room for its name and a line saying what it does, which is
 * the question someone opening this view actually has.
 */
export default function GameDevLauncher({ onPick }: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      <style>{`
        .gamedev-launch-card {
          display: flex;
          flex-direction: column;
          gap: var(--space-2);
          align-items: flex-start;
          text-align: left;
          padding: var(--space-4);
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-lg);
          cursor: pointer;
          font-family: inherit;
          transition: background 120ms ease, border-color 120ms ease, transform 120ms ease;
        }
        .gamedev-launch-card:hover {
          background: var(--color-surface-2);
          border-color: var(--color-secondary);
          transform: translateY(-1px);
        }
        .gamedev-launch-card:focus-visible {
          outline: 2px solid var(--color-secondary);
          outline-offset: 2px;
        }
        .gamedev-launch-icon {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 34px;
          height: 34px;
          border-radius: var(--radius-md);
          background: var(--color-secondary-muted);
          color: var(--color-secondary);
        }
        @media (prefers-reduced-motion: reduce) {
          .gamedev-launch-card { transition: none; }
          .gamedev-launch-card:hover { transform: none; }
        }
      `}</style>

      {GAMEDEV_TOOLS.map(section => (
        <section key={section.group} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <h3 style={{
            margin: 0,
            fontSize: '10px',
            fontWeight: 'var(--weight-bold)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--color-text-faint)'
          }}>
            {section.group}
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 'var(--space-3)'
          }}>
            {section.tools.map(tool => (
              <button
                key={tool.id}
                type="button"
                className="gamedev-launch-card"
                onClick={() => onPick(tool.id)}
              >
                <span className="gamedev-launch-icon">{tool.icon}</span>
                <span style={{
                  fontSize: 'var(--text-sm)',
                  fontWeight: 'var(--weight-semibold)',
                  color: 'var(--color-text-base)'
                }}>
                  {tool.label}
                </span>
                <span style={{
                  fontSize: 'var(--text-xs)',
                  lineHeight: 1.5,
                  color: 'var(--color-text-muted)'
                }}>
                  {tool.blurb}
                </span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
