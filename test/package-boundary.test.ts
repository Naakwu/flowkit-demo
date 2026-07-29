import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import { glob } from 'glob';

describe('consumer boundary', () => { it('has no FAAN or sibling source imports', async () => { const files = await glob('packages/flowkit-demo/{src,test,scripts}/**/*.{ts,tsx}'); for (const file of files.filter(file => !file.endsWith('package-boundary.test.ts'))) { const text = await readFile(file, 'utf8'); expect(text).not.toMatch(/(?:from|import\()[^\n]*(?:faan-avsec|flowkit-[^'"/]+\/src|\.\.\/\.\.\/[^'" ]+\/src)/); } }); });
