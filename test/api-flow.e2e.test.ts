import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import type { AuthenticatedPrincipal } from '@flowkit/auth';

import { DemoAuthController } from '../src/api/auth.module';
import { FlowController } from '../src/api/flow.controller';
import { NotificationsController } from '../src/api/notifications.controller';
import { RuntimeController } from '../src/api/runtime.controller';
import { TasksController } from '../src/api/tasks.controller';
import { DemoSessionGuard } from '../src/auth/demo-session.guard';
import { DemoSessionService } from '../src/auth/demo-session.service';
import { principal } from '../src/auth/principal.adapters';
import { RuntimeHealthRepository } from '../src/db/runtime-health.repository';
import { FlowkitDemoConsumer } from '../src/flow/flowkit-demo.consumer';

const fiveDayLeave = {
  managerId: 'manager-1',
  startDate: '2026-08-03',
  endDate: '2026-08-07',
  businessDays: 5,
  reason: 'Family travel',
  balanceDays: 10,
  metadata: {},
};

type RequestClient = {
  get(path: string): Promise<unknown>;
  post(path: string, body?: unknown, headers?: HeadersInit): Promise<any>;
};

const identities = new Map<string, AuthenticatedPrincipal>([
  ['employee-1', principal('employee-1', 'employee')],
  ['manager-1', principal('manager-1', 'manager')],
]);

class FakeSessions {
  async create(userId: string) {
    const current = identities.get(userId);
    if (!current) throw new Error('user_not_found');
    return { token: `signed-${userId}`, principal: current };
  }

  async verify(token: string) {
    const userId = token.replace(/^signed-/, '');
    return identities.get(userId) ?? null;
  }
}

class FakeConsumer {
  private readonly requests = new Map<string, any>();
  private readonly states = new Map<string, string>();
  private task: any = null;
  readonly repository = {
    getRequest: async (id: string) => this.requests.get(id) ?? null,
    tasks: {
      get: async (id: string) => this.task?.id === id ? this.task : null,
      find: async () => this.task,
    },
  };
  readonly tasks = {
    list: async () => ({ items: this.task ? [this.task] : [], nextCursor: null }),
    claim: async (input: any) => {
      if (!this.task || input.expectedRevision !== this.task.revision || this.task.status !== 'open') {
        throw new Error('stale_task_revision');
      }
      this.task = { ...this.task, status: 'claimed', assigneeId: input.actor.id, revision: input.expectedRevision + 1 };
      return this.task;
    },
  };
  readonly outbox = { listForRecipient: async () => [] };

  async start(input: any) {
    this.requests.set(input.subject.id, { id: input.subject.id, flow_id: input.flowId, employee_id: input.actor.id, manager_id: input.subject.metadata.managerId });
    this.states.set(input.flowId, 'employee_draft');
    return this.view(input.flowId);
  }

  async getFlow(flowId: string) {
    if (!this.states.has(flowId)) throw new Error('flow_not_found');
    return this.view(flowId);
  }

  async act(input: any) {
    if (input.action === 'submit') {
      this.states.set(input.flowId, 'manager_review');
      const request = [...this.requests.values()].find((item) => item.flow_id === input.flowId)!;
      this.task = { id: 'task-1', flowId: input.flowId, subjectId: request.id, stage: 'manager_review', role: 'manager', status: 'open', assigneeId: null, revision: 0 };
    }
    if (input.action === 'approve') this.states.set(input.flowId, 'approved');
    return this.view(input.flowId);
  }

  async health() { return { ready: true, checkedAt: '2026-07-29T00:00:00.000Z' }; }

  private view(flowId: string) {
    const stage = this.states.get(flowId)!;
    return { state: { stage, status: stage === 'approved' ? 'completed' : 'pending', pendingRole: stage === 'manager_review' ? 'manager' : null, tracks: {} }, sequence: 1, stepResults: {}, completed: stage === 'approved', nextActions: [] };
  }
}

