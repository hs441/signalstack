/**
 * scans — one run of the scan engine, with live progress the Board subscribes
 * to. Written server-side by the scan job; read-only to clients (they start a
 * scan via the jobs queue, not by creating a row here).
 */

import type { CollectionSchema } from 'deepspace/schema'

export const scansSchema: CollectionSchema = {
  name: 'scans',
  columns: [
    { name: 'icpId', storage: 'text', interpretation: { kind: 'reference', targetTable: 'icps', displayColumn: 'name' } },
    {
      name: 'status',
      storage: 'text',
      interpretation: { kind: 'select', options: ['running', 'done', 'failed'] },
      default: 'running',
    },
    { name: 'progress', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'stage', storage: 'text', interpretation: 'plain' },
    { name: 'queriesRun', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'candidatesFound', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'signalsVerified', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'accountsTouched', storage: 'number', interpretation: 'plain', default: 0 },
    { name: 'summary', storage: 'text', interpretation: 'plain' },
    { name: 'jobId', storage: 'text', interpretation: 'plain' },
    { name: 'errorMessage', storage: 'text', interpretation: 'plain' },
    { name: 'startedAt', storage: 'text', interpretation: 'datetime' },
    { name: 'finishedAt', storage: 'text', interpretation: 'datetime' },
    { name: 'ownerUserId', storage: 'text', interpretation: 'plain', immutable: true },
  ],
  ownerField: 'ownerUserId',
  permissions: {
    member: { read: 'own', create: false, update: false, delete: false },
    admin: { read: true, create: true, update: true, delete: true },
  },
}
