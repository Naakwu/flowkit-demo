import { expect, test, type Page } from '@playwright/test';

const demoUrl = process.env.FLOWKIT_DEMO_URL ?? 'http://localhost:3011';
const mailpitUrl = new URL(process.env.FLOWKIT_DEMO_MAILPIT_URL ?? 'http://localhost:8025').href;

type ReviewDecision = 'approve' | 'reject';

/**
 * The suite runs against a shared, already-running stack, so the manager queue legitimately holds
 * work from earlier runs. Every queue interaction is scoped to the request under test rather than
 * assuming a pristine database.
 */
function claimButtonFor(page: Page, requestId: string) {
  return page.locator('.task-row', { hasText: requestId }).getByRole('button', { name: 'Claim task' });
}

async function createAndSubmitMultiDayLeave(page: Page): Promise<string> {
  await page.goto(demoUrl);
  await expect(page.getByText('Demo operator · Employee')).toBeVisible();
  await expect(page.locator('#runtime-status')).toHaveText('ALL READY');
  await expect(page.locator('#mailpit-preview-link')).toHaveAttribute('href', mailpitUrl);

  await page.getByLabel('Business days').fill('5');
  await page.getByLabel('Reason').fill(`Browser reference journey ${Date.now()}`);
  await page.getByRole('button', { name: 'Create request' }).click();
  await expect(page.getByRole('button', { name: 'Submit request' })).toBeVisible();

  const requestId = (await page.locator('#flow-title').textContent())?.trim();
  if (!requestId) throw new Error('Flowkit did not return a leave request identifier.');

  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.locator('#flow-badge')).toHaveText('MANAGER REVIEW');
  return requestId;
}

async function reviewLeave(page: Page, decision: ReviewDecision): Promise<string> {
  const requestId = await createAndSubmitMultiDayLeave(page);

  await page.getByLabel('Switch demo operator').selectOption('manager-1');
  await expect(page.getByText('Demo operator · Manager')).toBeVisible();
  await expect(claimButtonFor(page, requestId)).toBeVisible();
  await claimButtonFor(page, requestId).click();

  const buttonName = decision === 'approve' ? 'Approve request' : 'Reject request';
  await expect(page.getByRole('button', { name: buttonName })).toBeVisible();
  await page.getByRole('button', { name: buttonName }).click();

  await expect(page.locator('#flow-badge')).toHaveText(decision === 'approve' ? 'APPROVED' : 'REJECTED');
  await expect(page.locator('#activity-timeline')).toContainText(decision);
  await expect(page.locator('body')).not.toContainText(/temporal|namespace|task queue/i);
  return requestId;
}

test('employee submits multi-day leave and the assigned manager claims then approves it', async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000);
  const requestId = await reviewLeave(page, 'approve');

  await page.getByLabel('Switch demo operator').selectOption('employee-1');
  await expect(page.getByText('Demo operator · Employee')).toBeVisible();
  await expect(page.locator('#flow-title')).toHaveText(requestId);
  await expect(page.locator('#flow-badge')).toHaveText('APPROVED');
  await expect.poll(
    () => page.locator('#notifications-list').textContent(),
    { timeout: 30_000, message: 'the console should refresh until the durable approval notice is visible' },
  ).toContain('approved');
  await expect(page.locator('#runtime-status')).toHaveText('ALL READY');
});

test('the assigned manager can reject a claimed multi-day request', async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000);
  await reviewLeave(page, 'reject');
});
