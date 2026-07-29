import { afterEach, describe, expect, it } from 'bun:test';
import { buildInitialState, type FlowState } from '@flowkit/core';
import { planTaskProjection } from '@flowkit/tasks';
import postgres, { type Sql } from 'postgres';

import { loadConfig } from '../src/config';
import { PostgresTaskStore } from '../src/db/postgres-task-store';
import { leaveDefinition } from '../src/leave/leave.definition';

const durableTests = process.env.FLOWKIT_DEMO_DURABLE_TESTS === 'true' ? describe : describe.skip;
let sql: Sql | undefined;

async function database(): Promise<Sql> {
  sql ??= postgres(loadConfig().DATABASE_URL, { max: 5 });
  return sql;
}

async function clearTasks() {
  if (!sql) return;
  await sql`DELETE FROM flow_task_events`;
  await sql`DELETE FROM flow_tasks`;
}

afterEach(clearTasks);

durableTests('PostgresTaskStore', () => {
  it('allows only one manager to claim an open task revision', async () => {
    const store = new PostgresTaskStore(await database());
    const initial = buildInitialState(leaveDefinition);
    const managerReview: FlowState = { stage: 'manager_review', status: 'active', pendingRole: 'manager', tracks: {} };
    const managerReviewPlan = planTaskProjection({
      namespace: 'flowkit-demo', flowId: 'leave-route-1', subject: { type: 'leave', id: 'leave-route-1' },
      definition: leaveDefinition, operationId: 'route-1', transitionSequence: 1, action: 'require_manager', actorId: 'system',
      previousState: initial, nextState: managerReview, metadata: {},
    }, null);
    const task = (await store.applyProjection({ plan: managerReviewPlan, operationId: 'route-1' })).tasks[0]!;
    const now = new Date().toISOString();
    const results = await Promise.all([
      store.claim({ taskId: task.id, expectedRevision: 0, actorId: 'manager-1', operationId: 'claim-1', now }),
      store.claim({ taskId: task.id, expectedRevision: 0, actorId: 'manager-2', operationId: 'claim-2', now }),
    ]);
    expect(results.filter((result) => result.task)).toHaveLength(1);
  });
});
