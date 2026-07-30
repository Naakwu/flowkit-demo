import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';

describe('Flowkit reference console contract', () => {
  it('contains the complete role-aware journey without runtime-engine terminology', async () => {
    const [html, app] = await Promise.all([
      readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
      readFile(new URL('../public/app.js', import.meta.url), 'utf8'),
    ]);

    expect(html).toContain('id="operator-select"');
    expect(html).toContain('id="activity-timeline"');
    expect(html).toContain('id="runtime-status"');
    expect(html).toContain('id="notification-inbox"');
    expect(html).toContain('Open Mailpit email preview');
    expect(html).toContain('data-mailpit-link');
    expect(html).not.toMatch(/temporal|namespace|task queue/i);
    expect(app).toContain("credentials: 'same-origin'");
    expect(app).toContain("'/auth/login'");
    expect(app).toContain("'/flows'");
    expect(app).toContain("'/tasks'");
    expect(app).toContain("'/notifications'");
    expect(app).toContain("'/runtime'");
    expect(app).toContain('pollForInboxDelivery');
    // A Flowkit rule advances the automatic stages with no operator input, so the console has to
    // keep reading the flow instead of stranding the page on the intermediate stage.
    expect(app).toContain('pollForSettledStage');
    expect(app).toContain('policy_evaluation');
    expect(app).toContain('mailpitUrl');
    expect(app).not.toMatch(/x-demo-user|x-demo-role|temporal|task queue/i);
  });
});
