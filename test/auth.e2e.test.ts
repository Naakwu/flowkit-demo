import { describe, expect, it } from 'bun:test';
import { principal } from '../src/auth/principal.adapters';
describe('demo identities', () => { it('resolves a canonical employee principal without trusting request roles', () => { const user = principal('employee-1', 'employee'); expect(user.subjectId).toBe('employee-1'); expect(user.permissions).toContain('leave.submit'); }); });
