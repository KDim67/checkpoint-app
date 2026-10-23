/** the search at the top of Settings: while it has words in it, the matching settings stand in for the section list */

import React, { useRef, type RefObject } from 'react'
import { Search } from 'lucide-react'
import type { SettingsTab } from '../../store/appStore'

export interface SettingsResult {
  key: string
  name: string
  /** the section, and the heading inside it when there is one */
  where: string
  icon: React.ReactNode
  tab: SettingsTab
  /** the setting to land on; a whole section has none */
  under?: string
  setting: boolean
}

interface Props {
  query: string
  onQuery: (query: string) => void
  results: SettingsResult[]
  onPick: (result: SettingsResult) => void
  inputRef: RefObject<HTMLInputElement>
  /** the section list, shown while nothing is typed */
  children: React.ReactNode
}

export default function SettingsSearch({ query, onQuery, results, onPick, inputRef, children }: Props): React.JSX.Element {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const searching = query.trim() !== ''

  const onInputKey = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'ArrowDown' && results.length > 0) {
      event.preventDefault()
      buttons.current[0]?.focus()
    } else if (event.key === 'Enter' && results.length > 0) {
      event.preventDefault()
      onPick(results[0])
    }
  }

  const onResultsKey = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    const at = buttons.current.findIndex(button => button === document.activeElement)
    if (at < 0) return
    const move = (to: number): void => {
      event.preventDefault()
      buttons.current[to]?.focus()
    }
    if (event.key === 'ArrowDown') move(Math.min(at + 1, results.length - 1))
    else if (event.key === 'ArrowUp') {
      if (at === 0) {
        event.preventDefault()
        inputRef.current?.focus()
      } else move(at - 1)
    } else if (event.key === 'Home') move(0)
    else if (event.key === 'End') move(results.length - 1)
    else if (event.key.length === 1 && event.key !== ' ' && !event.ctrlKey && !event.metaKey && !event.altKey) {
      // typing goes back to the search, as in the Workspaces filter
      event.preventDefault()
      onQuery(query + event.key)
      inputRef.current?.focus()
    }
  }

  return (
    <>
      <div className="settings-search">
        <Search size={14} className="settings-search-icon" aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          className="input-base settings-search-input"
          value={query}
          onChange={event => onQuery(event.target.value)}
          onKeyDown={onInputKey}
          placeholder="Search settings"
          aria-label="Search settings"
          aria-controls={searching ? 'settings-results' : undefined}
          spellCheck={false}
        />
      </div>
      <p className="settings-announcer" role="status">
        {searching ? `${results.length === 0 ? 'No' : results.length} ${results.length === 1 ? 'setting' : 'settings'} found` : ''}
      </p>

      {!searching ? children : results.length === 0 ? (
        <p className="settings-no-results">
          Nothing matches “{query.trim()}”. Try another word for it, like theme, backup or shortcut.
        </p>
      ) : (
        <ul id="settings-results" className="settings-results" aria-label="Matching settings" onKeyDown={onResultsKey}>
          {results.map((result, index) => (
            <li key={result.key}>
              <button
                ref={el => { buttons.current[index] = el }}
                type="button"
                className="settings-result"
                // the two lines read as one name without a pause between them
                aria-label={`${result.name}, ${result.where}`}
                onClick={() => onPick(result)}
              >
                <span className="settings-result-icon" aria-hidden="true">{result.icon}</span>
                <span className="settings-result-text">
                  <span className="settings-result-name">{result.name}</span>
                  <span className="settings-result-where">{result.where}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
