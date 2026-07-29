import { describe, expect, it } from 'bun:test';
import { roleRegistry } from '../src/auth/role-registry';
import { principal } from '../src/auth/principal.adapters';
describe('authorization boundary', () => { it('uses canonical role keys and enforces readonly', () => { expect(roleRegistry.listRoles()).toEqual(['employee', 'manager', 'hr', 'readonly_auditor', 'system']); expect(principal('auditor-1', 'readonly_auditor').readOnly).toBe(true); expect(roleRegistry.canSelfProvision('system')).toBe(false); }); });
