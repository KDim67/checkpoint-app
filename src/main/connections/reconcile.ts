/** what to do about one item: open and closed are the only states, so whichever side left the last agreement is the one that moved */

/** the card: none when there is no card, deleted when you deleted it */
export type LocalState = 'open' | 'closed' | 'none' | 'deleted'
/** out-of-scope: it exists, but no longer for any workspace, such as unassigned from you or deleted */
export type RemoteState = 'open' | 'closed' | 'out-of-scope'
/** null until this computer has seen both sides agree */
export type AgreedState = 'open' | 'closed' | 'ignored' | null

export type Decision = 'import' | 'none' | 'pull' | 'push' | 'settle' | 'gone' | 'ignore'

export interface DecideInput {
  local: LocalState
  agreed: AgreedState
  remote: RemoteState
  /** the service changed it after the card last did; only asked when nothing was agreed yet */
  remoteNewer: boolean
  /** the key may change this item's state where it lives */
  canWrite: boolean
}

export function decide(input: DecideInput): Decision {
  const { local, agreed, remote } = input
  if (agreed === 'ignored' || local === 'deleted') return 'ignore'
  if (local === 'none') return remote === 'open' ? 'import' : 'none'
  if (remote === 'out-of-scope') return 'gone'
  if (local === remote) return agreed === local ? 'none' : 'settle'
  // a card that came by sync from another computer: no agreement here yet, so the later change wins
  if (agreed === null) return input.remoteNewer || !input.canWrite ? 'pull' : 'push'
  if (local === agreed) return 'pull'
  return input.canWrite ? 'push' : 'pull'
}

export type FieldMove = 'none' | 'push' | 'pull' | 'settle' | 'conflict'

/** one field settled the same way: compared with the last agreed value, so no clock is trusted */
export function mergeField<T>(local: T, agreed: T | undefined, remote: T): FieldMove {
  // never agreed here, such as a card that arrived by sync: the service's version is the one both computers can reach
  if (agreed === undefined) return local === remote ? 'settle' : 'pull'
  const localMoved = local !== agreed
  const remoteMoved = remote !== agreed
  if (!localMoved && !remoteMoved) return 'none'
  if (localMoved && !remoteMoved) return 'push'
  if (!localMoved) return 'pull'
  return local === remote ? 'settle' : 'conflict'
}
