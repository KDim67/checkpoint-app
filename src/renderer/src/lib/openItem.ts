/** where each kind of item opens, shared by search and the Workspaces page so they never disagree */

import { useAppStore } from '../store/appStore'

export function openItem(type: 'card' | 'task' | 'log', id: string): void {
  const { setView, selectItem, setRightPanelContent } = useAppStore.getState()
  if (type === 'log') {
    setView('log')
    selectItem(id)
  } else if (type === 'task') {
    setView('backlog')
    selectItem(id)
  } else {
    setView('kanban')
    selectItem(id)
    setRightPanelContent('item-detail')
  }
}
