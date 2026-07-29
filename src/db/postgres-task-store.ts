import { randomUUID } from 'node:crypto';

import type {
  FlowTask,
  FlowTaskStatus,
  TaskEvent,
  TaskEventType,
  TaskInboxPage,
  TaskInboxQuery,
  TaskInvitation,
  TaskProjectionResult,
  TaskProjectionPlan,
  TaskReassignCommand,
  TaskReference,
  TaskReleaseCommand,
  TaskStore,
} from '@flowkit/tasks';
import type { Sql, TransactionSql } from 'postgres';

import { createDemoDatabaseClient } from './client';

type Executor = Sql | TransactionSql;
type TaskRow = {
  id: string;
  flow_id: string;
  subject_id: string;
  stage: string;
  role_key: string;
  status: FlowTaskStatus;
  assignee_id: string | null;
  revision: number;
  lifecycle_epoch: number;
  due_at: Date | string | null;
  opened_operation_key: string;
  created_at: Date | string;
  updated_at: Date | string;
  claimed_at: Date | string | null;
  completed_at: Date | string | null;
};
type EventRow = {
  id: number | string;
  task_id: string;
  sequence: number;
  operation_key: string;
  event_type: TaskEventType;
  actor_id: string | null;
  created_at: Date | string;
};
type ProjectionOperationRow = { result: TaskProjectionResult | string };
type InvitationRow = {
  id: string; task_id: string; subject_type: string; subject_id: string; role_key: string;
  contact_kind: TaskInvitation['contactKind']; contact_hash: string; contact_hash_key_version: string;
  token_hash: string; status: TaskInvitation['status']; expires_at: Date | string; source_key: string;
  accepted_identity_id: string | null; accepted_at: Date | string | null; metadata: TaskInvitation['metadata'];
};

const asIso = (value: Date | string | null) => value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();
const taskStatusAfter = (kind: TaskProjectionPlan['mutations'][number]['kind'], current: FlowTaskStatus | null): FlowTaskStatus => {
  if (kind === 'complete' || kind === 'close') return 'completed';
  if (kind === 'open' || kind === 'reopen') return 'open';
  return current ?? 'open';
};
const statusForEvent = (eventType: TaskEventType): FlowTaskStatus => {
  if (eventType === 'claimed' || eventType === 'reassigned' || eventType === 'invitation_accepted') return 'claimed';
  if (eventType === 'completed') return 'completed';
  if (eventType === 'cancelled') return 'cancelled';
  return 'open';
};

/**
 * PostgreSQL adapter for the public TaskStore contract.
 *
 * The disposable demo schema intentionally has a smaller task shape than the
 * FAAN production schema. Namespace/subject type are fixed by this consumer,
 * while timestamps are derived from its durable task-event history.
 */
export class PostgresTaskStore implements TaskStore {
  readonly sql: Sql;
  private readonly ownsClient: boolean;

  constructor(sql?: Sql) {
    this.ownsClient = !sql;
    this.sql = sql ?? createDemoDatabaseClient();
  }

  async get(taskId: string): Promise<FlowTask | null> {
    const [row] = await this.taskRows(this.sql, this.sql`WHERE t.id = ${taskId}`);
    return row ? this.task(row) : null;
  }

  async find(reference: TaskReference): Promise<FlowTask | null> {
    const [row] = await this.taskRows(this.sql, this.sql`
      WHERE t.flow_id = ${reference.flowId}
        AND t.subject_id = ${reference.subjectId}
        AND t.stage = ${reference.stage}
        AND t.role_key = ${reference.role}
    `);
    return row ? this.task(row, reference.namespace, reference.subjectType) : null;
  }

  async findInTransaction(tx: TransactionSql, reference: TaskReference): Promise<FlowTask | null> {
    const [row] = await this.taskRows(tx, tx`
      WHERE t.flow_id = ${reference.flowId}
        AND t.subject_id = ${reference.subjectId}
        AND t.stage = ${reference.stage}
        AND t.role_key = ${reference.role}
    `);
    return row ? this.task(row, reference.namespace, reference.subjectType) : null;
  }

