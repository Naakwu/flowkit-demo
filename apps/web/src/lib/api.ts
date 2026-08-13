export type SessionPayload = {
  user: { id: string; name: string; email: string; emailVerified: boolean };
  session: { id: string; userId: string; activeOrganizationId?: string | null; expiresAt: string };
};

export type Organization = { id: string; name: string; slug: string; logo?: string | null };

export type ActiveMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
  applicationRole: 'employee' | 'manager' | 'hr' | 'readonly_auditor';
  enabled: boolean;
};

export type CreateRequestInput = {
  startDate: string;
  endDate: string;
  businessDays: number;
  balanceDays: number;
  managerId: string;
  reason: string;
};

export type FlowActivity = {
  id?: string;
  actorId: string;
  action: string;
  fromStage: string;
  toStage: string;
  occurredAt: string;
};

export type FlowRecord = {
  id: string;
  employee_id: string;
  manager_id: string;
  start_date: string;
  end_date: string;
  business_days: number;
  balance_days: number;
  reason: string;
  definitionHash: string;
  sequence: number;
  state: { stage: string };
  nextActions: string[];
  activities: FlowActivity[];
};

export type TaskRecord = {
  id: string;
  subjectId: string;
  stage: string;
  role: string;
  status: 'open' | 'claimed' | 'completed' | 'cancelled';
  revision: number;
  assigneeId?: string | null;
};

export type NotificationPayload = {
  inbox: Array<{ id: string; subject: string; body: string; deliveredAt: string }>;
  deliveries: Array<{ id: string; subject: string; status: string }>;
};

export type RuntimeStatus = {
  flowkitRuntime?: { ready: boolean; heartbeatAt?: string };
  delivery?: { ready: boolean; heartbeatAt?: string };
  mailpitUrl?: string;
};

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'ApiError';
  }
}

type IdFactory = () => string;

export class ApiClient {
  constructor(private readonly newIdempotencyKey: IdFactory = () => crypto.randomUUID()) {}

  getSession() {
    return this.request<SessionPayload | null>('/api/auth/get-session');
  }

  signIn(email: string, password: string) {
    return this.request<SessionPayload>('/api/auth/sign-in/email', { method: 'POST', body: { email, password } });
  }

  signOut() {
    return this.request<{ success: boolean }>('/api/auth/sign-out', { method: 'POST' });
  }

  listOrganizations() {
    return this.request<Organization[]>('/api/auth/organization/list');
  }

  setActiveOrganization(organizationId: string) {
    return this.request<Organization | null>('/api/auth/organization/set-active', { method: 'POST', body: { organizationId } });
  }

  getActiveMember() {
    return this.request<ActiveMember>('/api/auth/organization/get-active-member');
  }

  createRequest(input: CreateRequestInput) {
    return this.mutation<FlowRecord>('/flows', input);
  }

  getRequest(id: string) {
    return this.request<FlowRecord>(`/flows/${encodeURIComponent(id)}`);
  }

  transitionRequest(id: string, action: string, comment?: string) {
    return this.mutation<unknown>(`/flows/${encodeURIComponent(id)}/actions`, { action, ...(comment ? { comment } : {}) });
  }

  listTasks() {
    return this.request<TaskRecord[]>('/tasks');
  }

  claimTask(id: string, expectedRevision: number) {
    return this.mutation<TaskRecord>(`/tasks/${encodeURIComponent(id)}/claim`, { expectedRevision });
  }

  listNotifications() {
    return this.request<NotificationPayload>('/notifications');
  }

  getRuntime() {
    return this.request<RuntimeStatus>('/runtime');
  }

  private mutation<T>(path: string, body: unknown) {
    return this.request<T>(path, {
      method: 'POST',
      body,
      headers: { 'idempotency-key': this.newIdempotencyKey() },
    });
  }

  private async request<T>(
    path: string,
    init: Omit<RequestInit, 'body'> & { body?: unknown } = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    const hasBody = init.body !== undefined;
    if (hasBody) headers.set('content-type', 'application/json');
    const response = await fetch(path, {
      ...init,
      credentials: 'same-origin',
      headers,
      body: hasBody ? JSON.stringify(init.body) : undefined,
    });
    const payload = await response.json().catch(() => null) as unknown;
    if (!response.ok) {
      const detail = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      const rawMessage = detail.message ?? detail.error;
      const message = Array.isArray(rawMessage) ? rawMessage.join(', ') : typeof rawMessage === 'string' ? rawMessage : `Request failed (${response.status}).`;
      throw new ApiError(message, response.status);
    }
    return payload as T;
  }
}

export const api = new ApiClient();

export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'The request could not be completed.';
}
