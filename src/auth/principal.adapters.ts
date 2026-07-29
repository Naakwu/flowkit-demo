import { freezePrincipal, type AuthenticatedPrincipal } from '@flowkit/auth';
import type { FlowkitActorRef } from '@flowkit/consumer';
import { roleRegistry } from './role-registry';

const canonicalRoles = {
  'employee-1': 'employee',
  'manager-1': 'manager',
  'manager-2': 'manager',
  'hr-1': 'hr',
  'auditor-1': 'readonly_auditor',
  system: 'system',
} as const satisfies Record<string, keyof typeof roleRegistry.definitions>;

export function principal(id: string, role: keyof typeof roleRegistry.definitions): AuthenticatedPrincipal {
  return freezePrincipal({ authUserId: id, subjectId: id, role, permissions: roleRegistry.definitions[role].permissions, readOnly: roleRegistry.isReadOnly(role), identityProofs: [], session: { id: `session-${id}`, issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 86_400_000).toISOString() } });
}

/** Resolves only the demo identities seeded by this application; request roles are never authoritative. */
export async function resolveDemoActor(id: string): Promise<FlowkitActorRef> {
  const role = canonicalRoles[id as keyof typeof canonicalRoles];
  if (!role) throw new Error('actor_not_found');
  return { id, roles: [role] };
}

export function principalFromRequest(request: { headers?: Record<string, string | string[] | undefined> }, fallback: { id: string; role: keyof typeof roleRegistry.definitions }): AuthenticatedPrincipal {
  const headers = request.headers ?? {};
  const header = (name: string) => { const value = headers[name] ?? headers[name.toLowerCase()]; return Array.isArray(value) ? value[0] : value; };
  const id = header('x-demo-user') || fallback.id;
  const role = canonicalRoles[id as keyof typeof canonicalRoles] ?? fallback.role;
  return principal(id, role);
}
