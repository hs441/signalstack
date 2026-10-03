/**
 * accounts — a company the scan has found evidence for.
 *
 * Written by the scan job (server-side, RBAC-bypassed), which stamps
 * `ownerUserId` from the enqueuing user. Clients may NOT write accounts at all
 * (`create`/`update`/`delete` false): triage (accept/reject) goes through the
 * `triageAccount` action so status + feedback are written atomically and
 * ownership is re-checked server-side. Deduplicated per user by normalized
 * `domain`.
 *
 * `heat`/`intent`/`fit` stored here are a CACHE. `fit` (LLM, doesn't decay) is
 * authoritative; `heat`/`intent` are recomputed at render time on the client
 * from live signals (src/lib/heat.ts) because heat decays with age — the stored
 * value is only a fallback sort key and the basis for the CRM note.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const accountsSchema: CollectionSchema = {
  name: 'accounts',
  columns: [
    { name: 'companyName', storage: 'text', interpretation: 'plain', required: true },
    { name: 'domain', storage: 'text', interpretation: 'plain', required: true },
    // Deterministic scores computed in src/lib/heat.ts.
    { name: 'fit', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'fitRationale', storage: 'text', interpretation: 'plain' },
    { name: 'fitComputedAt', storage: 'text', interpretation: 'datetime' },
    { name: 'intent', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'heat', storage: 'number', interpretation: 'plain', default: 0 },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['new', 'accepted', 'rejected'] },
      default: 'new',
    },
    { name: 'statusReason', storage: 'text', interpretation: 'plain' },
    { name: 'whyNow', storage: 'text', interpretation: 'plain' },
    // Cached draft opener + the signal it was grounded in, so reopening an
    // account shows the opener without another model call (only Regenerate re-calls).
    { name: 'opener', storage: 'text', interpretation: 'plain' },
    { name: 'openerSignalId', storage: 'text', interpretation: 'plain' },
    { name: 'lastSignalAt', storage: 'text', interpretation: 'datetime' },
    { name: 'icpId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'icps', displayColumn: 'name' } },
    { name: 'ownerUserId', storage: 'text', interpretation: 'plain', immutable: true },
  ],
  ownerField: 'ownerUserId',
  uniqueOn: ['ownerUserId', 'domain'],
  permissions: {
    // Read-only to clients; all writes go through server actions / the scan job.
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
