/**
 * Collection Schemas
 *
 * All collections with columns and RBAC permissions.
 * Single source of truth — imported by both worker and frontend.
 *
 * Add schemas by creating a file in src/schemas/ and importing it here.
 *
 * Every SignalStack collection is private to one user: each has an
 * `ownerUserId` column + `ownerField: 'ownerUserId'` and `read/update/delete:
 * 'own'`. Client-created collections (icps, feedback) mark `ownerUserId`
 * `userBound` so a client can't forge another user's id; server-created ones
 * (accounts, signals, scans, crmPushes) set `member.create: false` so only the
 * privileged scan job / push action can write them.
 */

import type { CollectionSchema } from 'deepspace/schema'
import { usersSchema } from './schemas/users-schema'
import { settingsSchema } from './schemas/admin-schema'
import { icpsSchema } from './schemas/icps-schema'
import { accountsSchema } from './schemas/accounts-schema'
import { signalsSchema } from './schemas/signals-schema'
import { scansSchema } from './schemas/scans-schema'
import { feedbackSchema } from './schemas/feedback-schema'
import { crmPushesSchema } from './schemas/crm-pushes-schema'

export const schemas: CollectionSchema[] = [
  usersSchema,
  settingsSchema,
  icpsSchema,
  accountsSchema,
  signalsSchema,
  scansSchema,
  feedbackSchema,
  crmPushesSchema,
]
