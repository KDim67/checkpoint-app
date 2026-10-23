import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Settings, Layers, Sparkles, Palette, Paintbrush, Monitor, Zap, Info, RefreshCw, Layout, Archive, Keyboard, Boxes, HardDrive, Plug, Bell, PanelTop, Link2, X } from 'lucide-react'
import SettingsSection, { Divider } from './settings/SettingsSection'
import SyncSettings from './settings/SyncSettings'
import NotificationSettings from './settings/NotificationSettings'
import StartupSettings from './settings/StartupSettings'
import McpSettings from './settings/McpSettings'
import ConnectionsSettings from './settings/ConnectionsSettings'
import AppearanceSettings from './settings/AppearanceSettings'
import FeatureToggleCenter from './settings/FeatureToggleCenter'
import AboutPanel from './settings/AboutPanel'
import ThemeCustomizer from './settings/ThemeCustomizer'
import HotkeyBinder from './settings/HotkeyBinder'
import ExtensionsTab from './settings/ExtensionsTab'
import SettingsSearch, { type SettingsResult } from './settings/SettingsSearch'
import { useSettingsParts } from './settings/useSettingsParts'
import { useAppStore } from '../store/appStore'
import { useAiEnabled } from '../lib/useAiEnabled'
import type { ActiveView, SettingsTab } from '../store/appStore'
import { SECTION_TERMS, SETTINGS_ENTRIES, searchSettings, type SettingsEntry } from '../lib/settingsSearch'
import { revealWhenShown } from '../lib/settingsReveal'
import { SETTING_REVEAL_WAIT_MS } from '../lib/timings'
import * as appApi from '../data/app'
import KanbanSettings from './settings/KanbanSettings'
import { workspaceName } from '../lib/createWorkspace'
import WidgetSettings from './settings/WidgetSettings'
import AiSettings from './settings/AiSettings'
import ThemeModeSettings from './settings/ThemeModeSettings'
import GeneralSettings from './settings/GeneralSettings'
import BackupSettings from './settings/BackupSettings'
import StorageSettings from './settings/StorageSettings'
import { withViewTransition } from '../lib/viewTransition'

interface TabInfo {
  id: SettingsTab
  label: string
  icon: React.ReactNode
  description: string
}

const TAB_GROUPS: { group: string; tabs: TabInfo[] }[] = [
  {
    group: 'Application',
    tabs: [
      { id: 'general',    label: 'General',            icon: <Settings size={14} />, description: 'What Checkpoint opens with, and how it sits on your desktop.' },
      { id: 'appearance', label: 'Appearance', icon: <Palette size={14} />, description: 'Light or dark, text size, density, and colours of your own.' }
    ]
  },
  {
    group: 'Workspace',
    tabs: [
      { id: 'workspaces', label: 'Board',              icon: <Layers size={14} />,   description: 'The columns on your board. Workspaces themselves are on the Workspaces page.' },
      { id: 'ai',       label: 'AI Assistant',       icon: <Sparkles size={14} />, description: 'The model the assistant uses, how your emails sound, and what it remembers.' },
      { id: 'connections', label: 'Connections',      icon: <Link2 size={14} />,    description: 'Keep cards in step with services you use, such as GitHub issues.' }
    ]
  },
  {
    group: 'System',
    tabs: [
      { id: 'hotkeyBinder', label: 'Shortcuts & Mouse', icon: <Keyboard size={14} />, description: 'Change the keyboard shortcuts, and what the mouse buttons do on the Wall.' },
      { id: 'features',     label: 'Features & Plugins', icon: <Zap size={14} />,      description: 'Turn parts of Checkpoint on or off, and add plugins.' },
      { id: 'notifications', label: 'Notifications',      icon: <Bell size={14} />,     description: 'What Checkpoint tells you about, and when it stays quiet.' },
      { id: 'backup',       label: 'Database Backup',    icon: <Archive size={14} />,  description: 'Copies of your data made on a schedule, and the way back to any of them.' },
      { id: 'storage',      label: 'Storage & Export',    icon: <HardDrive size={14} />, description: 'Export your data, and see and tidy the files attached to it.' },
      { id: 'sync',         label: 'Device Sync',        icon: <RefreshCw size={14} />, description: 'Keep your own machines in step. Sharing a board with someone else is Share, on the board.' },
      { id: 'mcp',          label: 'MCP Server',         icon: <Plug size={14} />,      description: 'Let external AI agents read and edit Checkpoint over a local connection.' },
      { id: 'about',        label: 'About',              icon: <Info size={14} />,     description: 'The version you have, updates, logs, and what changed.' }
    ]
  }
]

