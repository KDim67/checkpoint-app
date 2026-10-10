/** how every connection client answers: a value, or what went wrong in words; never a throw */

/** refused: this one item can't be changed that way, such as a workflow with no path to Done; the rest are fine */
export type FailureKind = 'auth' | 'forbidden' | 'refused' | 'not-found' | 'rate' | 'network' | 'bad'

export type Failure = { ok: false; kind: FailureKind; message: string; resetAt?: number }

export type Result<T> = { ok: true; value: T } | Failure

export const fail = <T>(kind: FailureKind, message: string, resetAt?: number): Result<T> => ({ ok: false, kind, message, ...(resetAt ? { resetAt } : {}) })

/** what a client needs from outside, so tests can stand in for the network and the clock */
export interface ClientDeps {
  fetch: typeof fetch
  now: () => number
}