class FakeRuntimeHealth {
  async health(name: string) { return { name, ready: true, checkedAt: '2026-07-29T00:00:00.000Z', heartbeatAt: '2026-07-29T00:00:00.000Z' }; }
}

async function request(baseUrl: string, path: string, options: RequestInit = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload.message ?? 'request_failed'), { status: response.status, payload });
  return { payload, response };
}

async function login(baseUrl: string, userId: string): Promise<RequestClient> {
  const { response } = await request(baseUrl, '/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ userId }),
  });
  const cookie = response.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('login did not establish a session cookie');
  return {
    get: async (path) => (await request(baseUrl, path, { headers: { cookie } })).payload,
    post: async (path, body, headers = {}) => (await request(baseUrl, path, {
      method: 'POST', headers: { 'content-type': 'application/json', cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
    })).payload,
  };
}

let app: Awaited<ReturnType<typeof NestFactory.create>>;
let baseUrl: string;

beforeAll(async () => {
  const consumer = new FakeConsumer();
  const sessions = new FakeSessions();
  class TestModule {}
  Module({
    controllers: [DemoAuthController, FlowController, TasksController, NotificationsController, RuntimeController],
    providers: [
      { provide: FlowkitDemoConsumer, useValue: consumer },
      { provide: DemoSessionService, useValue: sessions },
      DemoSessionGuard,
      { provide: RuntimeHealthRepository, useValue: new FakeRuntimeHealth() },
    ],
  })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  await app.listen(0, '127.0.0.1');
  baseUrl = await app.getUrl();
});

afterAll(async () => { await app.close(); });

describe('Flowkit API sessions and role paths', () => {
  it('rejects approval before the manager task is claimed', async () => {
    const employee = await login(baseUrl, 'employee-1');
    const { id } = await employee.post('/flows', fiveDayLeave);
    await employee.post(`/flows/${id}/actions`, { action: 'submit' });
    const manager = await login(baseUrl, 'manager-1');
    await expect(manager.post(`/flows/${id}/actions`, { action: 'approve' })).rejects.toMatchObject({ status: 403 });
  });

  it('requires employee submission and a claimed manager task for approval', async () => {
    const employee = await login(baseUrl, 'employee-1');
    const { id } = await employee.post('/flows', fiveDayLeave);
    await employee.post(`/flows/${id}/actions`, { action: 'submit' });
    const manager = await login(baseUrl, 'manager-1');
    const [task] = await manager.get('/tasks') as any[];
    await manager.post(`/tasks/${task.id}/claim`, { expectedRevision: task.revision });
    await manager.post(`/flows/${id}/actions`, { action: 'approve' });
    await expect(employee.post(`/flows/${id}/actions`, { action: 'approve' }, { 'x-demo-user': 'manager-1', 'x-demo-role': 'manager' })).rejects.toMatchObject({ status: 403 });
  });

  it('rejects requests without a valid signed session cookie', async () => {
    await expect(request(baseUrl, '/tasks')).rejects.toMatchObject({ status: 401 });
    await expect(request(baseUrl, '/tasks', { headers: { cookie: 'flowkit_demo_session=tampered' } })).rejects.toMatchObject({ status: 401 });
    await expect(request(baseUrl, '/tasks', { headers: { cookie: 'flowkit_demo_session=%E0%A4%A' } })).rejects.toMatchObject({ status: 401 });
  });

  it('reports worker heartbeats separately from API observation time', async () => {
    const employee = await login(baseUrl, 'employee-1');
    const runtime = await employee.get('/runtime') as any;
    expect(runtime.flowkitRuntime).toMatchObject({
      ready: true,
      heartbeatAt: '2026-07-29T00:00:00.000Z',
      checkedAt: '2026-07-29T00:00:00.000Z',
    });
    expect(runtime.delivery.heartbeatAt).toBe('2026-07-29T00:00:00.000Z');
  });
});
