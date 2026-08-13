import { describe, expect, it } from 'bun:test';

import { createCiStackPlan } from './stack-ci';

describe('createCiStackPlan', () => {
  it('builds the guarded disposable stack, migration, seed, browser, and cleanup path', () => {
    const plan = createCiStackPlan({
      CI: 'true',
      NODE_ENV: 'test',
      FLOWKIT_DEMO_CI_APPROVED: 'true',
      DATABASE_URL: 'postgresql://flowkit_demo:flowkit_demo@127.0.0.1:5441/flowkit_demo',
    });

    expect(plan.setup.map((step) => step.command.join(' '))).toEqual([
      'docker compose -p flowkit_demo_ci -f docker-compose.yml up -d --wait',
      'bun run db:migrate',
      'bun run db:seed',
    ]);
    expect(plan.children.map((child) => child.name)).toEqual(['api', 'worker', 'notify', 'web']);
    expect(plan.verify.command.join(' ')).toBe('bun run test:browser');
    expect(plan.cleanup.command.join(' ')).toBe('docker compose -p flowkit_demo_ci -f docker-compose.yml down -v');
    expect(plan.environment.FLOWKIT_DEMO_MIGRATION_APPROVED).toBe('true');
    expect(plan.environment.NODE_AUTH_TOKEN).toBeUndefined();
  });

  it('defaults NODE_ENV to test for candidate CI callers', () => {
    const plan = createCiStackPlan({ CI: 'true' });
    expect(plan.environment.NODE_ENV).toBe('test');
  });

  it.each([
    [{ CI: 'false', NODE_ENV: 'test', FLOWKIT_DEMO_CI_APPROVED: 'true' }, 'CI=true'],
    [{ CI: 'true', NODE_ENV: 'development', FLOWKIT_DEMO_CI_APPROVED: 'true' }, 'NODE_ENV=test'],
    [{ CI: 'true', NODE_ENV: 'test', FLOWKIT_DEMO_CI_APPROVED: 'true', DATABASE_URL: 'postgresql://x:x@db.example.com/flowkit_demo' }, 'disposable loopback'],
  ] as const)('rejects an unsafe CI invocation', (environment, message) => {
    expect(() => createCiStackPlan(environment)).toThrow(message);
  });
});
