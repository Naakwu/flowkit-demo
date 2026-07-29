import { randomUUID } from 'node:crypto';

import { buildInitialState, transition, type FlowCommand, type FlowState } from '@flowkit/core';
import { planTaskProjection, type FlowTask } from '@flowkit/tasks';

import { LeaveFlowRepository } from '../db/leave-flow.repository';
import { leaveDefinition, leaveGuards, leavePolicies } from './leave.definition';
import { leaveRequestSchema, type LeaveRequest } from './leave.types';

export type LeaveRecord = LeaveRequest & {
  id: string;
  flowId: string;
  state: FlowState;
  sequence: number;
  history: FlowState[];
};

type LeaveRow = {
  id: string; flow_id: string; employee_id: string; manager_id: string;
  start_date: Date | string; end_date: Date | string; business_days: number;
  reason: string; balance_days: number; stage: string; revision: number;
};
type AuditRow = { metadata: { nextState?: FlowState; previousState?: FlowState } | string };
const asDate = (value: Date | string) => value instanceof Date ? value.toISOString().slice(0, 10) : value.slice(0, 10);
const definitionHash = 'sha256:leave-approval-demo-v1' as `sha256:${string}`;

/** API-facing composition that projects every request and transition to PostgreSQL. */
export class LeaveService {
  readonly repository: LeaveFlowRepository;
  readonly tasks;
  readonly outbox;

  constructor(repository = new LeaveFlowRepository()) {
    this.repository = repository;
    this.tasks = repository.tasks;
    this.outbox = repository.outbox;
  }

  async listTasks() {
    const page = await this.tasks.inbox({ view: 'all', statuses: ['open', 'claimed'] });
    return { ...page, items: page.items.filter((task) => task.role === 'manager') };
  }

  async listNotifications(recipientId: string) {
    return this.outbox.listForRecipient(recipientId);
  }

  async create(input: unknown, employeeId: string): Promise<LeaveRecord> {
    const request = leaveRequestSchema.parse({ ...(input as object), employeeId });
    const id = `leave-${randomUUID()}`;
    const flowId = `flow-${id}`;
    const state = buildInitialState(leaveDefinition);
    await this.repository.sql.begin(async (tx) => {
      await tx`
        INSERT INTO leave_requests (
          id, employee_id, manager_id, start_date, end_date, business_days, reason,
          balance_days, stage, revision, operation_key, flow_id, definition_hash
        ) VALUES (
          ${id}, ${request.employeeId}, ${request.managerId}, ${request.startDate}, ${request.endDate},
          ${request.businessDays}, ${request.reason}, ${request.balanceDays}, ${state.stage}, 0,
          ${`${id}:open`}, ${flowId}, ${definitionHash}
        )
      `;
      const plan = planTaskProjection({
        namespace: 'flowkit-demo', flowId, subject: { type: 'leave', id }, definition: leaveDefinition,
        operationId: `${id}:open`, transitionSequence: 0, action: 'open', actorId: employeeId,
        previousState: state, nextState: state, metadata: {},
      }, null);
      await this.tasks.applyProjectionInTransaction(tx, { plan, operationId: `${id}:open` });
    });
    return { ...request, id, flowId, state, sequence: 0, history: [] };
  }

  async get(id: string): Promise<LeaveRecord | null> {
    const [row] = await this.repository.sql<LeaveRow[]>`SELECT * FROM leave_requests WHERE id = ${id} LIMIT 1`;
    if (!row) return null;
    const auditRows = await this.repository.sql<AuditRow[]>`
      SELECT metadata FROM audit_events
      WHERE action = 'flowkit.transition' AND entity_id = ${id}
      ORDER BY id ASC
    `;
    const states = auditRows.map((audit) => typeof audit.metadata === 'string' ? JSON.parse(audit.metadata) : audit.metadata);
    const initial = buildInitialState(leaveDefinition);
    const state = states.at(-1)?.nextState ?? initial;
    return {
      id: row.id, flowId: row.flow_id, employeeId: row.employee_id, managerId: row.manager_id,
      startDate: asDate(row.start_date), endDate: asDate(row.end_date), businessDays: row.business_days,
      reason: row.reason, balanceDays: row.balance_days, metadata: {}, state, sequence: row.revision,
      history: states.map((audit) => audit.previousState).filter((value): value is FlowState => Boolean(value)),
    };
  }

  async command(id: string, command: FlowCommand, actor: { id: string; roles: string[] }): Promise<LeaveRecord> {
    const record = await this.get(id);
    if (!record) throw new Error('leave_not_found');
    const outcome = transition(leaveDefinition, record.state, { ...command, actorId: actor.id }, {
      subject: record, actor, guards: leaveGuards, policies: leavePolicies,
    });
    const stage = leaveDefinition.stages[record.state.stage];
    const action = stage?.actions?.[command.action];
    const result = await this.repository.recordTransition({
      workflowId: record.flowId, runId: `api:${record.flowId}`, operationId: `${record.flowId}:${record.sequence + 1}`,
      sequence: record.sequence + 1, origin: actor.id === 'system' ? 'rule' : 'human',
      definition: { id: leaveDefinition.id, version: leaveDefinition.version, hash: definitionHash },
      subject: { id: record.id, metadata: { employeeId: record.employeeId, managerId: record.managerId } },
      command: { ...command, actorId: actor.id }, previousState: record.state, nextState: outcome.state,
      transition: outcome.transition, notify: action?.notify,
    });
    return { ...record, state: result.state, sequence: record.sequence + 1, history: [...record.history, record.state] };
  }

  async claim(task: FlowTask, actorId: string) {
    if (task.role !== 'manager') throw new Error('task_role_ineligible');
    return this.tasks.claim({
      taskId: task.id, expectedRevision: task.revision, actorId,
      operationId: `claim:${task.id}:${actorId}`, now: new Date().toISOString(),
    });
  }
}
