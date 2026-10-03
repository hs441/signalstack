/**
 * crmPushes — record of a push to the user's own CRM (via Composio per-user
 * OAuth). One row per (user, CRM toolkit, account) via `uniqueOn` so a second
 * push to the SAME CRM updates rather than duplicates, while pushing an account
 * to a different CRM is its own row. Written server-side by the push action;
 * read-only to clients (they render the "View in CRM" link from it).
 */

import type { CollectionSchema } from 'deepspace/schema'

export const crmPushesSchema: CollectionSchema = {
  name: 'crmPushes',
  columns: [
    { name: 'accountId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'accounts', displayColumn: 'companyName' }, required: true },
    { name: 'toolkit', storage: 'text', interpretation: 'plain' },
    // External CRM company id + deep link, plus the note's id, for idempotent re-push.
    { name: 'externalId', storage: 'text', interpretation: 'plain' },
    { name: 'externalUrl', storage: 'text', interpretation: 'url' },
    { name: 'noteExternalId', storage: 'text', interpretation: 'plain' },
    { name: 'status', storage: 'text', interpretation: { kind: 'select', options: ['pushed', 'updated', 'failed'] } },
    { name: 'pushedAt', storage: 'text', interpretation: 'datetime' },
    { name: 'ownerUserId', storage: 'text', interpretation: 'plain', immutable: true },
  ],
  ownerField: 'ownerUserId',
  uniqueOn: ['ownerUserId', 'toolkit', 'accountId'],
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
