import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import postgres, { type Sql } from 'postgres';

import { loadConfig } from '../src/config';
import { LeaveFlowRepository } from '../src/db/leave-flow.repository';
import { LeaveService } from '../src/leave/leave.service';

async function database(): Promise<Sql | null> {
  let client: Sql | undefined;
  try {
    client = postgres(loadConfig().DATABASE_URL, { max: 5, connect_timeout: 2 });
    const [row] = await client<{ requests: string | null; operations: string | null }[]>`
      SELECT to_regclass('public.leave_requests') AS requests, to_regclass('public.flow_task_projection_operations') AS operations
    `;
    if (!row?.requests || !row.operations) throw new Error('required durable projection tables are absent');
    return client;
  } catch (error) {
    if (client) await client.end({ timeout: 1 });
    process.stderr.write(`Skipping durable LeaveService tests: disposable database unavailable (${error instanceof Error ? error.message : String(error)}).\n`);
    return null;
  }
}

const sql = await database();
const durableTests = sql ? describe : describe.skip;

afterEach(async () => {
  if (!sql) return;
  await sql`DELETE FROM notification_outbox`;
  await sql`DELETE FROM flow_task_invitations`;
  await sql`DELETE FROM flow_task_projection_operations`;
  await sql`DELETE FROM flow_task_events`;
  await sql`DELETE FROM flow_tasks`;
  await sql`DELETE FROM leave_transitions`;
  await sql`DELETE FROM audit_events`;
  await sql`DELETE FROM leave_requests`;
});
afterAll(async () => { if (sql) await sql.end({ timeout: 5 }); });

durableTests('durable LeaveService composition', () => {
  it('projects API leave commands into PostgreSQL tasks and outbox envelopes', async () => {
    const durable = new LeaveService(new LeaveFlowRepository({ sql: sql! }));
    const leave = await durable.create({ managerId: 'manager-1', startDate: '2026-08-03', endDate: '2026-08-03', businessDays: 1, reason: 'Durable API', balanceDays: 10 }, 'employee-1');
    await durable.command(leave.id, { action: 'submit' }, { id: 'employee-1', roles: ['employee'] });
    expect((await durable.get(leave.id))?.state.stage).toBe('policy_evaluation');
    expect((await durable.outbox.claimDue('notify-1', new Date(), 60_000, 10)).length).toBeGreaterThan(0);
  });
});
