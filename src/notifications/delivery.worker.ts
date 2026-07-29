import { NotificationAdapterRegistry, NotificationDeliveryRuntime, testAdapter } from '@flowkit/notify';

import { PostgresOutboxStore } from '../db/postgres-outbox-store';
import { RuntimeHealthRepository } from '../db/runtime-health.repository';

export async function deliverDemoOutbox(store = new PostgresOutboxStore()) { const adapters = new NotificationAdapterRegistry(); adapters.register({ ...testAdapter('inbox'), enabled: true }); adapters.register({ ...testAdapter('email'), enabled: true }); adapters.freeze(); const runtime = new NotificationDeliveryRuntime({ store, adapters }); return runtime.claimAndDeliver('demo-worker', 100); }
if (import.meta.main) {
  const outbox = new PostgresOutboxStore();
  const health = new RuntimeHealthRepository(outbox.sql);
  try {
    const result = await deliverDemoOutbox(outbox);
    await health.heartbeat('notification-worker');
    process.stdout.write(`${JSON.stringify({ status: 'ready', delivered: result })}\n`);
  } finally {
    await outbox.close();
  }
}