const ALL_TABS: TabInfo[] = TAB_GROUPS.flatMap(g => g.tabs)

// pre-merge tab ids still navigable from anywhere
const LEGACY_TAB_ALIASES: Record<string, SettingsTab> = {
  kanban: 'workspaces',
  themeCustomizer: 'appearance',
  extensions: 'features',
  widget: 'general'
}

/** a long list of matches is a sign to type more, not to scroll */
const MAX_RESULTS = 30

interface Findable extends SettingsEntry {
  setting: boolean
}

const tabNamed = (tab: SettingsTab): TabInfo | undefined => ALL_TABS.find(t => t.id === tab)
const groupOf = (tab: SettingsTab): string => TAB_GROUPS.find(g => g.tabs.some(t => t.id === tab))?.group ?? ''
const whereOf = (entry: SettingsEntry): string => `${tabNamed(entry.tab)?.label ?? ''} ${entry.under ?? ''}`

function tabContent(tab: SettingsTab, isWindows: boolean, activeWorkspace: string, boardName: string, setView: (view: ActiveView) => void): React.ReactNode {
  switch (tab) {
    case 'general':
      return (
        <>
          <SettingsSection icon={<Settings size={14} />} title="Startup" description="What Checkpoint opens with.">
            <GeneralSettings />
          </SettingsSection>
          {isWindows && (
            <SettingsSection icon={<PanelTop size={14} />} title="Tray & Windows Startup" description="The notification-area icon, and what happens when you sign in or close the window.">
              <StartupSettings />
            </SettingsSection>
          )}
          {isWindows && (
            <SettingsSection icon={<Monitor size={14} />} title="Desktop Widget" description="A small always-on-top list of your tasks, over every other window.">
              <WidgetSettings />
            </SettingsSection>
          )}
        </>
      )
    case 'workspaces':
      return (
        <>
          <SettingsSection icon={<Layers size={14} />} title="Workspaces" description="Each one keeps its own board, log and notes.">
            {/* they moved to their own page, the logo at the top of the sidebar */}
            <button type="button" className="btn-secondary" onClick={() => setView('workspaces')}>
              Open the Workspaces page
            </button>
          </SettingsSection>
          <SettingsSection icon={<Layout size={14} />} title="Kanban Columns" description={`The columns on the ${boardName} board, and how many cards each may hold.`}>
            <KanbanSettings activeWorkspace={activeWorkspace} />
          </SettingsSection>
        </>
      )
    // these draw their own cards, one for each part
    case 'ai':
      return <AiSettings />
    case 'connections':
      return <ConnectionsSettings />
    case 'appearance':
      return (
        <>
          <SettingsSection icon={<Palette size={14} />} title="Interface" description="Light or dark, text size and density.">
            <div className="col-xl">
              <ThemeModeSettings />
              <Divider />
              <AppearanceSettings />
            </div>
          </SettingsSection>
          <SettingsSection icon={<Paintbrush size={14} />} title="Theme Builder" description="Colours and a font of your own, over the theme above.">
            <ThemeCustomizer />
          </SettingsSection>
        </>
      )
    case 'hotkeyBinder':
      return <HotkeyBinder />
    case 'features':
      return (
        <>
          <FeatureToggleCenter />
          <SettingsSection icon={<Boxes size={14} />} title="Plugins" description="Scripts of your own from the plugins folder, each in its own sandbox.">
            <ExtensionsTab />
          </SettingsSection>
        </>
      )
    case 'backup':
      return <BackupSettings />
    case 'storage':
      return <StorageSettings />
    case 'sync':
      return <SyncSettings />
    case 'notifications':
      return <NotificationSettings />
    case 'mcp':
      return <McpSettings />
    case 'about':
      return <AboutPanel />
    default:
      return null
  }
}

