
/**
 * The focus view's own classes. Drawn with the view rather than kept in
 * index.css, because `.btn-ghost` here is not the global one and should only
 * win while this view is on screen.
 */
export default function FocusStyles() {
  return (
    <style>{`
      .glass-panel {
        background: var(--color-surface-1);
        border: 1px solid var(--color-surface-offset);
        border-radius: var(--radius-lg);
        padding: var(--space-4);
        transition: all var(--duration-normal) var(--ease-default);
      }
      .glass-panel:hover {
        border-color: var(--color-balance);
      }
      .task-row {
        display: flex;
        align-items: center;
        gap: var(--space-3);
        padding: var(--space-3);
        border-radius: var(--radius-md);
        background: var(--color-surface-2);
        border: 1px solid var(--color-surface-offset);
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-default);
      }
      .task-row:hover {
        background: var(--color-surface-offset);
        border-color: var(--color-balance);
        transform: translateX(2px);
      }
      .task-row.selected {
        border-color: var(--color-secondary);
        background: var(--color-secondary-muted);
      }
      .btn-volt {
        background: var(--color-secondary);
        color: var(--color-text-inverted);
        border: none;
        font-weight: var(--weight-bold);
        border-radius: var(--radius-md);
        padding: 8px 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: var(--space-2);
        transition: transform var(--duration-fast) var(--ease-default), filter var(--duration-fast) var(--ease-default);
      }
      .btn-volt:hover:not(:disabled) {
        filter: brightness(1.1);
        transform: translateY(-1px);
      }
      .btn-volt:active:not(:disabled) {
        transform: translateY(0);
      }
      .btn-volt:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      .btn-ghost {
        background: transparent;
        border: 1px solid var(--color-surface-offset);
        color: var(--color-text-muted);
        border-radius: var(--radius-md);
        padding: 8px 16px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: var(--space-2);
        font-size: var(--text-sm);
        font-weight: var(--weight-medium);
        transition: all var(--duration-fast) var(--ease-default);
      }
      .btn-ghost:hover {
        border-color: var(--color-balance);
        color: var(--color-text-base);
        background: var(--color-surface-2);
      }
      .priority-badge {
        font-size: var(--text-2xs);
        text-transform: uppercase;
        font-weight: var(--weight-bold);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }
      .tag-badge {
        font-size: var(--text-2xs);
        padding: 2px 6px;
        border-radius: var(--radius-sm);
      }
      .retro-checkbox {
        width: 20px;
        height: 20px;
        border-radius: var(--radius-sm);
        border: 1.5px solid var(--color-balance);
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        transition: all var(--duration-fast) var(--ease-default);
        flex-shrink: 0;
      }
      .retro-checkbox.checked {
        background: var(--color-secondary);
        border-color: var(--color-secondary);
        color: var(--color-text-inverted);
      }
      .quick-add-input {
        flex: 1;
        background: var(--color-surface-2);
        border: 1px solid var(--color-surface-offset);
        border-radius: var(--radius-md);
        color: var(--color-text-base);
        padding: 8px 12px;
        font-size: var(--text-sm);
        outline: none;
        transition: border-color var(--duration-fast) var(--ease-default);
      }
      .quick-add-input:focus {
        border-color: var(--color-secondary);
      }
      .cycle-dot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        background: var(--color-surface-offset);
        transition: background var(--duration-fast) var(--ease-default);
      }
      .cycle-dot.filled {
        background: var(--color-secondary);
      }
      .timer-ring-active {
        animation: breathe 4s ease-in-out infinite;
      }
    `}</style>
  )
}
