import { randomUUID } from 'node:crypto';

import {
  createFlowkitConsumer,
  type FlowRuntime,
  type FlowkitActorResolver,
  type FlowkitConsumer,
  type FlowkitConsumerStart,
} from '@flowkit/consumer';
import { publishDefinition } from '@flowkit/temporal';

import { resolveDemoActor } from '../auth/principal.adapters';
import { LeaveFlowRepository } from '../db/leave-flow.repository';
import { leaveDefinition } from '../leave/leave.definition';
import { leaveRequestSchema, type LeaveRequest } from '../leave/leave.types';
import { PostgresInboxAdapter } from '../notifications/postgres-inbox.adapter';
import { leaveRuntime } from './temporal.client';

export const publishedLeaveDefinition = publishDefinition({ definition: leaveDefinition });

type FlowkitDemoConsumerDependencies = {
  runtime?: FlowRuntime;
  repository?: LeaveFlowRepository;
  actorResolver?: FlowkitActorResolver;
  now?: () => string;
};

export type LeaveFlowSubject = FlowkitConsumerStart['subject'] & { metadata: LeaveRequest };

/**
 * The demo's only Flowkit composition root. HTTP adapters use this facade and
 * never calculate a transition or alter workflow state themselves.
 */
export class FlowkitDemoConsumer implements FlowkitConsumer {
  readonly repository: LeaveFlowRepository;
  readonly tasks: FlowkitConsumer['tasks'];
  readonly outbox;
  readonly inbox: PostgresInboxAdapter;
  private readonly consumer: FlowkitConsumer;
  private readonly actorResolver: FlowkitActorResolver;

  constructor(dependencies: FlowkitDemoConsumerDependencies = {}) {
    this.repository = dependencies.repository ?? new LeaveFlowRepository();
    this.outbox = this.repository.outbox;
    this.inbox = new PostgresInboxAdapter(this.repository.sql);
    this.actorResolver = dependencies.actorResolver ?? { resolve: resolveDemoActor };
    const runtime = dependencies.runtime ?? leaveRuntime;
    const now = dependencies.now ?? (() => new Date().toISOString());
    this.consumer = createFlowkitConsumer({
      definition: publishedLeaveDefinition,
      runtime,
      tasks: this.repository.tasks,
      actorResolver: this.actorResolver,
      eligibility: {
        canWorkRole: async ({ actorId, role, task }) => {
          const actor = await this.actorResolver.resolve(actorId);
          if (!actor.roles.includes(role)) return false;
          if (task.subjectType !== 'leave' || role !== 'manager') return true;
          const request = await this.repository.getRequest(task.subjectId);
          return request?.manager_id === actor.id;
        },
      },
      clock: { now },
      views: {
        read: (state) => state,
        readByFlowId: async (flowId) => runtime.get({ flowId }),
      },
    });
    this.tasks = this.consumer.tasks;
  }

  async start(input: FlowkitConsumerStart) {
    const actor = await this.actorResolver.resolve(input.actor.id);
    const request = leaveRequestSchema.parse({ ...(input.subject.metadata ?? {}), employeeId: actor.id });
    if (!actor.roles.includes('employee') || request.employeeId !== actor.id) throw new Error('employee_not_authorized');
    await this.repository.createRequest({
      id: input.subject.id,
      flowId: input.flowId,
      request,
      operationId: input.operationId,
      definitionHash: publishedLeaveDefinition.definitionHash,
    });
    const view = await this.consumer.start({ ...input, actor, subject: { id: input.subject.id, metadata: request } });
    return { id: input.flowId, ...view };
  }

  act: FlowkitConsumer['act'] = (input) => this.consumer.act(input);
  getFlow: FlowkitConsumer['getFlow'] = (flowId) => this.consumer.getFlow(flowId);
}

export function createFlowkitDemoConsumer(dependencies: FlowkitDemoConsumerDependencies = {}) {
  return new FlowkitDemoConsumer(dependencies);
}

export function newLeaveFlowId() {
  return `leave-${randomUUID()}`;
}
