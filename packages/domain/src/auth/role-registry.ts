import { defineRoleRegistry } from '@naakwu/flowkit-auth/roles';

export const roleRegistry = defineRoleRegistry({
  employee: { label: 'Employee', permissions: ['leave.create', 'leave.view_own', 'leave.submit', 'task.view_own'], scopes: ['account'], kind: 'external', provisioning: 'invite_only' },
  manager: { label: 'Manager', permissions: ['leave.view_team', 'leave.review', 'task.claim', 'task.release'], scopes: ['account'], kind: 'internal', provisioning: 'invite_only' },
  hr: { label: 'HR', permissions: ['leave.view_all', 'notification.view', 'audit.view'], scopes: ['account'], kind: 'internal', provisioning: 'invite_only' },
  readonly_auditor: { label: 'Readonly auditor', permissions: ['leave.view_all', 'audit.view'], scopes: ['account'], kind: 'internal', provisioning: 'invite_only', readOnly: true },
  system: { label: 'System', permissions: ['flow.system'], scopes: ['internal'], kind: 'system', provisioning: 'disabled' },
});

export type DemoRole = keyof typeof roleRegistry.definitions;
