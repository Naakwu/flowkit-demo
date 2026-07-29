import type { FlowDefinition, FlowState } from '@flowkit/core';
import { planNotification, NotificationAdapterRegistry, testAdapter, type NotificationDeliveryEnvelope } from '@flowkit/notify';
import { planTaskProjection } from '@flowkit/tasks';
import type { RecordTransitionInput, RecordTransitionOutput } from '@flowkit/temporal';
import type { Sql, TransactionSql } from 'postgres';

import { leaveDefinition } from '../leave/leave.definition';
import { notificationTemplates } from '../notifications/templates';
import { createDemoDatabaseClient } from './client';
import { PostgresOutboxStore } from './postgres-outbox-store';
import { PostgresTaskStore } from './postgres-task-store';

type LeaveRequestRow = { id: string; employee_id: string; manager_id: string; stage: string; revision: number };
type PriorTransitionRow = { metadata: { nextState?: FlowState } | string };

export class LeaveFlowProjectionConflictError extends Error {
  constructor(workflowId: string, expectedStage: string) {
    super(`Leave flow ${workflowId} no longer matches expected stage ${expectedStage}.`);
    this.name = 'LeaveFlowProjectionConflictError';
  }
}

/**
 * Durable leave read-model projection. The transition, audit, task mutations,
 * and notification envelopes share one PostgreSQL transaction.
 */
export class LeaveFlowRepository {
  readonly sql: Sql;
  readonly tasks: PostgresTaskStore;
  readonly outbox: PostgresOutboxStore;
  private readonly ownsClient: boolean;
  private readonly definition: FlowDefinition;
  private readonly adapters = new NotificationAdapterRegistry();

  constructor(options: { sql?: Sql; tasks?: PostgresTaskStore; outbox?: PostgresOutboxStore; definition?: FlowDefinition } = {}) {
    this.ownsClient = !options.sql;
    this.sql = options.sql ?? createDemoDatabaseClient();
    this.tasks = options.tasks ?? new PostgresTaskStore(this.sql);
    this.outbox = options.outbox ?? new PostgresOutboxStore(this.sql);
    this.definition = options.definition ?? leaveDefinition;
    this.adapters.register({ ...testAdapter('inbox'), enabled: true });
    this.adapters.register({ ...testAdapter('email'), enabled: true });
    this.adapters.freeze();
  }

  async findPriorResult(workflowId: string, operationId: string): Promise<RecordTransitionOutput | undefined> {
    const [row] = await this.sql<PriorTransitionRow[]>`
      SELECT a.metadata
      FROM leave_transitions t
      JOIN audit_events a ON a.action = 'flowkit.transition' AND a.metadata->>'operationId' = t.operation_key
      WHERE t.operation_key = ${operationId}
      LIMIT 1
    `;
    const metadata = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : row?.metadata;
    return metadata?.nextState ? { state: metadata.nextState, created: false } : undefined;
  }

  async recordTransition(input: RecordTransitionInput): Promise<RecordTransitionOutput> {
    return this.sql.begin(async (tx) => {
      const existing = await this.findPriorResultInTransaction(tx, input.operationId);
      if (existing) return existing;

      const advanced = await this.advanceRequest(tx, input);
      if ('prior' in advanced) return advanced.prior;
      const request = advanced.request;
      await tx`
        INSERT INTO leave_transitions (leave_id, sequence, operation_key, action, actor_id, from_stage, to_stage, run_key)
        VALUES (
          ${input.subject.id}, ${input.sequence}, ${input.operationId}, ${input.command.action},
          ${input.command.actorId ?? 'system'}, ${input.previousState.stage}, ${input.nextState.stage}, ${input.runId}
        )
      `;
      await tx`
        INSERT INTO audit_events (actor_id, action, entity_id, metadata)
        VALUES (
          ${input.command.actorId ?? 'system'}, 'flowkit.transition', ${input.subject.id},
          ${JSON.stringify({
            workflowId: input.workflowId, runId: input.runId, operationId: input.operationId,
            previousState: input.previousState, nextState: input.nextState,
            command: input.command, transition: input.transition,
          })}::jsonb
        )
      `;
      const previousRole = input.previousState.pendingRole;
      const current = previousRole ? await this.tasks.findInTransaction(tx, {
        namespace: 'flowkit-demo', flowId: input.workflowId, subjectType: 'leave', subjectId: input.subject.id,
        stage: input.previousState.stage, role: previousRole,
      }) : null;
      const taskPlan = planTaskProjection({
        namespace: 'flowkit-demo', flowId: input.workflowId, subject: { type: 'leave', id: input.subject.id },
        definition: this.definition, operationId: input.operationId, transitionSequence: input.sequence,
        action: input.command.action, actorId: input.command.actorId ?? null,
        previousState: input.previousState, nextState: input.nextState, metadata: {},
      }, current);
      await this.tasks.applyProjectionInTransaction(tx, { plan: taskPlan, operationId: input.operationId });
      await this.outbox.insertInTransaction(await this.notificationEnvelopes(input, request), tx);
      return { state: input.nextState, created: true };
    });
  }

  async close(): Promise<void> {
    if (this.ownsClient) await this.sql.end({ timeout: 5 });
  }

  private async findPriorResultInTransaction(tx: TransactionSql, operationId: string): Promise<RecordTransitionOutput | undefined> {
    const [row] = await tx<PriorTransitionRow[]>`
      SELECT a.metadata
      FROM leave_transitions t
      JOIN audit_events a ON a.action = 'flowkit.transition' AND a.metadata->>'operationId' = t.operation_key
      WHERE t.operation_key = ${operationId}
      LIMIT 1
    `;
    const metadata = typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : row?.metadata;
    return metadata?.nextState ? { state: metadata.nextState, created: false } : undefined;
  }

  private async advanceRequest(tx: TransactionSql, input: RecordTransitionInput): Promise<{ request: LeaveRequestRow } | { prior: RecordTransitionOutput }> {
    const [request] = await tx<LeaveRequestRow[]>`
      UPDATE leave_requests
      SET stage = ${input.nextState.stage}, revision = revision + 1,
          flow_id = COALESCE(flow_id, ${input.workflowId}), definition_hash = ${input.definition.hash}
      WHERE id = ${input.subject.id}
        AND stage = ${input.previousState.stage}
        AND revision = ${input.sequence - 1}
      RETURNING id, employee_id, manager_id, stage, revision
    `;
    if (request) return { request };
    const duplicate = await this.findPriorResultInTransaction(tx, input.operationId);
    if (duplicate) return { prior: duplicate };
    throw new LeaveFlowProjectionConflictError(input.workflowId, input.previousState.stage);
  }

  private async notificationEnvelopes(input: RecordTransitionInput, request: LeaveRequestRow): Promise<NotificationDeliveryEnvelope[]> {
    if (!input.notify) return [];
    const plan = await planNotification({
      namespace: 'flowkit-demo', sourceKey: `flowkit:${input.workflowId}:${input.operationId}`,
      aggregate: { type: 'leave', id: input.subject.id }, templateKey: input.notify.template,
      data: { requestId: input.subject.id, stage: input.nextState.stage, employeeName: request.employee_id },
      channels: input.notify.channels,
      explicitRecipients: [{ key: request.employee_id, routes: input.notify.channels.map((channel) => ({
        channel, canonicalKey: request.employee_id,
        address: channel === 'email' ? `${request.employee_id}@example.test` : request.employee_id,
      })) }],
    }, { templates: notificationTemplates, adapters: this.adapters.values() });
    return plan.envelopes;
  }
}
