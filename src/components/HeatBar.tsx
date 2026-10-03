/**
 * HeatBar — a clear visual scale for an account's heat (0–100). Width + color
 * both encode heat; the number sits alongside so it's legible at a glance.
 */

import { heatStyle } from '../lib/heat-ui'

export function HeatBar({ heat, className = '' }: { heat: number; className?: string }) {
  const { color } = heatStyle(heat)
  const pct = Math.max(0, Math.min(100, heat))
  return (
    <div className={`flex items-center gap-2 ${className}`} title={`Heat ${heat}`}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-7 shrink-0 text-right text-xs font-semibold tabular-nums" style={{ color }}>
        {heat}
      </span>
    </div>
  )
}
