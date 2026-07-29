import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import type { NotificationDeliveryEnvelope } from '@flowkit/notify';
import postgres, { type Sql } from 'postgres';

import { loadConfig } from '../src/config';
import { PostgresOutboxStore, readDelivery } from '../src/db/postgres-outbox-store';

const envelope: NotificationDeliveryEnvelope = {
  namespace: 'flowkit-demo', sourceKey: 'leave-1:approved', aggregate: { type: 'leave', id: 'leave-1' },
  templateKey: 'leave.accepted', channel: 'email', recipient: { channel: 'email', canonicalKey: 'employee-1', address: 'employee-1@example.test' },
  rendered: { subject: 'Leave approved', body: 'Approved', severity: 'success' }, dedupeKey: 'delivery-1',
  payloadFingerprint: 'payload-1', requestFingerprint: 'request-1',
  retryPolicy: { maxAttempts: 3, initialDelayMs: 1000, multiplier: 2, maxDelayMs: 10_000 }, metadata: {},
};

async function database(): Promise<Sql | null> {
  let client: Sql | undefined;
  try {
    client = postgres(loadConfig().DATABASE_URL, { max: 5, connect_timeout: 2 });
    const [row] = await client<{ outbox: string | null }[]>`SELECT to_regclass('public.notification_outbox') AS outbox`;
    if (!row?.outbox) throw new Error('notification_outbox is absent');
    return client;
  } catch (error) {
    if (client) await client.end({ timeout: 1 });
    process.stderr.write(`Skipping durable PostgresOutboxStore tests: disposable database unavailable (${error instanceof Error ? error.message : String(error)}).\n`);
    return null;
  }
}

const sql = await database();
const durableTests = sql ? describe : describe.skip;
afterEach(async () => { if (sql) await sql`DELETE FROM notification_outbox`; });
afterAll(async () => { if (sql) await sql.end({ timeout: 5 }); });

durableTests('PostgresOutboxStore', () => {
  it('leases and completes an outbox envelope exactly once', async () => {
    const client = sql!;
    const outbox = new PostgresOutboxStore(client);
    await outbox.insert([envelope]);
    const [claimed] = await outbox.claimDue('notify-1', new Date(), 60_000, 10);
    expect(claimed).toBeDefined();
    await outbox.recordDelivered({ id: claimed!.id, owner: 'notify-1', providerMessageId: 'mail-1' });
    expect(await readDelivery(client, claimed!.id)).toMatchObject({ status: 'delivered', providerMessageId: 'mail-1' });
  });
});
