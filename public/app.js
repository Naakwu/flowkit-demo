const operators = {
  'employee-1': { label: 'Employee', initials: 'EM' },
  'manager-1': { label: 'Manager', initials: 'M1' },
  'manager-2': { label: 'Manager', initials: 'M2' },
  'hr-1': { label: 'HR', initials: 'HR' },
};
const roleLabels = { employee: 'Employee', manager: 'Manager', hr: 'HR', readonly_auditor: 'Readonly auditor' };
const stageOrder = ['employee_draft', 'policy_evaluation', 'manager_review', 'fulfillment', 'approved'];
const stageLabel = {
  employee_draft: 'DRAFT', policy_evaluation: 'EVALUATING', manager_review: 'MANAGER REVIEW',
  fulfillment: 'FULFILLMENT', approved: 'APPROVED', rejected: 'REJECTED', withdrawn: 'WITHDRAWN',
};
const state = { selectedId: null, operatorId: 'employee-1', principal: null, flow: null, tasks: [] };
const $ = (selector) => document.querySelector(selector);
const currentRole = () => state.principal?.role;
const currentOperator = () => operators[state.operatorId] || operators['employee-1'];
const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[character]));
const displayStage = (stage) => stageLabel[stage] || String(stage || 'unknown').replaceAll('_', ' ').toUpperCase();
const displayAction = (action) => String(action || '').replaceAll('_', ' ');
const timestamp = (value) => value ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'medium' }).format(new Date(value)) : 'not reported';

