import { afterAll, afterEach, describe, expect, it } from 'bun:test';
import type { NotificationDeliveryEnvelope } from '@flowkit/notify';

import { RuntimeHealthRepository } from '../src/db/runtime-health.repository';
import { PostgresOutboxStore, readDelivery } from '../src/db/postgres-outbox-store';
import { MailpitSmtpAdapter, type SmtpMail, type SmtpTransport } from '../src/notifications/mailpit-smtp.adapter';
import { createDeliveryAdapters, runDeliveryCycle } from '../src/notifications/delivery.worker';
import { PostgresInboxAdapter } from '../src/notifications/postgres-inbox.adapter';
import { durableTestDatabase } from './durable-test-database';

const approvedLeaveEnvelopes: NotificationDeliveryEnvelope[] = [
  {
    namespace: 'flowkit-demo', sourceKey: 'leave-1:approved', aggregate: { type: 'leave', id: 'leave-1' },
    templateKey: 'leave.accepted', channel: 'inbox', recipient: { channel: 'inbox', canonicalKey: 'employee-1', address: 'employee-1' },
    rendered: { subject: 'Leave approved', body: 'Approved', severity: 'success' }, dedupeKey: 'leave-1:approved:inbox',
    payloadFingerprint: 'payload-inbox', requestFingerprint: 'request-approved',
    retryPolicy: { maxAttempts: 3, initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 10_000 }, metadata: {},
  },
  {
    namespace: 'flowkit-demo', sourceKey: 'leave-1:approved', aggregate: { type: 'leave', id: 'leave-1' },
    templateKey: 'leave.accepted', channel: 'email', recipient: { channel: 'email', canonicalKey: 'employee-1', address: 'employee-1@example.test' },
    rendered: { subject: 'Leave approved', body: 'Approved', severity: 'success' }, dedupeKey: 'leave-1:approved:email',
    payloadFingerprint: 'payload-email', requestFingerprint: 'request-approved',
    retryPolicy: { maxAttempts: 3, initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 10_000 }, metadata: {},
  },
];

class RecordingSmtpTransport implements SmtpTransport {
  readonly sent: SmtpMail[] = [];

  async sendMail(message: SmtpMail) {
    this.sent.push(message);
    return { messageId: `mailpit-${this.sent.length}` };
  }
}

describe('Mailpit SMTP adapter', () => {
  it('uses the envelope dedupe key to avoid sending duplicate SMTP messages in one worker lifetime', async () => {
    const transport = new RecordingSmtpTransport();
    const adapter = new MailpitSmtpAdapter({ transport });
    const input = { envelope: approvedLeaveEnvelopes[1]!, attemptId: 'attempt-1' };

    const first = await adapter.send(input);
    const second = await adapter.send({ ...input, attemptId: 'attempt-2' });

    expect(adapter.idempotent).toBe(false);
    expect(transport.sent).toHaveLength(1);
    expect(first.providerMessageId).toBe(second.providerMessageId);
    expect(transport.sent[0]?.headers['X-Flowkit-Dedupe-Key']).toBe(approvedLeaveEnvelopes[1]?.dedupeKey);
  });
});

const sql = await durableTestDatabase('delivery worker', ['notification_outbox', 'notification_inbox', 'demo_runtime_state']);
const durableTests = sql ? describe : describe.skip;

afterEach(async () => {
  if (!sql) return;
  await sql`DELETE FROM notification_outbox`;
  await sql`DELETE FROM notification_inbox`;
  await sql`DELETE FROM demo_runtime_state`;
});
afterAll(async () => { if (sql) await sql.end({ timeout: 5 }); });

durableTests('delivery worker', () => {
  it('writes inbox delivery and sends one SMTP envelope for an approved leave', async () => {
    const outbox = new PostgresOutboxStore(sql!);
    const inbox = new PostgresInboxAdapter(sql!);
    const smtp = new RecordingSmtpTransport();
    const adapters = createDeliveryAdapters({ inbox, smtp: new MailpitSmtpAdapter({ transport: smtp }) });
    const health = new RuntimeHealthRepository(sql!);

    await outbox.insert(approvedLeaveEnvelopes);
    const result = await runDeliveryCycle({ owner: 'notify-test', outbox, adapters, health });

    expect(result.claimed).toBe(2);
    expect(await inbox.forUser('employee-1')).toHaveLength(1);
    expect(smtp.sent).toHaveLength(1);
    expect((await health.health('delivery-worker')).ready).toBe(true);
  });

  it('does not resend email after a worker lease expires before its receipt is recorded', async () => {
    const outbox = new PostgresOutboxStore(sql!);
    await outbox.insert([approvedLeaveEnvelopes[1]!]);
    const [claimed] = await outbox.claimDue('crashed-worker', new Date(), 1, 1);
    expect(claimed).toBeDefined();

    await outbox.recoverExpired(new Date(claimed!.leaseExpiresAt.getTime() + 1));
    expect(await readDelivery(sql!, claimed!.id)).toMatchObject({
      status: 'reconciliation_required',
      lastErrorCode: 'LEASE_EXPIRED',
    });

    const smtp = new RecordingSmtpTransport();
    const adapters = createDeliveryAdapters({
      inbox: new PostgresInboxAdapter(sql!),
      smtp: new MailpitSmtpAdapter({ transport: smtp }),
    });
    const result = await runDeliveryCycle({
      owner: 'replacement-worker', outbox, adapters, health: new RuntimeHealthRepository(sql!),
    });
    expect(result.claimed).toBe(0);
    expect(smtp.sent).toHaveLength(0);
  });

  it('lists the newest durable inbox notification first', async () => {
    await sql!`
      INSERT INTO notification_inbox (id, user_id, dedupe_key, subject, body, delivered_at)
      VALUES
        ('inbox-old', 'employee-1', 'inbox-order-old', 'Older', 'Older notification', '2026-07-29T10:00:00.000Z'),
        ('inbox-new', 'employee-1', 'inbox-order-new', 'Newer', 'Newer notification', '2026-07-29T11:00:00.000Z')
    `;
    const inbox = new PostgresInboxAdapter(sql!);
    expect((await inbox.forUser('employee-1')).map((notification) => notification.id)).toEqual(['inbox-new', 'inbox-old']);
  });
});
