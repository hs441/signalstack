/**
 * Theme catalog.
 *
 * The scaffold ships two placeholder themes: `slate` (dark default, defined
 * in styles.css) and `paper` (light example, defined in themes.css). They
 * are scaffolding, not a design — give the app its own theme before first
 * deploy:
 *   1. Add a `[data-theme="my-id"] { ... }` block in src/themes.css with
 *      the shadcn token overrides (include `color-scheme: light;` for
 *      light themes).
 *   2. Add an entry here for type safety, autocomplete, and UI display.
 *   3. Add the theme's background to the first-paint <style> block in
 *      index.html so the pre-CSS frame matches (no white flash).
 *   4. Switch via `data-theme` on <html> in index.html.
 *
 * Color values live in styles.css / themes.css — this file is metadata only.
 */

export const THEMES = [
  {
    id: 'signal',
    label: 'Signal',
    description: 'Calm signal desk — deep ink, cool slate panels, one cyan accent.',
  },
  {
    id: 'slate',
    label: 'Slate',
    description: 'Neutral dark placeholder default.',
  },
  {
    id: 'paper',
    label: 'Paper',
    description: 'Light example theme showing the token contract.',
  },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

/** Read the currently active theme id from <html data-theme>. */
export function getActiveTheme(): ThemeId {
  if (typeof document === 'undefined') return 'signal'
  const id = document.documentElement.getAttribute('data-theme') as ThemeId | null
  return id ?? 'signal'
}

/** Look up a theme entry by id, or fall back to the first theme. */
export function getTheme(id: string) {
  return THEMES.find((t) => t.id === id) ?? THEMES[0]
}
