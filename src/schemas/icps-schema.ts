/**
 * icps — a user's Ideal Customer Profile.
 *
 * One ICP is "active" at a time (the brief scopes us to a single active ICP
 * per user). Private per user: `ownerUserId` is the owner, `userBound` so a
 * client can never create an ICP owned by someone else.
 */

import type { CollectionSchema } from 'deepspace/schema'

export const icpsSchema: CollectionSchema = {
  name: 'icps',
  columns: [
    { name: 'name', storage: 'text', interpretation: 'plain', required: true },
    // Free-text "who we sell to".
    { name: 'who', storage: 'text', interpretation: 'plain' },
    // JSON string[] — buying triggers to expand into search queries.
    { name: 'triggers', storage: 'text', interpretation: 'json' },
    // JSON string[] — disqualifiers (enterprise, agencies, non-software…).
    { name: 'disqualifiers', storage: 'text', interpretation: 'json' },
    { name: 'active', storage: 'number', interpretation: 'boolean', default: 1 },
    { name: 'rescanEnabled', storage: 'number', interpretation: 'boolean', default: 0 },
    // Which Composio CRM toolkit the user pushes to (e.g. 'hubspot').
    { name: 'crmToolkit', storage: 'text', interpretation: 'plain' },
    { name: 'ownerUserId', storage: 'text', interpretation: 'plain', userBound: true, immutable: true },
  ],
  ownerField: 'ownerUserId',
  permissions: {
    member: { read: 'own', create: true, update: 'own', delete: 'own' },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
