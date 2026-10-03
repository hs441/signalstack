/**
 * Client-facing record data shapes (the `data` inside RecordData<T>). Mirror of
 * the schemas in src/schemas/. Server scan types live in src/lib/scan/types.ts.
 */

export interface IcpData {
  name: string
  who: string
  triggers: string[]
  disqualifiers: string[]
  active: boolean
  rescanEnabled: boolean
  crmToolkit: string
  ownerUserId: string
}

export type AccountStatus = 'new' | 'accepted' | 'rejected'

export interface AccountData {
  companyName: string
  domain: string
  fit: number
  fitRationale: string
  fitComputedAt?: string
  intent: number
  heat: number
  status: AccountStatus
  statusReason?: string
  whyNow: string
  opener?: string
  openerSignalId?: string
  lastSignalAt?: string
  icpId: string
  ownerUserId: string
}

export type SignalType = 'funding' | 'hiring' | 'launch' | 'stack' | 'other'

export interface SignalData {
  accountId: string
  type: SignalType
  evidenceQuote: string
  sourceUrl: string
  signalDate: string | null
  provider: string
  confidence: number
  weight: number
  ownerUserId: string
}

export type ScanStatus = 'running' | 'done' | 'failed'

export interface ScanData {
  icpId: string
  status: ScanStatus
  progress: number
  stage: string
  queriesRun: number
  candidatesFound: number
  signalsVerified: number
  accountsTouched: number
  summary?: string
  jobId?: string
  errorMessage?: string
  startedAt?: string
  finishedAt?: string
  ownerUserId: string
}

export interface CrmPushData {
  accountId: string
  toolkit: string
  externalId?: string
  externalUrl?: string
  noteExternalId?: string
  status: 'pushed' | 'updated' | 'failed'
  pushedAt?: string
  ownerUserId: string
}
