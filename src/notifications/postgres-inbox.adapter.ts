import type { NotificationChannelAdapter, NotificationDeliveryEnvelope } from '@flowkit/notify';
import type { Sql } from 'postgres';
import { randomUUID } from 'node:crypto';

import { createDemoDatabaseClient } from '../db/client';

type InboxRow = {
  id: string;
  user_id: string;
  dedupe_key: string;
  subject: string;
  body: string;
  read_at: Date | string | null;
};

/** Durable in-app notification delivery keyed by the Flowkit envelope dedupe key. */
export class PostgresInboxAdapter implements NotificationChannelAdapter {
  readonly channel = 'inbox';
  readonly idempotent = true;
  private readonly ownsClient: boolean;
  readonly sql: Sql;

  constructor(sql?: Sql) {
    this.ownsClient = !sql;
    this.sql = sql ?? createDemoDatabaseClient();
  }

  async send(input: { envelope: NotificationDeliveryEnvelope; attemptId: string }) {
    const { envelope } = input;
    const [row] = await this.sql<{ id: string }[]>`
      INSERT INTO notification_inbox (id, user_id, dedupe_key, subject, body)
      VALUES (
        ${`inbox-${randomUUID()}`}, ${envelope.recipient.canonicalKey}, ${envelope.dedupeKey},
        ${envelope.rendered.subject}, ${envelope.rendered.body}
      )
      ON CONFLICT (dedupe_key) DO UPDATE SET dedupe_key = EXCLUDED.dedupe_key
      RETURNING id
    `;
    if (!row) throw new Error('notification inbox delivery did not return a row');
    return { providerMessageId: row.id };
  }

  async forUser(userId: string): Promise<Array<{ id: string; dedupeKey: string; subject: string; body: string; readAt: Date | null }>> {
    const rows = await this.sql<InboxRow[]>`
      SELECT id, user_id, dedupe_key, subject, body, read_at
      FROM notification_inbox
      WHERE user_id = ${userId}
      ORDER BY id ASC
    `;
    return rows.map((row) => ({
      id: row.id,
      dedupeKey: row.dedupe_key,
      subject: row.subject,
      body: row.body,
      readAt: row.read_at ? new Date(row.read_at) : null,
    }));
  }

  async close(): Promise<void> {
    if (this.ownsClient) await this.sql.end({ timeout: 5 });
  }
}