  async applyProjection(input: { plan: TaskProjectionPlan; operationId: string }) {
    return this.sql.begin((tx) => this.applyProjectionInTransaction(tx, input));
  }

  async applyProjectionInTransaction(tx: TransactionSql, input: { plan: TaskProjectionPlan; operationId: string }) {
    const [claimedOperation] = await tx<{ operation_key: string }[]>`
      INSERT INTO flow_task_projection_operations (operation_key, result)
      VALUES (${input.operationId}, '{}'::jsonb)
      ON CONFLICT (operation_key) DO NOTHING
      RETURNING operation_key
    `;
    if (!claimedOperation) {
      const [prior] = await tx<ProjectionOperationRow[]>`
        SELECT result FROM flow_task_projection_operations WHERE operation_key = ${input.operationId} LIMIT 1
      `;
      const result = typeof prior?.result === 'string' ? JSON.parse(prior.result) : prior?.result;
      if (result) return { ...result, created: false };
      throw new Error(`Task projection operation ${input.operationId} was not readable after conflict.`);
    }

    const tasks: FlowTask[] = [];
    const events: TaskEvent[] = [];
    for (let index = 0; index < input.plan.mutations.length; index += 1) {
      const mutation = input.plan.mutations[index]!;
      const plannedEvent = input.plan.events[index];
      const current = await this.findInTransaction(tx, mutation.reference);
      const now = new Date().toISOString();
      const nextStatus = taskStatusAfter(mutation.kind, current?.status ?? null);
      const [row] = current
        ? await tx<TaskRow[]>`
          UPDATE flow_tasks
          SET status = ${nextStatus},
              assignee_id = ${nextStatus === 'open' ? null : current.assigneeId},
              revision = revision + 1,
              lifecycle_epoch = ${mutation.lifecycleEpoch},
              due_at = ${mutation.dueAt ?? current.dueAt}
          WHERE id = ${current.id}
          RETURNING *, ${now}::timestamptz AS created_at, ${now}::timestamptz AS updated_at,
            CASE WHEN ${nextStatus} = 'claimed' THEN ${now}::timestamptz ELSE NULL END AS claimed_at,
            CASE WHEN ${nextStatus} = 'completed' THEN ${now}::timestamptz ELSE NULL END AS completed_at
        `
        : await tx<TaskRow[]>`
          INSERT INTO flow_tasks (
            id, flow_id, subject_id, stage, role_key, status, assignee_id,
            revision, lifecycle_epoch, due_at, opened_operation_key
          )
          VALUES (
            ${`task-${randomUUID()}`}, ${mutation.reference.flowId}, ${mutation.reference.subjectId},
            ${mutation.reference.stage}, ${mutation.reference.role}, ${nextStatus}, NULL,
            0, ${mutation.lifecycleEpoch}, ${mutation.dueAt ?? null}, ${input.operationId}
          )
          RETURNING *, ${now}::timestamptz AS created_at, ${now}::timestamptz AS updated_at,
            NULL::timestamptz AS claimed_at,
            CASE WHEN ${nextStatus} = 'completed' THEN ${now}::timestamptz ELSE NULL END AS completed_at
        `;
      if (!row) continue;
      const task = this.task(row, mutation.reference.namespace, mutation.reference.subjectType);
      tasks.push(task);
      if (!plannedEvent) continue;
      const [event] = await tx<EventRow[]>`
        INSERT INTO flow_task_events (task_id, sequence, operation_key, event_type, actor_id)
        VALUES (${row.id}, ${row.revision}, ${`${input.operationId}:${index}`}, ${plannedEvent.eventType}, ${plannedEvent.actorId})
        ON CONFLICT (task_id, sequence) DO NOTHING
        RETURNING *
      `;
      if (event) events.push(this.event(event, task));
    }
    const result = { created: true, tasks, events };
    await tx`
      UPDATE flow_task_projection_operations
      SET result = ${JSON.stringify(result)}::jsonb
      WHERE operation_key = ${input.operationId}
    `;
    return result;
  }

