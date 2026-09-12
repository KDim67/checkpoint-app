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

/**
 * A live share of the board: who is in it, what they may do, and what can be
 * done about it.
 *
 * Called from the board rather than from the share panel. The board has to know
 * whether it may be written to, and the session has to keep running whatever
 * the panel is doing.
 */
export function useCollabSession() {
  const activeWorkspace = useAppStore(s => s.activeWorkspace)
  const workspaceList = useAppStore(s => s.workspaceList)
  const setWorkspaceList = useAppStore(s => s.setWorkspaceList)
  const { toast } = useToast()
  const confirm = useConfirm()
  const pick = usePick()

  const collabCoordinatorRef = useRef<WebRTCCollaborationCoordinator | null>(null)

  /**
   * Kept as typed and normalised on the way out, so the field is not fighting
   * the caret. Empty is a real answer: the account name stands in for it.
   */
  const [displayName, setDisplayName] = useState('')
  const osUserName = normalizeDisplayName(window.electronAPI.app.osUserName)

  /** False until the stored name has arrived, so loading it does not write it back. */
  const nameLoaded = useRef(false)

  useEffect(() => {
    getStringSetting(DISPLAY_NAME_KEY, '')
      .then(raw => setDisplayName(normalizeDisplayName(raw)))
      .catch(err => console.error('Failed to read the display name:', err))
      .finally(() => { nameLoaded.current = true })
  }, [])

  /**
   * Saved as it is typed rather than on blur.
   *
   * The popover closes on mousedown, which unmounts the field before focus
   * moves, so no blur is ever delivered and a name typed and then clicked away
   * from was silently lost. This effect lives on the view, not the popover, so
   * it survives the close and writes anyway.
   */
  useEffect(() => {
    if (!nameLoaded.current) return
    const timer = setTimeout(() => {
      const name = normalizeDisplayName(displayName)
      setStringSetting(DISPLAY_NAME_KEY, name)
        .catch(err => console.error('Failed to save the display name:', err))
      // The room is holding the name read when the session started, so without
      // this a rename reaches nobody until the next connection.
      void collabCoordinatorRef.current?.rename(name)
    }, 400)
    return () => clearTimeout(timer)
  }, [displayName])

  /** Tidies what is in the field once the user has finished with it. */
  const saveDisplayName = useCallback(() => {
    setDisplayName(current => normalizeDisplayName(current))
  }, [])

  const [collabActive, setCollabActive] = useState(false)
  const [collabIsHost, setCollabIsHost] = useState(false)
  const [collabCode, setCollabCode] = useState('')
  const [collabMode, setCollabMode] = useState<'collaborative' | 'readonly'>('collaborative')
  /**
   * Everyone in the room, as they call themselves.
   *
   * The host keeps this from its own connections; a guest is told it, because
   * guests are connected to the host and not to each other. A member with an
   * empty name is on a build that does not introduce itself, and is still very
   * much in the room.
   */
  const [collabRoster, setCollabRoster] = useState<{ id: string; name: string }[]>([])
  const [collabProgress, setCollabProgress] = useState('Idle')
  /**
   * Held here rather than in the panel. The panel unmounts while the board
   * reloads for a workspace switch, and a passcode half typed, or the popover
   * it was typed into, should still be there afterwards.
   */
  const [showCollabPopover, setShowCollabPopover] = useState(false)
  const [joinCodeInput, setJoinCodeInput] = useState('')

  /**
   * The workspace the live session belongs to.
   *
   * Switching workspace leaves the session running against the one you left,
   * which is correct (the other side agreed to share that board, not this one)
   * but looked like a dead connection: nothing synced and the panel still said
   * Active. Holding the slug lets the panel say so, and offer the way back.
   */
  const [collabWorkspace, setCollabWorkspace] = useState('')
  const collabElsewhere = collabActive && collabWorkspace !== '' && collabWorkspace !== activeWorkspace

  const isReadOnlyMode = collabActive && collabMode === 'readonly' && !collabIsHost

  /**
   * Whether to take the board the other side has merged for the two of you.
   *
   * Put with numbers on it. "Do you want to merge" is not a question anybody
   * can answer, and saying yes to it overwrites a board.
   */
  const considerMerge = useCallback(async ({ by, impact }: { by: string; impact: MergeImpact }) => {
    const what = describeImpact(impact)
    const them = by || 'They'
    const back = impact.cardsReturning
    const gone = impact.cardsRemoved
    // Both of these are the merge costing this board something, and the warning
    // is the only line that says so.
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

  /**
   * What the host did with the merge this side offered.
   *
   * A no ends the session, which the coordinator is doing as this runs: this
   * board is now the merged one and the room is still on the host's, and a
   * guest holding cards the room does not have loses them the moment the host
   * takes anybody else's merge. So the panel is closed here too.
   */
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
    // Said out loud as well. The board just changed under this user and the
    // panel it would otherwise be said in is usually shut.
    toast(why)
  }, [toast])

  /** The host took somebody's merge, and this is the shared board now. */
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

    // Labelled here rather than when a peer actually arrives: publishing a
    // passcode is the moment the board stops being private, whether or not
    // anybody takes it up.
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
      // Toasted as well as logged. A session that ends by itself used to do it
      // in silence: the button went back to saying Share and the reason sat in
      // a popover nobody had open, so the only thing anyone could report was
      // that sharing had stopped working.
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
      // The host is the only side asked about a merge, and the only side that
      // never offers one, so there is no answer coming back here.
      onMergeProposed: considerMerge,
      // One guest going does not end the session: the passcode still works and
      // everyone else is still here.
      onPeerLeft: (name) => {
        setCollabProgress(`${authorLabel(name)} left. The same passcode still works.`)
      },
      // The host keeps its own board and never receives a baseline.
      onResolveBaseline: async () => ({ action: 'replace' })
    })
    collabCoordinatorRef.current = coord
    await coord.start()
  }, [activeWorkspace, workspaceList, setWorkspaceList, displayName, considerMerge, toast])

  const joinCollabSession = useCallback(async (code: string) => {
    if (!code || code.length < 5) return
    setCollabActive(true)
    setCollabIsHost(false)
    // Cleared, not left as it was. Hosting read-only and then joining someone
    // else's board carried that over, and until the host's board arrived to say
    // otherwise it locked this user out of their own.
    setCollabMode('collaborative')
    setCollabCode(code)
    setCollabWorkspace(activeWorkspace)
    setCollabProgress('Initiating connection...')

    const coord = new WebRTCCollaborationCoordinator({
      pairingCode: code,
      isHost: false,
      context: activeWorkspace,
      mode: 'collaborative', // Client infers mode from baseline message
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
      // The host's word on what this side may do, and it can change mid-session.
      onMode: setCollabMode,
      onRemoved: (by) => {
        const said = by ? `${by} removed you from the board` : 'You were removed from the board'
        setCollabProgress(`${said}.`)
        setCollabActive(false)
        setCollabRoster([])
        toast(said)
      },
      onResolveBaseline: async ({ context, incomingItems, mode }) => {
        // A check that could not run is not permission to delete, so a failed
        // read is treated as a clash and the user is asked anyway.
        let taken: Set<string>
        try {
          taken = await occupiedWorkspaces()
        } catch (err) {
          console.error('Could not check for an existing workspace:', err)
          taken = new Set([context])
        }
        // Nothing here under that name, so nothing to lose and nothing to ask.
        if (!taken.has(context)) {
          setCollabWorkspace(context)
          return { action: 'replace' }
        }

        const copySlug = availableWorkspaceSlug(context, taken)
        // Three answers, each of which needs a sentence to be understood. A row
        // of buttons can hold the labels but not the sentences, and picking
        // between "Replace mine" and "Keep both" on the labels alone is how
        // someone deletes a board they meant to keep.
        const choice = await pick({
          title: `You already have "${context}"`,
          message:
            `They are sharing a board called "${context}" with ${incomingItems} item(s), ` +
            `and you have a board of your own under that name.`,
          cancelText: 'Cancel',
          choices: [
            // Not on offer when the board is shared read-only. A merge ends
            // with the host holding the board the two of you make, and a host
            // sharing read-only has said the guests do not change this board,
            // so the offer would only ever be turned down.
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
        // The session belongs to whichever workspace the board actually lands in,
        // which for a copy is not the name the host used.
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
      // Announced before hanging up, so the other side is told who left rather
      // than watching the connection go quiet. Best effort, never blocking.
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

  /**
   * Shows one person the door, and leaves everyone else where they are.
   *
   * Their client will not come back on its own, but the passcode they hold
   * still works, so this is a door rather than a lock. Changing the passcode is
   * the lock, and it is separate because it removes everybody.
   */
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

  /**
   * A new passcode, which is the only thing that really locks anyone out.
   *
   * Everybody has to rejoin, so it is deliberately its own action rather than
   * something removing one person does on the quiet.
   */
  const rotateCollabCode = useCallback(async () => {
    const coord = collabCoordinatorRef.current
    if (!coord) return
    // Rehosting starts from the workspace on screen, so doing this from a board
    // that is not the shared one would quietly share that one instead.
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

  /** Lets the guest write, or stops them, without ending the session. */
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
