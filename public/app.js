const operators = {
  'employee-1': { label: 'Employee', initials: 'EM' },
  'manager-1': { label: 'Manager', initials: 'M1' },
  'manager-2': { label: 'Manager', initials: 'M2' },
  'hr-1': { label: 'HR', initials: 'HR' },
};
const roleLabels = { employee: 'Employee', manager: 'Manager', hr: 'HR', readonly_auditor: 'Readonly auditor' };
const state = { selectedId: null, operatorId: 'employee-1', principal: null };
const $ = (selector) => document.querySelector(selector);
const currentOperator = () => operators[state.operatorId] || operators['employee-1'];
const currentRole = () => state.principal?.role;
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
const toast = (message, error = false) => { const node = $('#toast'); node.textContent = message; node.style.borderColor = error ? '#ef4444' : '#ff6b35'; node.classList.add('show'); window.clearTimeout(toast.timer); toast.timer = window.setTimeout(() => node.classList.remove('show'), 2800); };
const stageOrder = ['employee_draft', 'policy_evaluation', 'manager_review', 'fulfillment', 'approved'];
const stageLabel = { employee_draft: 'DRAFT', policy_evaluation: 'EVALUATING', manager_review: 'MANAGER REVIEW', fulfillment: 'FULFILLMENT', approved: 'APPROVED', rejected: 'REJECTED' };
function renderOperator() {
  const operator = currentOperator();
  $('#operator-select').value = state.operatorId;
  $('#operator-name').textContent = state.principal?.subjectId || state.operatorId;
  $('#operator-role').textContent = `Demo operator · ${roleLabels[currentRole()] || operator.label}`;
  $('#operator-avatar').textContent = operator.initials;
  $('#request-actor-badge').textContent = state.operatorId.toUpperCase();
}
function actionButton(label, action, className = 'secondary') { return `<button class="button ${className} small record-action" data-action="${action}">${label}</button>`; }
function renderFlow(record) {
  if (!record) return;
  state.selectedId = record.id;
  $('#flow-title').textContent = record.id;
  $('#flow-id').textContent = `${record.id} · SEQUENCE ${String(record.sequence).padStart(2, '0')}`;
  const badge = $('#flow-badge'); badge.textContent = stageLabel[record.state.stage] || record.state.stage.toUpperCase(); badge.className = `badge ${record.state.stage === 'approved' ? 'badge-success' : record.state.stage === 'rejected' ? 'badge-error' : 'badge-pending'}`;
  const index = stageOrder.indexOf(record.state.stage);
  document.querySelectorAll('.flow-step').forEach((step) => { const stepIndex = stageOrder.indexOf(step.dataset.stage); step.classList.toggle('done', stepIndex >= 0 && stepIndex < index); step.classList.toggle('current', step.dataset.stage === record.state.stage); });
  const result = $('#request-result'); result.classList.remove('hidden');
  const controls = [];
  if (record.state.stage === 'employee_draft' && currentRole() === 'employee') controls.push(actionButton('Submit request', 'submit', 'primary'));
  if (record.state.stage === 'manager_review' && currentRole() === 'manager') { controls.push(actionButton('Approve request', 'approve', 'primary')); controls.push(actionButton('Reject request', 'reject')); }
  result.innerHTML = `<span>${record.id} · ${stageLabel[record.state.stage]}</span><div class="inline-actions">${controls.join('')}</div>`;
  result.querySelectorAll('.record-action').forEach((button) => button.addEventListener('click', () => transitionRecord(record.id, button.dataset.action)));
}
async function loadFlow(id) { return api(`/flows/${id}`); }
async function transitionRecord(id, action) {
  try {
    await api(`/flows/${id}/actions`, { method: 'POST', body: JSON.stringify({ action }) });
    renderFlow(await loadFlow(id));
    toast(`${action.replaceAll('_', ' ')} completed`);
    await refresh();
  } catch (error) { toast(error.message, true); }
}
function renderTasks(items) {
  $('#task-count').textContent = items.length; $('#stat-tasks').textContent = items.length; const target = $('#tasks-list');
  if (!items.length) { target.className = 'empty-state'; target.innerHTML = '<span class="empty-icon">▤</span><strong>No manager tasks</strong><p>Submit a multi-day request to route work to a manager.</p>'; return; }
  target.className = '';
  target.innerHTML = items.map((task) => { const controls = currentRole() === 'manager' && task.status === 'open' ? actionButton('Claim', 'claim', 'secondary') : currentRole() === 'manager' && task.status === 'claimed' && task.assigneeId === state.principal?.subjectId ? `${actionButton('Approve', 'approve-task', 'primary')}${actionButton('Reject', 'reject-task')}` : ''; return `<div class="task-row"><div class="row-main"><strong>${task.stage.replaceAll('_', ' ')}</strong><small>${task.role} · ${task.status}${task.assigneeId ? ` · ${task.assigneeId}` : ''}</small><code>${task.id}</code></div><div class="inline-actions task-actions">${controls}</div></div>`; }).join('');
  target.querySelectorAll('.task-actions .record-action').forEach((button, index) => button.addEventListener('click', async () => {
    const task = items[index];
    try {
      if (button.dataset.action === 'claim') {
        await api(`/tasks/${task.id}/claim`, { method: 'POST', body: JSON.stringify({ expectedRevision: task.revision }) });
        toast(`Claimed by ${state.principal.subjectId}`);
      } else {
        await transitionRecord(task.subjectId, button.dataset.action === 'approve-task' ? 'approve' : 'reject');
      }
      await refresh();
    } catch (error) { toast(error.message, true); }
  }));
}
function renderNotifications(items) { $('#stat-notifications').textContent = items.length; const target = $('#notifications-list'); if (!items.length) { target.className = 'empty-state'; target.innerHTML = '<span class="empty-icon">◌</span><strong>No deliveries yet</strong><p>Transitions will fan out to inbox and email channels.</p>'; return; } target.className = ''; target.innerHTML = items.slice().reverse().map((item) => `<div class="notification-row"><div class="row-main"><strong>${item.subject}</strong><small>${item.status}</small></div><span class="badge ${item.status === 'delivered' ? 'badge-success' : 'badge-pending'}">${item.status}</span></div>`).join(''); }
function renderHealth(status) { const runtime = status.flowkitRuntime?.ready; const delivery = status.delivery?.ready; $('#stat-health').textContent = runtime && delivery ? '100%' : runtime ? 'API' : 'OFFLINE'; $('#health-label').textContent = runtime && delivery ? 'Flowkit + delivery online' : runtime ? 'delivery not reporting' : 'runtime unavailable'; $('#health-dot').classList.toggle('pulse-muted', !delivery); }
async function refresh() {
  try {
    const [tasks, notifications, status] = await Promise.all([api('/tasks'), api('/notifications'), api('/runtime')]);
    renderTasks(tasks); renderNotifications(notifications); renderHealth(status);
    if (state.selectedId) renderFlow(await loadFlow(state.selectedId));
    $('#runtime-time').textContent = new Date().toLocaleTimeString('en-GB');
  } catch (error) { toast(error.message, true); }
}
async function createRequest(input, quick = false) {
  const record = await api('/flows', { method: 'POST', body: JSON.stringify(input) });
  renderFlow(record); $('#stat-requests').textContent = '1';
  if (quick) {
    await api(`/flows/${record.id}/actions`, { method: 'POST', body: JSON.stringify({ action: 'submit' }) });
    renderFlow(await loadFlow(record.id));
    toast('Short leave submitted; Flowkit will complete its automatic steps.');
  } else toast('Request created — submit it to continue');
  await refresh();
}
async function switchOperator(userId) {
  const result = await api('/auth/login', { method: 'POST', body: JSON.stringify({ userId }) });
  state.principal = result.principal;
  state.operatorId = result.principal.subjectId;
  renderOperator();
  await refresh();
}
$('#request-form').addEventListener('submit', async (event) => { event.preventDefault(); const data = Object.fromEntries(new FormData(event.currentTarget)); try { await createRequest({ ...data, businessDays: Number(data.businessDays), balanceDays: Number(data.balanceDays) }); } catch (error) { toast(error.message, true); } });
$('#quick-demo').addEventListener('click', async () => { const data = Object.fromEntries(new FormData($('#request-form'))); try { await createRequest({ ...data, businessDays: 1, balanceDays: 10, startDate: '2026-08-03', endDate: '2026-08-03' }, true); } catch (error) { toast(error.message, true); } });
$('#operator-select').addEventListener('change', async (event) => { try { await switchOperator(event.target.value); toast(`Acting as ${state.operatorId}`); } catch (error) { toast(error.message, true); renderOperator(); } });
$('#refresh').addEventListener('click', refresh); $('#refresh-tasks').addEventListener('click', refresh); $('#refresh-notifications').addEventListener('click', refresh); $('#view-request').addEventListener('click', () => { if (state.selectedId) toast(`Active record: ${state.selectedId}`); });
switchOperator(state.operatorId).catch((error) => toast(error.message, true));
