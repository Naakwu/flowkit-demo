import { afterEach, describe, expect, it } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { cleanup, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import {
  Alert,
  Badge,
  Button,
  EmptyState,
  LoadingState,
  Panel,
  SelectField,
  TextField,
} from './index';

if (typeof document === 'undefined') GlobalRegistrator.register();

afterEach(cleanup);

describe('FlowKit UI primitives', () => {
  it('keeps controls keyboard operable with explicit accessible names', async () => {
    const view = render(
      <form>
        <TextField label="Work email" name="email" type="email" required />
        <SelectField label="Organization" name="organization" options={[{ value: 'acme', label: 'Acme Demo' }]} />
        <Button type="submit">Continue</Button>
      </form>,
    );
    const user = userEvent.setup({ document: window.document });

    await user.tab();
    expect(document.activeElement).toBe(view.getByRole('textbox', { name: 'Work email' }));
    await user.tab();
    expect(document.activeElement).toBe(view.getByRole('combobox', { name: 'Organization' }));
    await user.tab();
    expect(document.activeElement).toBe(view.getByRole('button', { name: 'Continue' }));
  });

  it('announces loading and errors while empty content stays instructional', () => {
    const view = render(
      <>
        <LoadingState label="Loading requests" />
        <Alert tone="error" title="Requests unavailable">Refresh the page and try again.</Alert>
        <Panel title="Notifications" meta={<Badge tone="neutral">0 unread</Badge>}>
          <EmptyState title="No notifications">Updates about your requests will appear here.</EmptyState>
        </Panel>
      </>,
    );

    expect(view.getByRole('status').textContent).toContain('Loading requests');
    expect(view.getByRole('alert').textContent).toContain('Refresh the page and try again.');
    expect(view.getByRole('region', { name: 'Notifications' }).textContent).toContain('No notifications');
  });
});