const api = async (path, options = {}) => {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.error) {
    const message = Array.isArray(body.message) ? body.message.join(', ') : body.message || body.error || `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body;
};

function toast(message, isError = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', isError);
  node.classList.add('show');
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove('show'), 3500);
}

function renderOperator() {
  const operator = currentOperator();
  $('#operator-select').value = state.operatorId;
  $('#operator-name').textContent = state.principal?.subjectId || state.operatorId;
  $('#operator-role').textContent = `Demo operator · ${roleLabels[currentRole()] || operator.label}`;
  $('#operator-avatar').textContent = operator.initials;
  $('#request-actor-badge').textContent = state.operatorId.toUpperCase();
  const canCreate = currentRole() === 'employee';
  $('#request-fields').disabled = !canCreate;
  $('#request-guidance').textContent = canCreate
    ? 'Create a request, then submit it from the selected flow. Five business days routes it to manager-1.'
    : 'Only the requesting employee can create a leave flow. Switch operator to employee-1 to start one.';
}

function actionButton(label, action, className = 'secondary', extra = '') {
  return `<button class="button ${className} small record-action" type="button" data-action="${escapeHtml(action)}" ${extra}>${escapeHtml(label)}</button>`;
}

function taskForSelectedFlow() {
  return state.tasks.find((task) => task.subjectId === state.selectedId) || null;
}

function canAct(record, action) {
  return Boolean(record?.nextActions?.includes(action));
}

function renderFlow(record) {
  if (!record) return;
  state.selectedId = record.id;
  state.flow = record;
  $('#stat-requests').textContent = '1';
  $('#selected-flow-summary').textContent = displayStage(record.state.stage);
  $('#flow-title').textContent = record.id;
  $('#flow-id').textContent = `${record.id} · SEQUENCE ${String(record.sequence || 0).padStart(2, '0')}`;
  $('#definition-hash').textContent = record.definitionHash || 'IMMUTABLE HASH / LOADING';
  const badge = $('#flow-badge');
  const terminal = ['approved', 'rejected', 'withdrawn'].includes(record.state.stage);
  badge.textContent = displayStage(record.state.stage);
  badge.className = `badge ${record.state.stage === 'approved' ? 'badge-success' : terminal ? 'badge-error' : 'badge-pending'}`;

  const index = stageOrder.indexOf(record.state.stage);
  document.querySelectorAll('.flow-step').forEach((step) => {
    const stepIndex = stageOrder.indexOf(step.dataset.stage);
    step.classList.toggle('done', stepIndex >= 0 && stepIndex < index);
    step.classList.toggle('current', step.dataset.stage === record.state.stage);
  });

  const controls = [];
  const task = taskForSelectedFlow();
  let hint = 'Flowkit is calculating the next state.';
  if (record.state.stage === 'employee_draft' && currentRole() === 'employee' && canAct(record, 'submit')) {
    controls.push(actionButton('Submit request', 'submit', 'primary'));
    hint = 'Review the request, then submit it to route the decision.';
  } else if (record.state.stage === 'manager_review' && currentRole() === 'manager') {
    if (!task || task.status === 'open') {
      hint = 'Claim the manager task in your queue before making a decision.';
    } else if (task.assigneeId === state.principal?.subjectId && canAct(record, 'approve')) {
      controls.push(actionButton('Approve request', 'approve', 'primary'));
      controls.push(actionButton('Reject request', 'reject'));
      hint = 'You own this task. Approve or reject the request.';
    } else {
      hint = 'This manager task is claimed by another operator.';
    }
  } else if (terminal) {
    hint = 'Final outcome recorded. Review the activity and delivery evidence below.';
  } else if (record.state.stage === 'manager_review') {
    hint = 'A manager must claim the assigned review task.';
  }
  $('#flow-action-hint').textContent = hint;
  const result = $('#request-result');
  result.classList.remove('hidden');
  result.innerHTML = `<div><strong>${escapeHtml(displayStage(record.state.stage))}</strong><code>${escapeHtml(record.id)}</code></div><div class="inline-actions">${controls.join('')}</div>`;
  result.querySelectorAll('.record-action').forEach((button) => button.addEventListener('click', () => transitionRecord(record.id, button.dataset.action)));
  renderTimeline(record.activities || []);
}

function renderTimeline(activities) {
  $('#activity-count').textContent = `${activities.length} EVENT${activities.length === 1 ? '' : 'S'}`;
  const target = $('#activity-timeline');
  if (!activities.length) {
    target.innerHTML = '<li class="empty-state"><span class="empty-icon">↳</span><strong>No transition has been recorded</strong><p>Submit this request to create the first durable activity entry.</p></li>';
    return;
  }
  target.innerHTML = activities.map((item) => `<li class="activity-item"><span class="activity-marker"></span><div><strong>${escapeHtml(item.actorId)}</strong><p><b>${escapeHtml(displayAction(item.action))}</b> · ${escapeHtml(displayStage(item.fromStage))} → ${escapeHtml(displayStage(item.toStage))}</p><time>${escapeHtml(timestamp(item.occurredAt))}</time></div></li>`).join('');
}

async function loadFlow(id) {
  const record = await api(`/flows/${id}`);
  renderFlow(record);
  return record;
}

async function transitionRecord(id, action) {
  try {
    await api(`/flows/${id}/actions`, { method: 'POST', body: JSON.stringify({ action }) });
    await refresh({ reloadFlow: true });
    toast(`${displayAction(action)} recorded`);
  } catch (error) {
    toast(`${error.message}. Refresh the flow and try again.`, true);
  }
}

function renderTasks(items) {
  state.tasks = items;
  $('#task-count').textContent = items.length;
  $('#stat-tasks').textContent = items.length;
  const target = $('#tasks-list');
  if (!items.length) {
    target.className = 'empty-state';
    target.innerHTML = '<span class="empty-icon">▤</span><strong>No tasks for this operator</strong><p>Managers receive multi-day requests after an employee submits them.</p>';
    return;
  }
  target.className = '';
  target.innerHTML = items.map((task) => {
    const isManager = currentRole() === 'manager';
    const actions = isManager && task.status === 'open'
      ? actionButton('Claim task', 'claim', 'secondary')
      : isManager && task.status === 'claimed' && task.assigneeId === state.principal?.subjectId
        ? `${actionButton('Open flow', 'open-flow', 'secondary')}${actionButton('Approve', 'approve-task', 'primary')}${actionButton('Reject', 'reject-task')}`
        : actionButton('Open flow', 'open-flow', 'secondary');
    return `<article class="task-row" data-task-id="${escapeHtml(task.id)}"><div class="row-main"><strong>${escapeHtml(displayStage(task.stage))}</strong><small>${escapeHtml(task.role)} · ${escapeHtml(task.status)}${task.assigneeId ? ` · ${escapeHtml(task.assigneeId)}` : ''}</small><code>${escapeHtml(task.subjectId)}</code></div><div class="inline-actions task-actions">${actions}</div></article>`;
  }).join('');
  target.querySelectorAll('.task-row').forEach((row) => {
    const task = items.find((item) => item.id === row.dataset.taskId);
    row.querySelectorAll('.record-action').forEach((button) => button.addEventListener('click', async () => {
      if (!task) return;
      try {
        if (button.dataset.action === 'claim') {
          await api(`/tasks/${task.id}/claim`, { method: 'POST', body: JSON.stringify({ expectedRevision: task.revision }) });
          toast('Task claimed. The decision controls are now available.');
          await refresh({ reloadFlow: task.subjectId === state.selectedId });
          return;
        }
        if (button.dataset.action === 'open-flow') {
          await loadFlow(task.subjectId);
          document.querySelector('#activity-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          return;
        }
        await transitionRecord(task.subjectId, button.dataset.action === 'approve-task' ? 'approve' : 'reject');
      } catch (error) {
        toast(`${error.message}. Refresh the task queue and try again.`, true);
      }
    }));
  });
}

function deliveryBadge(status) {
  if (status === 'delivered') return 'badge-success';
  if (['failed', 'reconciliation_required'].includes(status)) return 'badge-error';
  return 'badge-pending';
}

function renderNotifications(payload) {
  const inbox = payload?.inbox || [];
  const deliveries = payload?.deliveries || [];
  $('#stat-notifications').textContent = inbox.length;
  const target = $('#notifications-list');
  if (!inbox.length && !deliveries.length) {
    target.className = 'empty-state';
    target.innerHTML = '<span class="empty-icon">◌</span><strong>No notifications for this operator</strong><p>Flowkit writes in-app notices after the delivery worker processes a transition.</p>';
    return;
  }
  target.className = '';
  const inboxRows = inbox.map((item) => `<article class="notification-row"><div class="row-main"><strong>${escapeHtml(item.subject)}</strong><small>${escapeHtml(item.body)}</small><code>${escapeHtml(timestamp(item.deliveredAt))}</code></div><span class="badge badge-success">INBOX</span></article>`).join('');
  const deliveryRows = deliveries.map((item) => `<article class="notification-row delivery-row"><div class="row-main"><strong>${escapeHtml(item.subject)}</strong><small>Email or inbox delivery evidence</small><code>${escapeHtml(item.id)}</code></div><span class="badge ${deliveryBadge(item.status)}">${escapeHtml(item.status)}</span></article>`).join('');
  target.innerHTML = `${inboxRows}${deliveryRows}`;
}

function renderServiceStatus(name, service) {
  const ready = Boolean(service?.ready);
  return `<article class="service-status"><div><strong>${escapeHtml(name)}</strong><small>${ready ? 'heartbeat current' : 'heartbeat missing or stale'}</small></div><code>${escapeHtml(timestamp(service?.heartbeatAt))}</code><span class="badge ${ready ? 'badge-success' : 'badge-error'}">${ready ? 'READY' : 'OFFLINE'}</span></article>`;
}

function renderHealth(status) {
  const runtime = status.flowkitRuntime;
  const delivery = status.delivery;
  const online = runtime?.ready && delivery?.ready;
  $('#stat-health').textContent = online ? 'READY' : 'CHECK';
  $('#health-label').textContent = online ? 'runtime and delivery reporting' : 'service heartbeat needs attention';
  $('#health-dot').classList.toggle('pulse-muted', !online);
  $('#runtime-dot').classList.toggle('pulse-muted', !runtime?.ready);
  $('#delivery-dot').classList.toggle('pulse-muted', !delivery?.ready);
  $('#runtime-side-status').textContent = runtime?.ready ? 'READY' : 'CHECK';
  $('#delivery-side-status').textContent = delivery?.ready ? 'READY' : 'CHECK';
  const badge = $('#runtime-status');
  badge.textContent = online ? 'ALL READY' : 'ATTENTION';
  badge.className = `badge ${online ? 'badge-success' : 'badge-pending'}`;
  $('#runtime-list').innerHTML = `${renderServiceStatus('Flowkit runtime', runtime)}${renderServiceStatus('Delivery worker', delivery)}`;
}

async function refresh({ reloadFlow = false } = {}) {
  try {
    const [tasks, notifications, status] = await Promise.all([api('/tasks'), api('/notifications'), api('/runtime')]);
    renderTasks(tasks);
    renderNotifications(notifications);
    renderHealth(status);
    if (state.selectedId && (reloadFlow || state.flow)) await loadFlow(state.selectedId);
  } catch (error) {
    toast(error.message, true);
  }
}

async function createRequest(input) {
  const record = await api('/flows', { method: 'POST', body: JSON.stringify(input) });
  state.selectedId = record.id;
  await loadFlow(record.id);
  toast('Request created. Submit it from the selected flow to continue.');
  await refresh();
}

async function switchOperator(userId) {
  const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ userId }) });
  state.principal = result.principal;
  state.operatorId = result.principal.subjectId;
  renderOperator();
  await refresh({ reloadFlow: Boolean(state.selectedId) });
}

$('#request-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    await createRequest({ ...data, businessDays: Number(data.businessDays), balanceDays: Number(data.balanceDays) });
  } catch (error) {
    toast(error.message, true);
  }
});
$('#operator-select').addEventListener('change', async (event) => {
  try {
    await switchOperator(event.target.value);
    toast(`Acting as ${state.operatorId}`);
  } catch (error) {
    toast(error.message, true);
    renderOperator();
  }
});
$('#refresh').addEventListener('click', () => refresh({ reloadFlow: Boolean(state.selectedId) }));
$('#refresh-tasks').addEventListener('click', () => refresh({ reloadFlow: Boolean(state.selectedId) }));
$('#refresh-notifications').addEventListener('click', () => refresh({ reloadFlow: Boolean(state.selectedId) }));
switchOperator(state.operatorId).catch((error) => toast(error.message, true));
