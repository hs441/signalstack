/**
 * Client helper to call a server action (src/actions). Actions require a bearer
 * JWT (user-billed integrations forward it), so we attach one from getAuthToken.
 */

import { getAuthToken } from 'deepspace'

export type ActionResult<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

export async function callAction<T = unknown>(
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionResult<T>> {
  const token = await getAuthToken()
  if (!token) return { success: false, error: 'Sign in required', code: 'unauthorized' }
  try {
    const res = await fetch(`/api/actions/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(params),
    })
    const body = (await res.json()) as ActionResult<T>
    if (!res.ok && !('success' in body)) {
      return { success: false, error: `Request failed (${res.status})` }
    }
    return body
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

// Test hook: lets Playwright call authenticated actions from a signed-in browser
// context (it reuses getAuthToken). Harmless in prod — it's the same authed POST
// the app already makes, and every action enforces its own server-side gating.
if (typeof window !== 'undefined') {
  ;(window as unknown as { __callAction?: typeof callAction }).__callAction = callAction
}
