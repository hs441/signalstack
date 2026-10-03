/**
 * Two-user isolation — the security-critical test. Proves DeepSpace RBAC +
 * the actions' ownership checks keep each user's data private:
 *   - User B cannot READ user A's accounts (the Board, backed by useQuery,
 *     never shows them — the RecordRoom drops them before the wire).
 *   - User B cannot ACT on A's account: triageAccount and crmPush refuse.
 *   - User A can act on its own (sanity, so the refusals aren't false-negatives).
 *
 * We seed each user one account + signal via the dev-only `__devSeedAccount`
 * action (gated by ALLOW_DEBUG_ROUTES) so the test is fast and deterministic —
 * no real scan. Actions are called from each signed-in browser context through
 * the `window.__callAction` test hook (reuses the user's JWT).
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import type { Page } from '@playwright/test'

const usableTestAccounts = loadAllTestAccounts().length
test.skip(
  usableTestAccounts < 2,
  `Needs 2 usable test accounts, found ${usableTestAccounts}. Create them with ` +
    '`npx deepspace test accounts create --email <name>@deepspace.test --name "<name>" --password-stdin`.',
)

type ActionResult<T = Record<string, unknown>> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string }

async function callAction<T = Record<string, unknown>>(
  page: Page,
  name: string,
  params: Record<string, unknown> = {},
): Promise<ActionResult<T>> {
  await page.waitForFunction(() => Boolean((window as unknown as { __callAction?: unknown }).__callAction), null, {
    timeout: 15_000,
  })
  return page.evaluate(
    ({ name, params }) =>
      (window as unknown as { __callAction: (n: string, p: Record<string, unknown>) => Promise<ActionResult> }).__callAction(name, params),
    { name, params },
  ) as Promise<ActionResult<T>>
}

async function seedAccount(page: Page, tag: string): Promise<{ accountId: string; company: string }> {
  await page.goto('/board')
  await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15_000 })
  const res = await callAction<{ accountId: string; company: string }>(page, '__devSeedAccount', { tag })
  expect(res.success, `seed failed: ${res.success ? '' : res.error}`).toBe(true)
  if (!res.success) throw new Error(res.error)
  return { accountId: res.data.accountId, company: res.data.company }
}

test('user B cannot read or act on user A’s account', async ({ users }) => {
  const [a, b] = await users(2)

  const aAcct = await seedAccount(a.page, 'A')
  const bAcct = await seedAccount(b.page, 'B')

  // READ isolation — reload each Board and compare what renders.
  await a.page.goto('/board')
  await expect(a.page.getByText(aAcct.company)).toBeVisible({ timeout: 15_000 })

  await b.page.goto('/board')
  await expect(b.page.getByText(bAcct.company)).toBeVisible({ timeout: 15_000 }) // B sees its own
  await expect(b.page.getByText(aAcct.company)).toHaveCount(0) // B never sees A's

  // WRITE isolation — B triaging A's account is refused.
  const bTriage = await callAction(b.page, 'triageAccount', {
    accountId: aAcct.accountId,
    decision: 'reject',
    reason: 'should be blocked',
  })
  expect(bTriage.success).toBe(false)

  // PUSH isolation — B pushing A's account is refused (before any CRM call).
  const bPush = await callAction(b.page, 'crmPush', { accountId: aAcct.accountId })
  expect(bPush.success).toBe(false)

  // Sanity — A CAN triage its own account, so the refusals above are real.
  const aTriage = await callAction(a.page, 'triageAccount', {
    accountId: aAcct.accountId,
    decision: 'accept',
    reason: 'owner can act',
  })
  expect(aTriage.success).toBe(true)
})
