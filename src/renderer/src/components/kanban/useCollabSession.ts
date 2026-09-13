import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store/appStore'
import { useToast } from '../ui/Toast'
import { useConfirm, usePick } from '../ui/ConfirmDialog'
import { describeImpact, type MergeImpact } from '@shared/boardMerge'
import { authorLabel, DISPLAY_NAME_KEY, normalizeDisplayName } from '@shared/identity'
import { errorMessage } from '@shared/errors'
import { availableWorkspaceSlug, occupiedWorkspaces, setWorkspaceShared } from '../../lib/createWorkspace'
import { WebRTCCollaborationCoordinator } from '../../lib/webrtcCollaboration'
import { writeWorkspaceList } from '../../lib/workspaceList'
import { getStringSetting, setStringSetting } from '../../lib/settings'
import * as appApi from '../../data/app'

/** on the board, not the panel: the board needs write permission and the session outlives the panel */
export function useCollabSession() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const workspaceList = useAppStore(s => s.workspaceList)
  const setWorkspaceList = useAppStore(s => s.setWorkspaceList)
  const { toast } = useToast()
  const confirm = useConfirm()
  const pick = usePick()

  const collabCoordinatorRef = useRef<WebRTCCollaborationCoordinator | null>(null)

  /** kept as typed so the field doesn't fight the caret; empty means the account name */
  const [displayName, setDisplayName] = useState('')
  const osUserName = normalizeDisplayName(appApi.osUserName())

  /** so loading the stored name doesn't write it back */
  const nameLoaded = useRef(false)

  useEffect(() => {
    getStringSetting(DISPLAY_NAME_KEY, '')
      .then(raw => setDisplayName(normalizeDisplayName(raw)))
      .catch(err => console.error('Failed to read the display name:', err))
      .finally(() => { nameLoaded.current = true })
  }, [])

  /** saved as typed: the popover closes on mousedown before blur, which lost names */
  useEffect(() => {
    if (!nameLoaded.current) return
    const timer = setTimeout(() => {
      const name = normalizeDisplayName(displayName)
      setStringSetting(DISPLAY_NAME_KEY, name)
        .catch(err => console.error('Failed to save the display name:', err))
      // the room holds the name from session start, so push renames
      void collabCoordinatorRef.current?.rename(name)
    }, 400)
    return () => clearTimeout(timer)
  }, [displayName])

  /** tidies the field once the user's done */
  const saveDisplayName = useCallback(() => {
    setDisplayName(current => normalizeDisplayName(current))
  }, [])

  const [collabActive, setCollabActive] = useState(false)
  const [collabIsHost, setCollabIsHost] = useState(false)
  const [collabCode, setCollabCode] = useState('')
  const [collabMode, setCollabMode] = useState<'collaborative' | 'readonly'>('collaborative')
  /** the host tracks its connections, guests are told; empty names are older builds, still present */
  const [collabRoster, setCollabRoster] = useState<{ id: string; name: string }[]>([])
  const [collabProgress, setCollabProgress] = useState('Idle')
  /** here, not in the panel, so a half-typed passcode survives a workspace reload */
  const [showCollabPopover, setShowCollabPopover] = useState(false)
  const [joinCodeInput, setJoinCodeInput] = useState('')

  /** the session stays on its workspace; holding the slug lets the panel say so and offer the way back */
  const [collabWorkspace, setCollabWorkspace] = useState('')
  const collabElsewhere = collabActive && collabWorkspace !== '' && collabWorkspace !== activeWorkspace

  const isReadOnlyMode = collabActive && collabMode === 'readonly' && !collabIsHost

  /** with numbers: "merge?" can't be answered, and yes overwrites a board */
  const considerMerge = useCallback(async ({ by, impact }: { by: string; impact: MergeImpact }) => {
    const what = describeImpact(impact)
    const them = by || 'They'
    const back = impact.cardsReturning
    const gone = impact.cardsRemoved
    // both are this board losing something, only the warning says so
    const warnings: string[] = []
    if (gone > 0) {
      warnings.push(
        `${gone} card${gone === 1 ? '' : 's'} you have would be taken away, because ` +
          `${by || 'they'} deleted ${gone === 1 ? 'it' : 'them'}.`
      )
    }
    if (back > 0) {
      warnings.push(
        `${back} card${back === 1 ? '' : 's'} you deleted would come back, because they still ` +
          `have ${back === 1 ? 'it' : 'them'}.`
      )
    }
    return confirm({
      title: by ? `${by} wants to merge your boards` : 'Merge the two boards?',
      message: what
        ? `${them} merged their copy of this board with yours and is offering the result: ` +
          `${what}. Taking it makes it the board everyone here is on.`
        : `${them} merged their copy of this board with yours. Nothing here would change.`,
      confirmText: 'Merge',
      cancelText: 'Keep mine',
      isDestructive: gone > 0,
      warning: warnings.length > 0 ? warnings.join(' ') : undefined
    })
  }, [confirm])

  /** a no ends the session: this board is merged, the room isn't, so close the panel */
  const reportMergeAnswer = useCallback((accepted: boolean, by: string, reason: string) => {
    const them = by || 'They'
    if (accepted) {
      setCollabProgress(`${them} took the merge. Both boards now match.`)
      return
    }
    const why = reason
      ? `The merge was not taken: ${reason}. Your board is merged and sharing has ended.`
      : `${them} kept their own board. Your board is merged and sharing has ended.`
    setCollabProgress(why)
    setCollabActive(false)
    setCollabRoster([])
    // toast too, the panel is usually shut
    toast(why)
  }, [toast])

  /** the host took a merge, this is the shared board now */
  const reportBoardReset = useCallback((by: string) => {
    const said = by
      ? `${by} merged their board in. The shared board has been updated.`
      : 'The shared board has been merged and updated.'
    setCollabProgress(said)
    toast(said)
  }, [toast])

  const startCollabHosting = useCallback(async (mode: 'collaborative' | 'readonly') => {
    const code = Math.floor(100000 + Math.random() * 900000).toString()
    setCollabActive(true)
    setCollabIsHost(true)
    setCollabCode(code)
    setCollabMode(mode)
    setCollabWorkspace(activeWorkspace)
    setCollabProgress('Initializing host signal room...')

    // labelled on publish, that's when the board stops being private
    const labelled = setWorkspaceShared(workspaceList, activeWorkspace, true)
    if (labelled !== workspaceList) {
      setWorkspaceList(labelled)
      writeWorkspaceList(labelled)
        .catch(err => console.error('Failed to record the workspace as shared:', err))
    }

    const coord = new WebRTCCollaborationCoordinator({
      pairingCode: code,
      isHost: true,
      context: activeWorkspace,
      mode,
      onProgress: (p) => setCollabProgress(p),
      onConnect: () => setCollabProgress('Someone joined.'),
      // toast as well; a silent end left nothing to report but "sharing stopped"
      onDisconnect: () => {
        setCollabProgress('Peer disconnected.')
        setCollabActive(false)
        toast('Sharing stopped: the connection closed')
      },
      onError: (err) => {
        setCollabProgress(`Error: ${errorMessage(err)}`)
        setCollabActive(false)
        toast(`Sharing stopped: ${errorMessage(err)}`)
      },
      displayName,
      onRoster: setCollabRoster,
      // the host is asked, never offers, so no answer comes back
      onMergeProposed: considerMerge,
      // one guest leaving doesn't end the session
      onPeerLeft: (name) => {
        setCollabProgress(`${authorLabel(name)} left. The same passcode still works.`)
      },
      // the host keeps its board, never gets a baseline
      onResolveBaseline: async () => ({ action: 'replace' })
    })
    collabCoordinatorRef.current = coord
    await coord.start()
  }, [activeWorkspace, workspaceList, setWorkspaceList, displayName, considerMerge, toast])

  const joinCollabSession = useCallback(async (code: string) => {
    if (!code || code.length < 5) return
    setCollabActive(true)
    setCollabIsHost(false)
    // cleared: a leftover read-only mode locked users out of their own board
    setCollabMode('collaborative')
    setCollabCode(code)
    setCollabWorkspace(activeWorkspace)
    setCollabProgress('Initiating connection...')

    const coord = new WebRTCCollaborationCoordinator({
      pairingCode: code,
      isHost: false,
      context: activeWorkspace,
      mode: 'collaborative', // client infers mode from the baseline
      displayName,
      onProgress: (p) => setCollabProgress(p),
      onConnect: () => setCollabProgress('Connected to the host.'),
      onDisconnect: () => {
        setCollabProgress('Host disconnected.')
        setCollabActive(false)
        setCollabRoster([])
        toast('Sharing stopped: the host closed the connection')
      },
      onError: (err) => {
        setCollabProgress(`Error: ${errorMessage(err)}`)
        setCollabActive(false)
        toast(`Sharing stopped: ${errorMessage(err)}`)
      },
      onRoster: setCollabRoster,
      onMergeProposed: considerMerge,
      onMergeAnswer: reportMergeAnswer,
      onBoardReset: reportBoardReset,
      // the host decides, and it can change mid-session
      onMode: setCollabMode,
      onRemoved: (by) => {
        const said = by ? `${by} removed you from the board` : 'You were removed from the board'
        setCollabProgress(`${said}.`)
        setCollabActive(false)
        setCollabRoster([])
        toast(said)
      },
      onResolveBaseline: async ({ context, incomingItems, mode }) => {
        // a failed read counts as a clash, never permission to delete
        let taken: Set<string>
        try {
          taken = await occupiedWorkspaces()
        } catch (err) {
          console.error('Could not check for an existing workspace:', err)
          taken = new Set([context])
        }
        // nothing here by that name, nothing to ask
        if (!taken.has(context)) {
          setCollabWorkspace(context)
          return { action: 'replace' }
        }

        const copySlug = availableWorkspaceSlug(context, taken)
        // three answers that each need a sentence; labels alone lead to deleted boards
        const choice = await pick({
          title: `You already have "${context}"`,
          message:
            `They are sharing a board called "${context}" with ${incomingItems} item(s), ` +
            `and you have a board of your own under that name.`,
          cancelText: 'Cancel',
          choices: [
            // no merge when shared read-only, the host already said guests don't change it
            ...(mode === 'readonly'
              ? []
              : [
                  {
                    key: 'merge',
                    label: 'Merge the two',
                    detail:
                      'Keeps everything from both copies. A card you both have keeps what each ' +
                      'of you wrote on it, and anything you deleted stays deleted.'
                  }
                ]),
            {
              key: 'copy',
              label: 'Keep them apart',
              detail: `Puts their board in "${copySlug}" and leaves yours exactly as it is.`
            },
            {
              key: 'replace',
              label: 'Replace mine',
              detail:
                'Deletes every card and task you have under that name and takes theirs instead. ' +
                'This cannot be undone.',
              isDestructive: true
            }
          ]
        })
        // the session follows the workspace the board lands in, a copy has a new name
        if (choice === 'merge') {
          setCollabWorkspace(context)
          return { action: 'merge' }
        }
        if (choice === 'replace') {
          setCollabWorkspace(context)
          return { action: 'replace' }
        }
        if (choice === 'copy') {
          setCollabWorkspace(copySlug)
          return { action: 'copy', slug: copySlug }
        }
        return { action: 'cancel' }
      }
    })
    collabCoordinatorRef.current = coord
    await coord.start()
  }, [activeWorkspace, pick, displayName, considerMerge, reportMergeAnswer, reportBoardReset, toast])

  const disconnectCollab = useCallback(() => {
    if (collabCoordinatorRef.current) {
      // announce first so the other side sees who left; best effort
      void collabCoordinatorRef.current.leave()
      collabCoordinatorRef.current = null
    }
    setCollabActive(false)
    setCollabIsHost(false)
    setCollabCode('')
    setCollabWorkspace('')
    setCollabRoster([])
    setCollabProgress('Disconnected')
  }, [])

  /** a door, not a lock: the passcode still works, rotating it is the lock */
  const removeCollabGuest = useCallback(async (member: { id: string; name: string }) => {
    const coord = collabCoordinatorRef.current
    if (!coord) return

    const who = authorLabel(member.name)
    const confirmed = await confirm({
      title: `Remove ${who}?`,
      message:
        'They lose access straight away and their app will not reconnect on its own. ' +
        'Everyone else stays. The passcode does not change, so use Change passcode ' +
        'if you want it to stop working for them for good.',
      confirmText: 'Remove',
      isDestructive: true
    })
    if (!confirmed) return

    await coord.remove(member.id)
    setCollabProgress(`Removed ${who}.`)
  }, [confirm])

  /** the only real lock-out, everyone rejoins, so its own action */
  const rotateCollabCode = useCallback(async () => {
    const coord = collabCoordinatorRef.current
    if (!coord) return
    // rehosting shares the board on screen, which wouldn't be the shared one
    if (collabElsewhere) return

    const confirmed = await confirm({
      title: 'Change the passcode?',
      message:
        'Everyone connected is disconnected and the old passcode stops working. ' +
        'Your board stays shared: give the new one to whoever should still be here.',
      confirmText: 'Change it',
      isDestructive: true
    })
    if (!confirmed) return

    await coord.leave()
    collabCoordinatorRef.current = null
    setCollabRoster([])
    await startCollabHosting(collabMode)
    setCollabProgress('The passcode has changed. Everyone needs the new one.')
  }, [collabMode, collabElsewhere, confirm, startCollabHosting])

  /** without ending the session */
  const setCollabGuestMode = useCallback(async (mode: 'collaborative' | 'readonly') => {
    setCollabMode(mode)
    try {
      await collabCoordinatorRef.current?.setMode(mode)
    } catch (err) {
      console.error('Failed to tell the peer about the mode change:', err)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (collabCoordinatorRef.current) {
        collabCoordinatorRef.current.cleanup()
      }
    }
  }, [])

  return {
    active: collabActive,
    isHost: collabIsHost,
    code: collabCode,
    mode: collabMode,
    roster: collabRoster,
    progress: collabProgress,
    workspace: collabWorkspace,
    elsewhere: collabElsewhere,
    isReadOnly: isReadOnlyMode,
    displayName,
    setDisplayName,
    saveDisplayName,
    osUserName,
    popoverOpen: showCollabPopover,
    setPopoverOpen: setShowCollabPopover,
    joinCode: joinCodeInput,
    setJoinCode: setJoinCodeInput,
    host: startCollabHosting,
    join: joinCollabSession,
    disconnect: disconnectCollab,
    removeGuest: removeCollabGuest,
    rotateCode: rotateCollabCode,
    setGuestMode: setCollabGuestMode
  }
}

export type CollabSession = ReturnType<typeof useCollabSession>
