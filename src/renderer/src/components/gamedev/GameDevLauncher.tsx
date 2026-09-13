import React from 'react'
import { GAMEDEV_TOOLS, findTool } from './toolCatalogue'
import type { GameDevTab } from './types'

interface Props {
  onPick: (id: GameDevTab) => void
  /** most recent first */
  recent: GameDevTab[]
}

/** each tool gets its name and what it does; the old strip read as three unrelated widgets */
export default function GameDevLauncher({ onPick, recent }: Props) {
  const recentTools = recent.map(findTool).filter(t => t !== undefined)
  return (
    // capped and centred, a full-width grid left ten cards in four of seven tracks
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 'var(--space-6)',
      width: '100%', maxWidth: 'var(--gamedev-launcher-max)',
      // auto margins centre it when tall and collapse when short
      margin: 'auto'
    }}>
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
          min-height: 132px;
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
        .gamedev-recent-chip {
          display: flex;
          align-items: center;
          gap: var(--space-2);
          padding: var(--space-2) var(--space-3);
          background: var(--color-surface-1);
          border: 1px solid var(--color-surface-offset);
          border-radius: var(--radius-full);
          color: var(--color-text-base);
          font-size: var(--text-xs);
          font-weight: var(--weight-medium);
          font-family: inherit;
          cursor: pointer;
          transition: border-color 120ms ease, background 120ms ease;
        }
        .gamedev-recent-chip:hover {
          background: var(--color-surface-2);
          border-color: var(--color-secondary);
        }
        /* A fixed count rather than auto-fill, which reserved a track for every
           240px the window had going and left most of a wide row empty. */
        .gamedev-launcher-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: var(--space-3);
        }
        @media (max-width: 1100px) {
          .gamedev-launcher-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 820px) {
          .gamedev-launcher-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
        }
        @media (max-width: 560px) {
          .gamedev-launcher-grid { grid-template-columns: 1fr; }
        }
        @media (prefers-reduced-motion: reduce) {
          .gamedev-launch-card { transition: none; }
          .gamedev-launch-card:hover { transform: none; }
        }
      `}</style>

      {/* title here so it centres with the block */}
      <div>
        <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-bold)', margin: '0 0 var(--space-1)' }}>
          Game Development Workspace
        </h2>
        <p className="text-hint-flush">
          Texture authoring, sprite pipeline and narrative tools. All processing runs locally.
        </p>
      </div>

      {recentTools.length > 0 && (
        <section className="col-md">
          <h3 style={{
            margin: 0,
            fontSize: '10px',
            fontWeight: 'var(--weight-bold)',
            textTransform: 'uppercase',
            letterSpacing: '0.07em',
            color: 'var(--color-text-faint)'
          }}>
            Recent
          </h3>
          <div className="flex-wrap-gap">
            {recentTools.map(tool => (
              <button
                key={tool.id}
                type="button"
                className="gamedev-recent-chip"
                onClick={() => onPick(tool.id)}
              >
                <span style={{ color: 'var(--color-secondary)', display: 'flex' }}>{tool.icon}</span>
                {tool.label}
              </button>
            ))}
          </div>
        </section>
      )}

      {GAMEDEV_TOOLS.map(section => (
        <section key={section.group} className="col-md">
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
          <div className="gamedev-launcher-grid">
            {section.tools.map(tool => (
              <button
                key={tool.id}
                type="button"
                className="gamedev-launch-card"
                onClick={() => onPick(tool.id)}
              >
                <span className="gamedev-launch-icon">{tool.icon}</span>
                <span className="text-item-strong">
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
