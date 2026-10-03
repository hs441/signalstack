/**
 * signals — one evidence-backed buying trigger attached to an account.
 *
 * Every signal MUST carry a source URL and an evidence quote (brief rule:
 * "evidence or it didn't happen"). Written server-side by the scan job only;
 * read-only to clients. Deduplicated per user by account + source URL + type.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const signalsSchema: CollectionSchema = {
  name: 'signals',
  columns: [
    { name: 'accountId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'accounts', displayColumn: 'companyName' }, required: true },
    {
      name: 'type',
      storage: 'text',
      interpretation: { kind: 'select', options: ['funding', 'hiring', 'launch', 'stack', 'other'] },
      required: true,
    },
    { name: 'evidenceQuote', storage: 'text', interpretation: 'plain', required: true },
    { name: 'sourceUrl', storage: 'text', interpretation: 'url', required: true },
    { name: 'signalDate', storage: 'text', interpretation: 'date' },
    // Which search provider surfaced this signal ('exa' | 'firecrawl') — so we
    // can report verified-signal and false-positive rates per provider.
    { name: 'provider', storage: 'text', interpretation: 'plain' },
    { name: 'confidence', storage: 'number', interpretation: 'plain', default: 0 },
    // Snapshot of the type weight used at scoring time (src/lib/heat.ts).
    { name: 'weight', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'ownerUserId', storage: 'text', interpretation: 'plain', immutable: true },
  ],
  ownerField: 'ownerUserId',
  uniqueOn: ['ownerUserId', 'accountId', 'sourceUrl', 'type'],
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