export default function SettingsView() {
  const rawTab = useAppStore(s => s.settingsTab)
  const setActiveTab = useAppStore(s => s.setSettingsTab)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const workspaceList = useAppStore(s => s.workspaceList)
  const boardName = workspaceName(activeWorkspace, workspaceList)
  const setView = useAppStore(s => s.setView)
  const goBack = useAppStore(s => s.goBack)
  const isWindows = appApi.platform() === 'win32'
  const aiEnabled = useAiEnabled()

  const activeTab: SettingsTab = (LEGACY_TAB_ALIASES[rawTab as string] ?? rawTab) as SettingsTab

  const rootRef = useRef<HTMLDivElement>(null)
  const scrollerRef = useRef<HTMLDivElement>(null)
  const headRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [scrolled, setScrolled] = useState(false)
  const { parts, current, jump } = useSettingsParts(scrollerRef, headRef, activeTab)
  // a section's part names, kept after you leave it so its list can fold shut instead of vanishing
  const [remembered, setRemembered] = useState<Partial<Record<SettingsTab, string[]>>>({})
  useEffect(() => {
    if (parts.length < 2) return
    const labels = parts.map(part => part.label)
    setRemembered(previous => (JSON.stringify(previous[activeTab]) === JSON.stringify(labels) ? previous : { ...previous, [activeTab]: labels }))
  }, [parts, activeTab])

  // kept apart from the search and the jump links, so typing or scrolling never redraws every setting
  const content = useMemo(() => tabContent(activeTab, isWindows, activeWorkspace, boardName, setView), [activeTab, isWindows, activeWorkspace, boardName, setView])

  const findable = useMemo<Findable[]>(() => [
    ...ALL_TABS.filter(tab => tab.id !== 'ai' || aiEnabled).map(tab => ({ name: tab.label, tab: tab.id, terms: SECTION_TERMS[tab.id], setting: false })),
    ...SETTINGS_ENTRIES.filter(e => (isWindows || !e.windowsOnly) && (aiEnabled || !e.needsAi)).map(e => ({ ...e, setting: true }))
  ], [aiEnabled, isWindows])

  const results = useMemo<SettingsResult[]>(() => searchSettings(findable, query, whereOf).slice(0, MAX_RESULTS).map(found => {
    const tab = tabNamed(found.tab)
    return {
      key: `${found.setting ? 'setting' : 'section'}:${found.tab}:${found.under ?? ''}:${found.name}`,
      name: found.name,
      where: found.setting ? [tab?.label, found.under].filter(Boolean).join(' · ') : groupOf(found.tab),
      icon: tab?.icon,
      tab: found.tab,
      under: found.under,
      setting: found.setting
    }
  }), [findable, query])

  // a search still looking for its setting, and the section it opened
  const reveal = useRef<{ tab: SettingsTab; stop: () => void } | null>(null)
  const stopRevealing = useCallback(() => {
    reveal.current?.stop()
    reveal.current = null
  }, [])

  const pick = (result: SettingsResult): void => {
    stopRevealing()
    setQuery('')
    setActiveTab(result.tab)
    // the result that had focus is gone; the section's title takes it until the setting does
    headingRef.current?.focus({ preventScroll: true })
    const scroller = scrollerRef.current
    if (result.setting && scroller) {
      reveal.current = { tab: result.tab, stop: revealWhenShown(scroller, result.name, result.under, SETTING_REVEAL_WAIT_MS) }
    }
  }

  // each section opens at its top, before anything is drawn there
  useLayoutEffect(() => {
    scrollerRef.current?.scrollTo({ top: 0, behavior: 'instant' })
  }, [activeTab])

  // another section opened by hand while a search was still looking
  useEffect(() => {
    if (reveal.current && reveal.current.tab !== activeTab) stopRevealing()
  }, [activeTab, stopRevealing])
  useEffect(() => stopRevealing, [stopRevealing])

  // arriving puts focus here, so Escape works before anything is clicked
  useEffect(() => {
    rootRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const root = rootRef.current
      const target = event.target as HTMLElement
      if (!root || !(root.contains(target) || target === document.body) || event.defaultPrevented) return
      // a dialog, menu or picker open here takes its own keys
      if (document.querySelector('[role="dialog"]') || target.closest('[role="menu"], [role="listbox"]')) return
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        // Escape empties the search first, then goes back
        if (query) {
          setQuery('')
          searchRef.current?.focus()
        } else withViewTransition(goBack)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goBack, query])

  // AI switched off while its tab is open would leave a dead panel
  useEffect(() => {
    if (!aiEnabled && activeTab === 'ai') setActiveTab('general')
  }, [aiEnabled, activeTab, setActiveTab])

  const activeTabInfo = ALL_TABS.find(t => t.id === activeTab)

  return (
    <div ref={rootRef} className="settings-view" tabIndex={-1}>
      <nav aria-label="Settings sections" style={{
        width: 'var(--settings-nav-width)',
        flexShrink: 0,
        borderRight: '1px solid var(--color-surface-offset)',
        background: 'var(--color-surface-1)',
        padding: 'var(--space-4) var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-1)',
        overflowY: 'auto'
      }}>
        <div style={{
          fontSize: 'var(--text-xs)',
          fontWeight: 'var(--weight-bold)',
          color: 'var(--color-text-faint)',
          textTransform: 'uppercase',
          letterSpacing: 'var(--tracking-wide)',
          padding: 'var(--space-2) var(--space-2)',
          marginBottom: 'var(--space-1)'
        }}>
          Settings
        </div>
        <SettingsSearch query={query} onQuery={setQuery} results={results} onPick={pick} inputRef={searchRef}>
          {TAB_GROUPS.map(group => (
            <div key={group.group} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-0-5)', marginBottom: 'var(--space-3)' }}>
              <div style={{
                fontSize: 'var(--text-2xs)',
                fontWeight: 'var(--weight-bold)',
                color: 'var(--color-text-faint)',
                textTransform: 'uppercase',
                letterSpacing: 'var(--tracking-wider)',
                padding: '0 var(--space-3) var(--space-1)'
              }}>
                {group.group}
              </div>
              {group.tabs.filter(tab => tab.id !== 'ai' || aiEnabled).map(tab => {
                const open = activeTab === tab.id && parts.length > 1
                const labels = open ? parts.map(part => part.label) : remembered[tab.id] ?? []
                return (
                <React.Fragment key={tab.id}>
                  <button
                    onClick={() => setActiveTab(tab.id)}
                    // the active section used to be colour only, invisible to screen readers
                    aria-current={activeTab === tab.id ? 'page' : undefined}
                    className="settings-view-tab"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--space-2)',
                      padding: 'var(--space-2) var(--space-3)',
                      borderRadius: 'var(--radius-md)',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 'var(--text-sm)',
                      fontWeight: activeTab === tab.id ? 'var(--weight-semibold)' : 'var(--weight-regular)',
                      textAlign: 'left',
                      width: '100%',
                      transition: 'background var(--duration-fast) var(--ease-default), color var(--duration-fast) var(--ease-default)'
                    }}
                  >
                    <span style={{ flexShrink: 0, opacity: 0.8 }}>{tab.icon}</span>
                    {tab.label}
                  </button>
                  {/* the open section's parts, a jump to each, growing open; always here so the change can be eased both ways */}
                  <div className="settings-parts-wrap" data-open={open || undefined} aria-hidden={open ? undefined : true}>
                    <div className="settings-parts-clip">
                      <ul className="settings-parts" aria-label={`In ${tab.label}`}>
                        {labels.map((label, index) => (
                          <li key={`${index}:${label}`}>
                            <button
                              type="button"
                              className="settings-part"
                              style={{ '--part-index': index } as React.CSSProperties}
                              tabIndex={open ? undefined : -1}
                              aria-current={open && index === current ? 'location' : undefined}
                              onClick={() => jump(index)}
                            >
                              {label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </React.Fragment>
                )
              })}
            </div>
          ))}
        </SettingsSearch>
      </nav>

      <div
        ref={scrollerRef}
        className="settings-scroller"
        data-scrolled={scrolled || undefined}
        onScroll={event => setScrolled(event.currentTarget.scrollTop > 0)}
      >
        {/* one readable column on any screen, so a section scrolls and its jump links have somewhere to go */}
        <div className="settings-column">
          {/* stays at the top while the section scrolls, so the way out is always in reach */}
          <header ref={headRef} className="settings-head">
            <div className="fill">
              <h1 ref={headingRef} tabIndex={-1} className="settings-title">
                {activeTabInfo?.label}
              </h1>
              <p className="settings-description">
                {activeTabInfo?.description}
              </p>
            </div>
            <div className="settings-close-wrap">
              <button type="button" className="settings-close" onClick={() => withViewTransition(goBack)} aria-label="Close settings" title="Close settings (Esc)">
                <X size={18} aria-hidden="true" />
              </button>
              <kbd className="settings-close-key" aria-hidden="true">Esc</kbd>
            </div>
          </header>

          {/* keyed by section, so a new section fades in rather than swapping under the reader */}
          <div key={activeTab} className="settings-cards motion-content">
            {content}
          </div>
        </div>
      </div>
    </div>
  )
}
