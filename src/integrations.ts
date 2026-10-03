/**
 * Integration Billing Config
 *
 * Configure who pays for each integration's API calls.
 *
 * - 'developer': The app owner pays (default). Works for anonymous users.
 * - 'user': The calling user pays. Requires sign-in.
 *
 * Integrations not listed here default to 'developer'.
 *
 * IMPORTANT: any integration backed by per-user OAuth tokens (Google,
 * etc.) must be 'user' — the api-worker looks up the row keyed by the
 * JWT subject. With 'developer' the app owner's JWT is forwarded and
 * the handler operates on the app owner's connected account regardless
 * of who's signed in client-side.
 */

export const integrations: Record<string, { billing: 'developer' | 'user' }> = {
  // CRM push runs on the calling USER's own Composio-connected account, so it
  // MUST be user-billed — otherwise the api-worker forwards the app owner's JWT
  // and every push lands in the owner's CRM. This is the brief's "per-user CRM".
  composio: { billing: 'user' },

  // Search + LLM run inside the scan background job with app-owner privileges
  // (billed to the owner). The per-user *scan cap* in src/constants.ts bounds
  // that spend. Left at the 'developer' default (listed here for intent):
  firecrawl: { billing: 'developer' },
  anthropic: { billing: 'developer' },
}
