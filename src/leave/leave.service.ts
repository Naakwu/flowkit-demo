import { buildInitialState, transition, type FlowCommand, type FlowState } from '@flowkit/core';
import { MemoryTaskStore, planTaskProjection, claimTask, type FlowTask } from '@flowkit/tasks';
import { createTemplateRegistry, planNotification, MemoryOutboxStore, NotificationAdapterRegistry, testAdapter, type NotificationPlan } from '@flowkit/notify';
import { leaveDefinition, leaveGuards, leavePolicies } from './leave.definition';
import { leaveRequestSchema, type LeaveRequest } from './leave.types';
import { notificationTemplates } from '../notifications/templates';

export type LeaveRecord = LeaveRequest & { id: string; state: FlowState; sequence: number; history: FlowState[]; notifications: NotificationPlan[]; calendarEntry?: string; reservation?: string };

export class LeaveService {
  readonly tasks = new MemoryTaskStore();
  readonly outbox = new MemoryOutboxStore();
  readonly adapters = new NotificationAdapterRegistry();
  readonly records = new Map<string, LeaveRecord>();
  readonly ready = Promise.resolve();
  constructor() {
    this.adapters.register({ ...testAdapter('inbox'), enabled: true }); this.adapters.register({ ...testAdapter('email'), enabled: true }); this.adapters.freeze();
  }

  async listTasks() { await this.ready; const page = await this.tasks.inbox({ view: 'all', statuses: ['open', 'claimed'] }); return { ...page, items: page.items.filter((task) => task.role === 'manager') }; }
  async listNotifications(recipientId: string) { await this.ready; return this.outbox.rows.filter(row => row.envelope.recipient.canonicalKey === recipientId).map(row => ({ id: row.id, status: row.status, subject: row.envelope.rendered.subject })); }

  async create(input: unknown, employeeId: string): Promise<LeaveRecord> {
    await this.ready;
    const request = leaveRequestSchema.parse({ ...(input as object), employeeId });
    const id = `leave-${this.records.size + 1}`;
    const record: LeaveRecord = { ...request, id, state: buildInitialState(leaveDefinition), sequence: 0, history: [], notifications: [] };
    this.records.set(id, record);
    const initialPlan = planTaskProjection({ namespace: 'flowkit-demo', flowId: id, subject: { type: 'leave', id }, definition: leaveDefinition, operationId: `${id}:open`, transitionSequence: 0, action: 'open', actorId: employeeId, previousState: record.state, nextState: record.state, metadata: {} }, null);
    await this.tasks.applyProjection({ plan: initialPlan, operationId: `${id}:open` });
    return record;
  }

  async command(id: string, command: FlowCommand, actor: { id: string; roles: string[] }): Promise<LeaveRecord> {
    await this.ready;
    const record = this.records.get(id); if (!record) throw new Error('leave_not_found');
    const context = { subject: record, actor, guards: leaveGuards, policies: leavePolicies };
    const outcome = transition(leaveDefinition, record.state, { ...command, actorId: actor.id }, context);
    record.history.push(record.state); record.state = outcome.state; record.sequence += 1;
    const plan = planTaskProjection({ namespace: 'flowkit-demo', flowId: id, subject: { type: 'leave', id }, definition: leaveDefinition, operationId: `${id}:${record.sequence}`, transitionSequence: record.sequence, action: command.action, actorId: actor.id, previousState: record.history.at(-1)!, nextState: record.state, dueAt: null, metadata: {} }, await this.tasks.find({ namespace: 'flowkit-demo', flowId: id, subjectType: 'leave', subjectId: id, stage: record.history.at(-1)!.stage, role: record.history.at(-1)!.pendingRole ?? '' }));
    await this.tasks.applyProjection({ plan, operationId: `${id}:${record.sequence}` });
    const template = record.state.stage === 'approved' ? 'leave.accepted' : record.state.stage === 'rejected' ? 'leave.rejected' : record.state.stage === 'manager_review' ? 'leave.manager_review' : undefined;
    if (template) { const notification = await planNotification({ namespace: 'flowkit-demo', sourceKey: `${id}:${record.sequence}`, aggregate: { type: 'leave', id }, templateKey: template, data: { requestId: id, stage: record.state.stage, employeeName: record.employeeId }, channels: ['inbox', 'email'], explicitRecipients: [{ key: record.employeeId, routes: [{ channel: 'inbox', canonicalKey: record.employeeId, address: record.employeeId }, { channel: 'email', canonicalKey: record.employeeId, address: `${record.employeeId}@example.test` }] }] }, { templates: notificationTemplates, adapters: this.adapters.values() }); await this.outbox.insert(notification.envelopes); record.notifications.push(notification); }
    return record;
  }

  async claim(task: FlowTask, actorId: string) { await this.ready; return claimTask({ store: this.tasks, eligibility: { canWorkRole: async ({ actorId: id, task: candidate }) => id === actorId && candidate.role === 'manager' }, command: { taskId: task.id, expectedRevision: task.revision, actorId, operationId: `claim:${task.id}:${actorId}`, now: new Date().toISOString() } }); }
}
