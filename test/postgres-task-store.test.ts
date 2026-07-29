import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import { buildInitialState, type FlowState } from '@flowkit/core';
import { planTaskProjection, type FlowTask } from '@flowkit/tasks';

import { PostgresTaskStore } from '../src/db/postgres-task-store';
import { leaveDefinition } from '../src/leave/leave.definition';
import { durableTestDatabase } from './durable-test-database';

const sql = await durableTestDatabase('PostgresTaskStore', ['flow_tasks', 'flow_task_events', 'flow_task_projection_operations', 'flow_task_invitations']);
const durableTests = sql ? describe : describe.skip;

async function clearTasks() {
  if (!sql) return;
  await sql`DELETE FROM flow_task_invitations`;
  await sql`DELETE FROM flow_task_projection_operations`;
  await sql`DELETE FROM flow_task_events`;
  await sql`DELETE FROM flow_tasks`;
}

afterEach(clearTasks);
afterAll(async () => { if (sql) await sql.end({ timeout: 5 }); });

durableTests('PostgresTaskStore', () => {
  it('allows only one manager to claim an open task revision', async () => {
    const store = new PostgresTaskStore(sql!);
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

  it('keeps a claimant\'s task alongside other open role tasks', async () => {
    const store = new PostgresTaskStore(sql!);
    const initial = buildInitialState(leaveDefinition);
    const managerReview: FlowState = { stage: 'manager_review', status: 'active', pendingRole: 'manager', tracks: {} };
    const first = (await store.applyProjection({ plan: planTaskProjection({
      namespace: 'flowkit-demo', flowId: 'leave-inbox-1', subject: { type: 'leave', id: 'leave-inbox-1' }, definition: leaveDefinition,
      operationId: 'inbox-1', transitionSequence: 1, action: 'require_manager', actorId: 'system', previousState: initial, nextState: managerReview, metadata: {},
    }, null), operationId: 'inbox-1' })).tasks[0]!;
    const second = (await store.applyProjection({ plan: planTaskProjection({
      namespace: 'flowkit-demo', flowId: 'leave-inbox-2', subject: { type: 'leave', id: 'leave-inbox-2' }, definition: leaveDefinition,
      operationId: 'inbox-2', transitionSequence: 1, action: 'require_manager', actorId: 'system', previousState: initial, nextState: managerReview, metadata: {},
    }, null), operationId: 'inbox-2' })).tasks[0]!;
    await store.claim({ taskId: first.id, expectedRevision: first.revision, actorId: 'manager-1', operationId: 'inbox-claim-1', now: new Date().toISOString() });

    const mine = await store.inbox({ view: 'role_queue', actorId: 'manager-1', roles: ['manager'], statuses: ['open', 'claimed'] });
    const otherManager = await store.inbox({ view: 'role_queue', actorId: 'manager-2', roles: ['manager'], statuses: ['open', 'claimed'] });

    expect(mine.items.map((task) => task.id).sort()).toEqual([first.id, second.id].sort());
    expect(otherManager.items.map((task) => task.id)).toEqual([second.id]);
  });

  it('keeps the original opener and commits a two-mutation projection once', async () => {
    const store = new PostgresTaskStore(sql!);
    const initial = buildInitialState(leaveDefinition);
    const managerReview: FlowState = { stage: 'manager_review', status: 'active', pendingRole: 'manager', tracks: {} };
    const opened = await store.applyProjection({ plan: planTaskProjection({
      namespace: 'flowkit-demo', flowId: 'leave-route-2', subject: { type: 'leave', id: 'leave-route-2' }, definition: leaveDefinition,
      operationId: 'route-2-open', transitionSequence: 1, action: 'require_manager', actorId: 'system', previousState: initial, nextState: managerReview, metadata: {},
    }, null), operationId: 'route-2-open' });
    const prior = opened.tasks[0]!;
    const plan = planTaskProjection({
      namespace: 'flowkit-demo', flowId: 'leave-route-2', subject: { type: 'leave', id: 'leave-route-2' }, definition: leaveDefinition,
      operationId: 'route-2-return', transitionSequence: 2, action: 'return', actorId: 'manager-1', previousState: managerReview, nextState: initial, metadata: {},
    }, prior);
    expect(plan.mutations).toHaveLength(2);
    const [first, duplicate] = await Promise.all([
      store.applyProjection({ plan, operationId: 'route-2-return' }),
      store.applyProjection({ plan, operationId: 'route-2-return' }),
    ]);
    expect([first, duplicate].filter((result) => result.created)).toHaveLength(1);
    const tasks = (first.created ? first : duplicate).tasks;
    expect(tasks.map((task: FlowTask) => task.status).sort()).toEqual(['completed', 'open']);
    expect((await store.get(prior.id))?.openedOperationId).toBe('route-2-open');
  });
});
