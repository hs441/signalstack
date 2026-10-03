/**
 * feedback — an accept/reject decision with a reason. Append-only. The scan
 * engine feeds the most recent ~10 of these back into the fit prompt as
 * calibration examples (prompt calibration, not ML). Private per user.
 *
 * Written server-side by the `triageAccount` action (which verifies the account
 * belongs to the caller, then updates the account status and writes the matching
 * feedback row together) — so `member.create` is false and clients never write
 * feedback directly.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const feedbackSchema: CollectionSchema = {
  name: 'feedback',
  columns: [
    { name: 'accountId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'accounts', displayColumn: 'companyName' }, required: true },
    { name: 'decision', storage: 'text', interpretation: { kind: 'select', options: ['accept', 'reject'] }, required: true },
    { name: 'reason', storage: 'text', interpretation: 'plain' },
    { name: 'ownerUserId', storage: 'text', interpretation: 'plain', immutable: true },
  ],
  ownerField: 'ownerUserId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
