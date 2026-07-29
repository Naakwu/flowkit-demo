import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
describe('documentation contract', () => { it('documents Bun quickstart and migration guard', async () => { const text = await readFile(new URL('../README.md', import.meta.url), 'utf8'); expect(text).toContain('bun install'); expect(text).toContain('FLOWKIT_DEMO_MIGRATION_APPROVED'); expect(text).not.toContain('npm '); }); });
