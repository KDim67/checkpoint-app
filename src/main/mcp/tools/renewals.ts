import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { recordMcpActivity } from '../../mcpActivity'
import { createRenewal, getKinds, listRenewals } from '../../renewals'
import { shorten } from '../../../shared/mcpActivity'
import { dueFromText, dueIso } from '../../../shared/dueDate'
import { describeCycle, expiryPhrase, formatMoney, type RenewalCycle, type RenewalField, type RenewalLookupConfig } from '../../../shared/renewal'
import { kindById, newRenewalMeta } from '../../../shared/renewalKinds'
import { looksLikeSecret, normalizeHost } from '../../../shared/renewalText'
import type { RenewalRecord } from '../../../shared/renewalApi'
import { json, notifyRenderer, text, z } from '../toolKit'

/** what an agent sees of a field; a key hint is left out, it identifies a key and an agent has no use for it */
function fieldValue(field: RenewalField): unknown {
  switch (field.type) {
    case 'money': return field.value ? formatMoney(field.value.amount, field.value.currency) : null
    case 'date': return field.value === null ? null : dueIso(field.value)
    default: return field.value
  }
}

function summarize(r: RenewalRecord, now: number): Record<string, unknown> {
  const kinds = getKinds()
  return {
    id: r.id,
    workspace: r.context,
    title: r.title,
    kind: kindById(kinds, r.meta.kind).name,
    status: r.status,
    expiresOn: r.meta.expiresAt === null ? null : dueIso(r.meta.expiresAt),
    expires: r.meta.expiresAt === null ? null : expiryPhrase(r.meta.expiresAt, now),
    renews: r.meta.renews,
    cycle: describeCycle(r.meta.cycle),
    warnDaysBefore: r.meta.warnAt,
    renewPage: r.meta.url || null,
    checkedAt: r.meta.lookup ? { source: r.meta.lookup.source, target: r.meta.lookup.target } : null,
    fields: r.meta.fields
      .filter(f => f.type !== 'keyHint')
      .map(f => ({ label: f.label, type: f.type, value: fieldValue(f) })),
    notes: r.body
  }
}

const CYCLES: Record<string, RenewalCycle> = {
  monthly: { every: 1, unit: 'month' },
  quarterly: { every: 3, unit: 'month' },
  yearly: { every: 1, unit: 'year' },
  once: 'once'
}

/** things that expire: keys, subscriptions, domains, certificates and the user's own kinds */
export function registerRenewalTools(mcp: McpServer): void {
  mcp.registerTool(
    'list_renewals',
    {
      description:
        'List things that expire and renew: API keys, subscriptions, domains, certificates, licences and kinds ' +
        'the user made. Each has an expiry date, how it renews and the user\'s own fields. Never contains secrets.',
      inputSchema: {
        context: z.string().optional().describe('Restrict to one workspace. Omit for every workspace.')
      }
    },
    async ({ context: ctx }) => {
      const now = Date.now()
      return json({ renewals: listRenewals(ctx, now).map(r => summarize(r, now)) })
    }
  )

  mcp.registerTool(
    'create_renewal',
    {
      description:
        'Track something that expires so the user is warned before it does. Never pass a key, password or card ' +
        'number: record where the secret lives in notes instead. Fields come from the kind\'s template, empty.',
      inputSchema: {
        context: z.string().describe('Workspace slug. Use list_workspaces to discover valid values.'),
        title: z.string().min(1).describe('A name the user will recognise, e.g. "acme.dev" or "OpenAI key (prod)".'),
        kind: z
          .string()
          .optional()
          .describe('Kind id: domain, certificate, api_key, subscription, licence, other, or one the user made. Defaults to other.'),
        expiresOn: z
          .string()
          .optional()
          .describe('YYYY-MM-DD for a whole day, which is how most things expire; add a time only when it matters.'),
        renews: z.enum(['auto', 'manual']).optional().describe('Defaults to the kind\'s own.'),
        cycle: z.enum(['monthly', 'quarterly', 'yearly', 'once']).optional().describe('Defaults to the kind\'s own.'),
        warnDaysBefore: z.array(z.number().int().min(0).max(365)).max(6).optional(),
        renewPage: z.string().url().optional().describe('Where to renew or pay.'),
        lookupTarget: z
          .string()
          .optional()
          .describe('Domain kind: the domain. Certificate kind: the host. Checkpoint then reads the real date itself.'),
        notes: z.string().optional()
      }
    },
    async ({ context: ctx, title, kind, expiresOn, renews, cycle, warnDaysBefore, renewPage, lookupTarget, notes }) => {
      // refused here, an agent pasting a key into a note would sync it to every device
      for (const value of [title, notes ?? '', lookupTarget ?? '']) {
        if (looksLikeSecret(value)) {
          return text('That looks like a key or token. Renewals never hold secrets: say where the key lives in notes instead.')
        }
      }
      const kinds = getKinds()
      const chosen = kindById(kinds, kind ?? 'other')
      if (kind && chosen.id !== kind) return text(`There is no kind "${kind}". Kinds: ${kinds.map(k => k.id).join(', ')}.`)

      let expiresAt: number | null = null
      if (expiresOn) {
        expiresAt = dueFromText(expiresOn)
        if (expiresAt === null) return text(`"${expiresOn}" is not a date. Use YYYY-MM-DD.`)
      }

      const meta = newRenewalMeta(chosen, () => crypto.randomUUID())
      let lookup: RenewalLookupConfig | null = null
      if (lookupTarget && chosen.lookupSource) {
        const target = chosen.lookupSource === 'rdap' ? normalizeHost(lookupTarget) : lookupTarget.trim()
        if (!target) return text(`"${lookupTarget}" is not a domain or host name.`)
        lookup = { source: chosen.lookupSource, target, port: null, auto: true }
      }
      const created = createRenewal({
        context: ctx,
        title,
        body: notes ?? '',
        meta: {
          ...meta,
          expiresAt,
          renews: renews ?? meta.renews,
          cycle: cycle ? CYCLES[cycle] : meta.cycle,
          warnAt: warnDaysBefore ?? meta.warnAt,
          url: renewPage ?? '',
          lookup
        }
      })
      if (!created.ok) return text(created.reason)

      recordMcpActivity('create_renewal', ctx, `Started tracking "${shorten(title)}"`, [{ kind: 'delete_renewal', id: created.value.id }])
      notifyRenderer()
      return json({ created: summarize(created.value, Date.now()) })
    }
  )
}