  async claim(command: import('@flowkit/tasks').TaskClaimCommand) {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<TaskRow[]>`
      UPDATE flow_tasks
      SET status = 'claimed', assignee_id = ${command.actorId}, revision = revision + 1
      WHERE id = ${command.taskId}
        AND status = 'open'
        AND assignee_id IS NULL
        AND revision = ${command.expectedRevision}
      RETURNING *, ${command.now}::timestamptz AS created_at, ${command.now}::timestamptz AS updated_at,
        ${command.now}::timestamptz AS claimed_at, NULL::timestamptz AS completed_at
      `;
      if (!row) return { task: null, reason: 'conflict' as const };
      const task = this.task(row);
      await this.appendLifecycleEvent(tx, task, 'claimed', command.operationId, command.actorId, command.now);
      return { task };
    });
  }

  async release(command: TaskReleaseCommand) {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<TaskRow[]>`
      UPDATE flow_tasks
      SET status = 'open', assignee_id = NULL, revision = revision + 1
      WHERE id = ${command.taskId}
        AND status = 'claimed'
        AND assignee_id = ${command.actorId}
        AND revision = ${command.expectedRevision}
      RETURNING *, ${command.now}::timestamptz AS created_at, ${command.now}::timestamptz AS updated_at,
        NULL::timestamptz AS claimed_at, NULL::timestamptz AS completed_at
      `;
      if (!row) return { task: null, reason: 'conflict' as const };
      const task = this.task(row);
      await this.appendLifecycleEvent(tx, task, 'released', command.operationId, command.actorId, command.now);
      return { task };
    });
  }

  async reassign(command: TaskReassignCommand) {
    return this.sql.begin(async (tx) => {
      const [row] = await tx<TaskRow[]>`
      UPDATE flow_tasks
      SET status = 'claimed', assignee_id = ${command.targetActorId}, revision = revision + 1
      WHERE id = ${command.taskId} AND revision = ${command.expectedRevision}
      RETURNING *, ${command.now}::timestamptz AS created_at, ${command.now}::timestamptz AS updated_at,
        ${command.now}::timestamptz AS claimed_at, NULL::timestamptz AS completed_at
      `;
      if (!row) return { task: null, reason: 'conflict' as const };
      const task = this.task(row);
      await this.appendLifecycleEvent(tx, task, 'reassigned', command.operationId, command.actorId, command.now);
      return { task };
    });
  }

  async history(taskId: string): Promise<TaskEvent[]> {
    const task = await this.get(taskId);
    if (!task) return [];
    const rows = await this.sql<EventRow[]>`
      SELECT * FROM flow_task_events WHERE task_id = ${taskId} ORDER BY sequence ASC
    `;
    return rows.map((row) => this.event(row, task));
  }

  async inbox(query: TaskInboxQuery): Promise<TaskInboxPage> {
    const rows = await this.taskRows(this.sql, this.sql``);
    let items = rows.map((row) => this.task(row));
    if (query.view === 'my_claims') items = items.filter((task) => task.assigneeId === query.actorId);
    if (query.view === 'role_queue') items = items.filter((task) => task.status === 'open' && (!query.roles?.length || query.roles.includes(task.role)));
    if (query.statuses?.length) items = items.filter((task) => query.statuses!.includes(task.status));
    if (query.stage) items = items.filter((task) => task.stage === query.stage);
    if (query.subjectId) items = items.filter((task) => task.subjectId === query.subjectId);
    if (query.dueBefore) items = items.filter((task) => task.dueAt !== null && task.dueAt <= query.dueBefore!);
    if (query.dueAfter) items = items.filter((task) => task.dueAt !== null && task.dueAt >= query.dueAfter!);
    const direction = query.direction === 'asc' ? 1 : -1;
    items.sort((left, right) => direction * left.updatedAt.localeCompare(right.updatedAt));
    return { items: items.slice(0, query.limit ?? 50), nextCursor: null };
  }

  async latestMakerCompletion(input: { subjectType: string; subjectId: string; makerStage: string; beforeEpoch: number }): Promise<TaskEvent | null> {
    const rows = await this.sql<(EventRow & TaskRow)[]>`
      SELECT e.*, t.*
      FROM flow_task_events e
      JOIN flow_tasks t ON t.id = e.task_id
      WHERE t.subject_id = ${input.subjectId}
        AND t.stage = ${input.makerStage}
        AND t.lifecycle_epoch <= ${input.beforeEpoch}
        AND e.event_type = 'completed'
      ORDER BY e.created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    return row ? this.event(row, this.task(row, 'flowkit-demo', input.subjectType)) : null;
  }

  async createInvitation(input: Omit<TaskInvitation, 'id' | 'status' | 'acceptedIdentityId' | 'acceptedAt'>): Promise<TaskInvitation> {
    const [inserted] = await this.sql<InvitationRow[]>`
      INSERT INTO flow_task_invitations (
        id, task_id, subject_type, subject_id, role_key, contact_kind, contact_hash,
        contact_hash_key_version, token_hash, status, expires_at, source_key, metadata
      ) VALUES (
        ${`invitation-${randomUUID()}`}, ${input.taskId}, ${input.subjectType}, ${input.subjectId}, ${input.role},
        ${input.contactKind}, ${input.contactHash}, ${input.contactHashKeyVersion}, ${input.tokenHash}, 'pending',
        ${input.expiresAt}, ${input.sourceKey}, ${JSON.stringify(input.metadata)}::jsonb
      ) ON CONFLICT (source_key) DO NOTHING RETURNING *
    `;
    if (inserted) return this.invitation(inserted);
    const [existing] = await this.sql<InvitationRow[]>`SELECT * FROM flow_task_invitations WHERE source_key = ${input.sourceKey} LIMIT 1`;
    if (!existing) throw new Error(`Task invitation ${input.sourceKey} was not readable after conflict.`);
    return this.invitation(existing);
  }

  async getInvitationByTokenHash(tokenHash: string): Promise<TaskInvitation | null> {
    const [row] = await this.sql<InvitationRow[]>`SELECT * FROM flow_task_invitations WHERE token_hash = ${tokenHash} LIMIT 1`;
    return row ? this.invitation(row) : null;
  }

  async redeemInvitation(input: { invitationId: string; identityId: string; expectedExpiry: string; now: string; operationId: string }): Promise<{ invitation: TaskInvitation; task: FlowTask } | null> {
    return this.sql.begin(async (tx) => {
      const [invitation] = await tx<InvitationRow[]>`
        UPDATE flow_task_invitations
        SET status = 'accepted', accepted_identity_id = ${input.identityId}, accepted_at = ${input.now}
        WHERE id = ${input.invitationId} AND status = 'pending'
          AND expires_at = ${input.expectedExpiry}::timestamptz AND expires_at >= ${input.now}::timestamptz
        RETURNING *
      `;
      if (!invitation) return null;
      const [row] = await tx<TaskRow[]>`
        UPDATE flow_tasks SET status = 'claimed', assignee_id = ${input.identityId}, revision = revision + 1
        WHERE id = ${invitation.task_id} AND status = 'open'
        RETURNING *, ${input.now}::timestamptz AS created_at, ${input.now}::timestamptz AS updated_at,
          ${input.now}::timestamptz AS claimed_at, NULL::timestamptz AS completed_at
      `;
      if (!row) throw new Error('Task invitation could not claim an open task.');
      const task = this.task(row, 'flowkit-demo', invitation.subject_type);
      await this.appendLifecycleEvent(tx, task, 'invitation_accepted', input.operationId, input.identityId, input.now);
      return { invitation: this.invitation(invitation), task };
    });
  }

  async revokeInvitation(input: { invitationId: string; now: string; operationId: string }): Promise<void> {
    await this.sql`
      UPDATE flow_task_invitations
      SET status = 'revoked', revoked_at = ${input.now}
      WHERE id = ${input.invitationId} AND status = 'pending'
    `;
  }

  async close(): Promise<void> {
    if (this.ownsClient) await this.sql.end({ timeout: 5 });
  }

  private async taskRows(executor: Executor, where: ReturnType<Sql>): Promise<TaskRow[]> {
    return executor<TaskRow[]>`
      SELECT t.*,
        COALESCE((SELECT min(e.created_at) FROM flow_task_events e WHERE e.task_id = t.id), now()) AS created_at,
        COALESCE((SELECT max(e.created_at) FROM flow_task_events e WHERE e.task_id = t.id), now()) AS updated_at,
        CASE WHEN t.status = 'claimed' THEN (SELECT max(e.created_at) FROM flow_task_events e WHERE e.task_id = t.id AND e.event_type IN ('claimed', 'reassigned', 'invitation_accepted')) ELSE NULL END AS claimed_at,
        CASE WHEN t.status = 'completed' THEN (SELECT max(e.created_at) FROM flow_task_events e WHERE e.task_id = t.id AND e.event_type = 'completed') ELSE NULL END AS completed_at
      FROM flow_tasks t ${where}
    `;
  }

  private task(row: TaskRow, namespace = 'flowkit-demo', subjectType = 'leave'): FlowTask {
    return {
      id: row.id, namespace, flowId: row.flow_id, subjectType, subjectId: row.subject_id,
      stage: row.stage, role: row.role_key, status: row.status, assigneeId: row.assignee_id,
      revision: row.revision, lifecycleEpoch: row.lifecycle_epoch, dueAt: asIso(row.due_at),
      claimedAt: asIso(row.claimed_at), completedAt: asIso(row.completed_at),
      openedOperationId: row.opened_operation_key, metadata: {},
      createdAt: asIso(row.created_at)!, updatedAt: asIso(row.updated_at)!,
    };
  }

  private event(row: EventRow, task: FlowTask): TaskEvent {
    return {
      id: String(row.id), taskId: row.task_id, sequence: row.sequence,
      transitionSequence: null, operationId: row.operation_key, eventType: row.event_type,
      previousStatus: null, nextStatus: statusForEvent(row.event_type), previousAssigneeId: null,
      nextAssigneeId: row.event_type === 'claimed' || row.event_type === 'reassigned' ? task.assigneeId : null,
      actorId: row.actor_id, reason: null, action: null, lifecycleEpoch: task.lifecycleEpoch,
      metadata: {}, createdAt: asIso(row.created_at)!,
    };
  }

  private invitation(row: InvitationRow): TaskInvitation {
    return {
      id: row.id, taskId: row.task_id, subjectType: row.subject_type, subjectId: row.subject_id, role: row.role_key,
      contactKind: row.contact_kind, contactHash: row.contact_hash, contactHashKeyVersion: row.contact_hash_key_version,
      tokenHash: row.token_hash, status: row.status, expiresAt: asIso(row.expires_at)!, sourceKey: row.source_key,
      acceptedIdentityId: row.accepted_identity_id, acceptedAt: asIso(row.accepted_at), metadata: row.metadata,
    };
  }

  private async appendLifecycleEvent(executor: Executor, task: FlowTask, eventType: TaskEventType, operationId: string, actorId: string, now: string): Promise<void> {
    await executor`
      INSERT INTO flow_task_events (task_id, sequence, operation_key, event_type, actor_id, created_at)
      VALUES (${task.id}, ${task.revision}, ${operationId}, ${eventType}, ${actorId}, ${now})
      ON CONFLICT (task_id, sequence) DO NOTHING
    `;
  }
}
