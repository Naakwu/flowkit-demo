import { expect, test } from '@playwright/test';

const demoUrl = process.env.FLOWKIT_DEMO_URL ?? 'http://localhost:3011';
const mailpitUrl = process.env.FLOWKIT_DEMO_MAILPIT_URL ?? 'http://localhost:8025';

test('Mailpit exposes the approval email delivered for a browser-created Flowkit request', async ({ page, request }, testInfo) => {
  testInfo.setTimeout(60_000);
  await page.goto(demoUrl);
  await expect(page.locator('#runtime-status')).toHaveText('ALL READY');
  await page.getByLabel('Business days').fill('5');
  await page.getByLabel('Reason').fill(`Mailpit reference journey ${Date.now()}`);
  await page.getByRole('button', { name: 'Create request' }).click();
  // The submit control only renders once the console has read the created flow back.
  await expect(page.getByRole('button', { name: 'Submit request' })).toBeVisible();
  const requestId = (await page.locator('#flow-title').textContent())?.trim();
  if (!requestId) throw new Error('Flowkit did not return a leave request identifier.');
  await page.getByRole('button', { name: 'Submit request' }).click();
  await expect(page.locator('#flow-badge')).toHaveText('MANAGER REVIEW');
  await page.getByLabel('Switch demo operator').selectOption('manager-1');
  // The shared stack's queue may hold earlier runs' work, so scope the claim to this request.
  await page.locator('.task-row', { hasText: requestId }).getByRole('button', { name: 'Claim task' }).click();
  await page.getByRole('button', { name: 'Approve request' }).click();

  await expect.poll(async () => {
    const response = await request.get(`${mailpitUrl}/api/v1/messages`);
    expect(response.ok()).toBeTruthy();
    const body = await response.json() as { messages?: Array<{ Subject?: string }> };
    return body.messages?.some((message) => message.Subject?.includes(requestId) && /approved/i.test(message.Subject)) ?? false;
  }, { timeout: 30_000 }).toBe(true);
});
