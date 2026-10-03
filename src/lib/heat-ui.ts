/**
 * Presentation helpers for heat + signals. Heat gets its own gradient scale
 * (cool → hot) so the single calm cyan theme accent isn't competing with it.
 */

import { Banknote, Layers, Rocket, Sparkles, UserPlus, type LucideIcon } from 'lucide-react'

export interface HeatStyle {
  /** Fill color for the heat bar. */
  color: string
  /** One-word band label. */
  label: string
}

/** Map a 0–100 heat to a band color + label. Cool at the bottom, hot at the top. */
export function heatStyle(heat: number): HeatStyle {
  if (heat >= 75) return { color: '#f97316', label: 'Hot' } // orange
  if (heat >= 55) return { color: '#f5a623', label: 'Warm' } // amber
  if (heat >= 35) return { color: '#2dd4bf', label: 'Mild' } // teal
  return { color: '#5a7a9a', label: 'Cool' } // slate-blue
}

export interface SignalMeta {
  label: string
  Icon: LucideIcon
  color: string
}

export const SIGNAL_META: Record<string, SignalMeta> = {
  funding: { label: 'Funding', Icon: Banknote, color: '#34d399' },
  hiring: { label: 'Hiring', Icon: UserPlus, color: '#60a5fa' },
  launch: { label: 'Launch', Icon: Rocket, color: '#f5a623' },
  stack: { label: 'Stack / pain', Icon: Layers, color: '#c084fc' },
  other: { label: 'Other', Icon: Sparkles, color: '#8b93a7' },
}

export function signalMeta(type: string): SignalMeta {
  return SIGNAL_META[type] ?? SIGNAL_META.other
}

/** Human "3 days ago" / "today" from an ISO date. */
export function relativeDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const days = Math.floor((Date.now() - t) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}
