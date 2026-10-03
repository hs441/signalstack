/**
 * Landing — a STATIC page (no providers, prerendered). Keep it renderable
 * without a browser: no hooks, no window/document at render.
 */

import { Link } from 'react-router-dom'
import { Banknote, Layers, Radar, Rocket, UserPlus } from 'lucide-react'
import { Seo } from '../components/Seo'
import { APP_NAME } from '../constants'
import { seo } from '../seo'

const TRIGGERS = [
  { Icon: Banknote, label: 'Funding' },
  { Icon: UserPlus, label: 'Hiring' },
  { Icon: Rocket, label: 'Launches' },
  { Icon: Layers, label: 'Stack & pain' },
]

export default function Landing() {
  return (
    <>
      <Seo {...seo} path="/" />
      <div data-testid="static-landing" className="min-h-screen bg-background text-foreground">
        <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Radar className="h-4 w-4 text-primary" aria-hidden />
            {APP_NAME}
          </span>
          <Link to="/home" className="rounded-md bg-primary px-3.5 py-1.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
            Open the desk
          </Link>
        </header>

        <main className="mx-auto max-w-3xl px-6 pb-20 pt-10 text-center sm:pt-20">
          <p className="mb-4 text-xs uppercase tracking-[0.2em] text-muted-foreground">Signal-stacking ICP finder</p>
          <h1 className="mx-auto max-w-2xl text-4xl font-bold tracking-tight sm:text-5xl">
            Know who to contact this week — and why now.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-muted-foreground">
            Describe your ideal customer and the triggers you care about. {APP_NAME} scans the public
            web, attaches evidence-backed signals to company accounts, and ranks them by heat —
            ICP fit × how recent and numerous the signals are. Every score cites its source.
          </p>

          <div className="mt-8 flex items-center justify-center gap-3">
            <Link to="/home" className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90">
              Open the desk
            </Link>
            <Link to="/home" className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-card">
              See the DeepSpace ICP demo
            </Link>
          </div>

          <div className="mt-14 flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
            {TRIGGERS.map(({ Icon, label }) => (
              <span key={label} className="inline-flex items-center gap-2 text-sm text-muted-foreground">
                <Icon className="h-4 w-4 text-primary/80" aria-hidden />
                {label}
              </span>
            ))}
          </div>

          <div className="mx-auto mt-16 grid max-w-2xl gap-4 text-left sm:grid-cols-3">
            <Feature title="Account-level" body="Signals stack on a company over time and decay with age — not a one-shot list." />
            <Feature title="Evidence or it didn't happen" body="Every signal carries a source URL and a quote. The score cites it." />
            <Feature title="Draft, never send" body="Openers are drafted for copy-paste, grounded in the strongest recent signal." />
          </div>
        </main>
      </div>
    </>
  )
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  )
}
