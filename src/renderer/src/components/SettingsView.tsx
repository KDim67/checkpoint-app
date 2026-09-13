import React, { useEffect } from 'react'
import { Settings, Layers, Sparkles, Palette, Paintbrush, Monitor, Zap, Info, RefreshCw, Layout, Archive, Keyboard, Boxes, HardDrive, Plug, Bell, PanelTop } from 'lucide-react'
import SettingsSection, { Divider } from './settings/SettingsSection'
import WorkspaceManager from './settings/WorkspaceManager'
import SyncSettings from './settings/SyncSettings'
import NotificationSettings from './settings/NotificationSettings'
import StartupSettings from './settings/StartupSettings'
import McpSettings from './settings/McpSettings'
import AppearanceSettings from './settings/AppearanceSettings'
import FeatureToggleCenter from './settings/FeatureToggleCenter'
import AboutPanel from './settings/AboutPanel'
import ThemeCustomizer from './settings/ThemeCustomizer'
import HotkeyBinder from './settings/HotkeyBinder'
import ExtensionsTab from './settings/ExtensionsTab'
import { useAppStore } from '../store/appStore'
import { useAiEnabled } from '../lib/useAiEnabled'
import type { SettingsTab } from '../store/appStore'
import * as appApi from '../data/app'
import KanbanSettings from './settings/KanbanSettings'
import WidgetSettings from './settings/WidgetSettings'
import AiSettings from './settings/AiSettings'
import ThemeModeSettings from './settings/ThemeModeSettings'
import GeneralSettings from './settings/GeneralSettings'
import BackupSettings from './settings/BackupSettings'
import StorageSettings from './settings/StorageSettings'

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
      { id: 'general',    label: 'General',            icon: <Settings size={14} />, description: 'Startup behavior and desktop integration.' },
      { id: 'appearance', label: 'Appearance & Theme', icon: <Palette size={14} />,  description: 'Interface theme, text scale, density and full color customization.' }
    ]
  },
  {
    group: 'Workspace',
    tabs: [
      { id: 'workspaces', label: 'Workspaces & Board', icon: <Layers size={14} />,   description: 'Manage workspaces and the Kanban columns of the active one.' },
      { id: 'ai',       label: 'AI Assistant',       icon: <Sparkles size={14} />, description: 'Model providers, generation options, email voice and persistent memory.' }
    ]
  },
  {
    group: 'System',
    tabs: [
      { id: 'hotkeyBinder', label: 'Shortcuts & Mouse', icon: <Keyboard size={14} />, description: 'Rebind the hotkeys, the per-view keys, and what the mouse buttons do.' },
      { id: 'features',     label: 'Features & Plugins', icon: <Zap size={14} />,      description: 'Toggle background subsystems and manage user plugins.' },
      { id: 'notifications', label: 'Notifications',      icon: <Bell size={14} />,     description: 'What Checkpoint tells you about, and when it stays quiet.' },
      { id: 'backup',       label: 'Database Backup',    icon: <Archive size={14} />,  description: 'Automated database snapshots, retention and restore points.' },
      { id: 'storage',      label: 'Storage & Export',    icon: <HardDrive size={14} />, description: 'Manage local attachment vaults and clean up orphaned files.' },
      { id: 'sync',         label: 'Device Sync',        icon: <RefreshCw size={14} />, description: 'Keep your own machines in step. Sharing a board with someone else is Share, on the board.' },
      { id: 'mcp',          label: 'MCP Server',         icon: <Plug size={14} />,      description: 'Let external AI agents read and edit Checkpoint over a local connection.' },
      { id: 'about',        label: 'About',              icon: <Info size={14} />,     description: 'Version, credits and diagnostics.' }
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

export default function SettingsView() {
  const rawTab = useAppStore(s => s.settingsTab)
  const setActiveTab = useAppStore(s => s.setSettingsTab)
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const isWindows = appApi.platform() === 'win32'
  const aiEnabled = useAiEnabled()

  const activeTab: SettingsTab = (LEGACY_TAB_ALIASES[rawTab as string] ?? rawTab) as SettingsTab

  const renderTabContent = () => {
    switch (activeTab) {
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
              <SettingsSection icon={<Monitor size={14} />} title="Desktop Widget" description="Always-on-top overlay for glanceable tasks (Windows only).">
                <WidgetSettings />
              </SettingsSection>
            )}
          </>
        )
      case 'workspaces':
        return (
          <>
            <SettingsSection icon={<Layers size={14} />} title="Workspaces" description="Each one keeps its own board, logs and notes.">
              <WorkspaceManager />
            </SettingsSection>
            <SettingsSection icon={<Layout size={14} />} title="Kanban Columns" description={`Column names and WIP limits for #${activeWorkspace}.`}>
              <KanbanSettings activeWorkspace={activeWorkspace} />
            </SettingsSection>
          </>
        )
      case 'ai':
        return (
          <SettingsSection icon={<Sparkles size={14} />} title="AI Assistant" description="Connection, generation options, email voice and persistent memory.">
            <AiSettings />
          </SettingsSection>
        )
      case 'appearance':
        return (
          <>
            <SettingsSection icon={<Palette size={14} />} title="Interface" description="Theme mode, text scale and density.">
              <div className="col-xl">
                <ThemeModeSettings />
                <Divider />
                <AppearanceSettings />
              </div>
            </SettingsSection>
            <SettingsSection icon={<Paintbrush size={14} />} title="Theme Builder" description="Override individual colors and fonts via the customization engine.">
              <ThemeCustomizer />
            </SettingsSection>
          </>
        )
      case 'hotkeyBinder':
        return (
          <SettingsSection icon={<Keyboard size={14} />} title="Keyboard Shortcuts" description="Global hotkeys registered with the operating system.">
            <HotkeyBinder />
          </SettingsSection>
        )
      case 'features':
        return (
          <>
            <SettingsSection icon={<Zap size={14} />} title="Feature Toggles" description="Enable or disable background subsystems.">
              <FeatureToggleCenter />
            </SettingsSection>
            <SettingsSection icon={<Boxes size={14} />} title="Extensions & Plugins" description="Hot-loaded user plugins from the plugins folder.">
              <ExtensionsTab />
            </SettingsSection>
          </>
        )
      case 'backup':
        return (
          <SettingsSection icon={<Archive size={14} />} title="Database Backup" description="Automated snapshots, retention and restore points.">
            <BackupSettings />
          </SettingsSection>
        )
      case 'storage':
        return (
          <SettingsSection icon={<HardDrive size={14} />} title="Storage & Media" description="Export your data, track attachment usage and clean up unreferenced files.">
            <StorageSettings />
          </SettingsSection>
        )
      case 'sync':
        return (
          <SettingsSection icon={<RefreshCw size={14} />} title="Device Sync" description="Your own machines, kept in step. Not the same thing as sharing a board.">
            <SyncSettings />
          </SettingsSection>
        )
      case 'notifications':
        return (
          <SettingsSection icon={<Bell size={14} />} title="Notifications" description="What Checkpoint tells you about, and when it stays quiet.">
            <NotificationSettings />
          </SettingsSection>
        )
      case 'mcp':
        return (
          <SettingsSection icon={<Plug size={14} />} title="MCP Server" description="Let external AI agents read and edit Checkpoint over a local connection.">
            <McpSettings />
          </SettingsSection>
        )
      case 'about':
        return (
          <SettingsSection icon={<Info size={14} />} title="About" description="Version, credits and diagnostics.">
            <AboutPanel />
          </SettingsSection>
        )
      default:
        return null
    }
  }

  // AI switched off while its tab is open would leave a dead panel
  useEffect(() => {
    if (!aiEnabled && activeTab === 'ai') setActiveTab('general')
  }, [aiEnabled, activeTab, setActiveTab])

  const activeTabInfo = ALL_TABS.find(t => t.id === activeTab)

  return (
    <div style={{
      display: 'flex',
      height: '100%',
      background: 'var(--color-background)',
      overflow: 'hidden'
    }}>
      <nav aria-label="Settings sections" style={{
        width: '210px',
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
        {TAB_GROUPS.map(group => (
          <div key={group.group} style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: 'var(--space-3)' }}>
            <div style={{
              fontSize: '10px',
              fontWeight: 'var(--weight-bold)',
              color: 'var(--color-text-faint)',
              textTransform: 'uppercase',
              letterSpacing: '0.06em',
              padding: '0 var(--space-3) var(--space-1)'
            }}>
              {group.group}
            </div>
            {group.tabs.filter(tab => tab.id !== 'ai' || aiEnabled).map(tab => (
              <button
                key={tab.id}
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
                  transition: 'background 100ms ease, color 100ms ease'
                }}
              >
                <span style={{ flexShrink: 0, opacity: 0.8 }}>{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        padding: 'var(--space-6)',
        paddingBottom: 'var(--space-10)'
      }}>
        {/* centred and capped; the old fixed 860px left most of a wide window empty */}
        <div style={{
          maxWidth: '1400px',
          margin: '0 auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--space-5)'
        }}>
          <div>
            <h1 style={{
              margin: 0,
              fontSize: 'var(--text-xl)',
              fontWeight: 'var(--weight-semibold)',
              color: 'var(--color-text-base)',
              letterSpacing: 'var(--tracking-tight)'
            }}>
              {activeTabInfo?.label}
            </h1>
            <p style={{
              margin: 'var(--space-1) 0 0',
              fontSize: 'var(--text-sm)',
              color: 'var(--color-text-muted)'
            }}>
              {activeTabInfo?.description}
            </p>
          </div>

          {/* grid holds only cards: a full-width title spans every track and single-card tabs got stuck in one column */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 520px), 1fr))',
            gap: 'var(--space-5)',
            alignItems: 'start'
          }}>
            {renderTabContent()}
          </div>
        </div>
      </div>
    </div>
  )
}
