/**
 * The DeepSpace ICP preset — ships loaded so the demo answers "who should
 * DeepSpace sell to this week?". Wording refined from the brief; substance kept.
 */

import { DEFAULT_CRM_TOOLKIT } from '../constants'

export interface IcpInput {
  name: string
  who: string
  triggers: string[]
  disqualifiers: string[]
  crmToolkit: string
  rescanEnabled: boolean
  active: boolean
}

export const DEEPSPACE_PRESET: IcpInput = {
  name: 'DeepSpace ICP',
  who: 'Seed–Series B software teams building AI-native, real-time, or collaborative web apps. Typically 2–50 engineers, often small teams shipping fast with coding agents.',
  triggers: [
    'Launched an AI app or agent product on Hacker News, Product Hunt, or X',
    'Hiring full-stack or AI engineers',
    'Writing publicly about building realtime or multiplayer features, Cloudflare Workers, or Durable Objects',
    'Complaining publicly about stitching together auth, database, and sync',
    'Recently raised a seed or Series A round',
  ],
  disqualifiers: [
    'Large enterprises',
    'Agencies and consultancies',
    'Non-software businesses',
  ],
  crmToolkit: DEFAULT_CRM_TOOLKIT,
  rescanEnabled: false,
  active: true,
}
