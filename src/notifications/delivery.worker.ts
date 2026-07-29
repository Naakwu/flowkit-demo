import { NotificationAdapterRegistry, NotificationDeliveryRuntime, type RegisteredAdapter } from '@flowkit/notify';

import { loadConfig } from '../config';
import { PostgresOutboxStore } from '../db/postgres-outbox-store';
import { RuntimeHealthRepository } from '../db/runtime-health.repository';
import { MailpitSmtpAdapter } from './mailpit-smtp.adapter';
import { PostgresInboxAdapter } from './postgres-inbox.adapter';

const retryPolicy = { maxAttempts: 3, initialDelayMs: 1_000, multiplier: 2, maxDelayMs: 10_000 };

export function createDeliveryAdapters(options: { inbox: PostgresInboxAdapter; smtp: MailpitSmtpAdapter }): NotificationAdapterRegistry {
  const adapters = new NotificationAdapterRegistry();
  const registered: RegisteredAdapter[] = [
    { channel: options.inbox.channel, idempotent: options.inbox.idempotent, send: options.inbox.send.bind(options.inbox), enabled: true, retryPolicy },
    { channel: options.smtp.channel, idempotent: options.smtp.idempotent, send: options.smtp.send.bind(options.smtp), enabled: true, retryPolicy },
  ];
  for (const adapter of registered) adapters.register(adapter);
  adapters.freeze();
  return adapters;
}

export async function runDeliveryCycle(options: {
  owner: string;
  outbox: PostgresOutboxStore;
  adapters: NotificationAdapterRegistry;
  health: RuntimeHealthRepository;
}): Promise<{ claimed: number }> {
  const runtime = new NotificationDeliveryRuntime({ store: options.outbox, adapters: options.adapters });
  const claimed = await runtime.claimAndDeliver(options.owner, 50);
  await options.health.heartbeat('delivery-worker');
  return { claimed };
}

export function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, milliseconds);
    const onAbort = () => { clearTimeout(timer); done(); };
    function done() {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runDeliveryLoop(signal: AbortSignal, options: {
  owner: string;
  outbox: PostgresOutboxStore;
  adapters: NotificationAdapterRegistry;
  health: RuntimeHealthRepository;
  activePollMs?: number;
  idlePollMs?: number;
  logger?: Pick<Console, 'error'>;
}): Promise<void> {
  while (!signal.aborted) {
    let claimed = 0;
    try {
      ({ claimed } = await runDeliveryCycle(options));
    } catch (error) {
      options.logger?.error('Flowkit notification delivery cycle failed', error);
    }
    await sleep(claimed > 0 ? options.activePollMs ?? 100 : options.idlePollMs ?? 1_000, signal);
  }
}

if (import.meta.main) {
  const outbox = new PostgresOutboxStore();
  const inbox = new PostgresInboxAdapter(outbox.sql);
  const smtp = new MailpitSmtpAdapter();
  const adapters = createDeliveryAdapters({ inbox, smtp });
  const health = new RuntimeHealthRepository(outbox.sql);
  const config = loadConfig();
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  try {
    process.stdout.write(`${JSON.stringify({ status: 'ready', worker: 'delivery-worker' })}\n`);
    await runDeliveryLoop(controller.signal, {
      owner: `delivery-worker-${process.pid}`,
      outbox,
      adapters,
      health,
      activePollMs: config.FLOWKIT_DEMO_NOTIFY_ACTIVE_POLL_MS,
      idlePollMs: config.FLOWKIT_DEMO_NOTIFY_IDLE_POLL_MS,
      logger: console,
    });
  } finally {
    process.off('SIGTERM', stop);
    process.off('SIGINT', stop);
    await smtp.close();
    await outbox.close();
  }
}
