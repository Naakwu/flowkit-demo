import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('served demo API contract', () => {
  it('uses cookie-authenticated Flowkit routes without legacy identity headers', async () => {
    const app = await readFile(new URL('../apps/web/src/app.js', import.meta.url), 'utf8');

    expect(app).toContain("credentials: 'same-origin'");
    expect(app).toContain("'/auth/login'");
    expect(app).toContain("'/flows'");
    expect(app).toContain('/flows/${id}/actions');
    expect(app).toContain("'/tasks'");
    expect(app).toContain("'/notifications'");
    expect(app).toContain("'/runtime'");
    expect(app).not.toContain('x-demo-user');
    expect(app).not.toContain('x-demo-role');
    expect(app).not.toContain('/leave');
  });
});
