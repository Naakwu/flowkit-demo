import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'bun:test';
import type { Sql } from 'postgres';

import { loadConfig } from '@flowkit-demo/domain';
import { DemoSessionService } from '../apps/api/src/auth/demo-session.service';

function fakeDatabase(user: { id: string; role_key: string }) {
  const sql = (async () => [user]) as unknown as Sql;
  sql.end = async () => undefined;
  return sql;
}

async function expectUnauthorized(promise: Promise<unknown>) {
  try {
    await promise;
    throw new Error('Expected an unauthorized session error.');
  } catch (error) {
    expect(error).toBeInstanceOf(UnauthorizedException);
    expect((error as UnauthorizedException).getStatus()).toBe(401);
  }
}

describe('DemoSessionService', () => {
  it('signs a session for the canonical role loaded from its database record', async () => {
    const now = new Date('2026-07-29T00:00:00.000Z');
    const service = new DemoSessionService({
      config: () => loadConfig({ NODE_ENV: 'test', BETTER_AUTH_SECRET: 'test-secret-that-is-longer-than-thirty-two' }),
      createDatabaseClient: () => fakeDatabase({ id: 'employee-1', role_key: 'manager' }),
      now: () => now,
    });

    const session = await service.create('employee-1');
    expect(session.principal).toMatchObject({ subjectId: 'employee-1', role: 'manager' });
    await expect(service.verify(session.token)).resolves.toMatchObject({ subjectId: 'employee-1', role: 'manager' });
  });

  it('returns 401 for malformed, tampered, and expired tokens', async () => {
    let now = new Date('2026-07-29T00:00:00.000Z');
    const service = new DemoSessionService({
      config: () => loadConfig({ NODE_ENV: 'test', BETTER_AUTH_SECRET: 'test-secret-that-is-longer-than-thirty-two' }),
      createDatabaseClient: () => fakeDatabase({ id: 'employee-1', role_key: 'employee' }),
      now: () => now,
    });
    const { token } = await service.create('employee-1');

    await expectUnauthorized(service.verify('malformed-token'));
    await expectUnauthorized(service.verify(`${token}tampered`));
    now = new Date('2026-07-30T00:00:00.000Z');
    await expectUnauthorized(service.verify(token));
  });
});
