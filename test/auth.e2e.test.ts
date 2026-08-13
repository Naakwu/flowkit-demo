import { describe, expect, it } from 'bun:test';

import { auth } from '../apps/api/src/auth/auth.config';

function post(path: string, body: unknown) {
  return auth.handler(new Request(`http://localhost:3011${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }));
}

describe('BetterAuth HTTP boundary', () => {
  it('does not expose the removed development identity-switcher login', async () => {
    const response = await post('/auth/login', { userId: 'manager-1' });

    expect(response.status).toBe(404);
  });

  it('exposes BetterAuth email/password validation at its configured base path', async () => {
    const response = await post('/api/auth/sign-in/email', {});
    const payload = await response.json() as { code: string };

    expect(response.status).toBe(400);
    expect(payload.code).toBe('VALIDATION_ERROR');
  });

  it('rejects unauthenticated organization creation before database access', async () => {
    const response = await post('/api/auth/organization/create', {
      name: 'Body Controlled Organization',
      slug: 'body-controlled-organization',
    });

    expect(response.status).toBe(401);
  });
});
