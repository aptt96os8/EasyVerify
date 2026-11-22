const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const loginForm = document.getElementById('login-form');
const loginButton = document.getElementById('login-button');
const loginError = document.getElementById('login-error');
const loginUsername = document.getElementById('username');
const loginPassword = document.getElementById('password');
const logoutButton = document.getElementById('logout-button');
const logoutMessage = document.getElementById('logout-message');
const cardList = document.getElementById('card-list');
const selectAll = document.getElementById('select-all');
const selectionCount = document.getElementById('selection-count');
const operationMessage = document.getElementById('operation-message');
const generateDialog = document.getElementById('generate-dialog');
const adjustDialog = document.getElementById('adjust-dialog');
const concurrencyDialog = document.getElementById('concurrency-dialog');
const exportDialog = document.getElementById('export-dialog');
const importDialog = document.getElementById('import-dialog');
const confirmDialog = document.getElementById('confirm-dialog');
const announcementDialog = document.getElementById('announcement-dialog');
const priorityDialog = document.getElementById('priority-dialog');
const announcementMessage = document.getElementById('announcement-message');
const pageSize = 20;
const importBatchBytes = 60000;
const selected = new Set();
let start = 0;
let total = 0;
let cards = [];
let loading = false;
let adjustDirection = 'add';
let priorityAnnouncementId = 0;
let activeSession = null;
let expiryTimer;
const startupSessionCheck = new AbortController();

function formatTime(value) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '首次登录后生效';
}

function formatDuration(value) {
  if (value % 86400 === 0) return `${value / 86400} 天`;
  if (value % 3600 === 0) return `${value / 3600} 小时`;
  if (value % 60 === 0) return `${value / 60} 分钟`;
  return `${value} 秒`;
}

function notify(element, text, success = false) {
  element.textContent = text;
  element.classList.toggle('is-success', success);
}

function notifyError(element, error) {
  if (error.name !== 'AbortError') notify(element, error.message);
}

function confirmAction(title) {
  document.getElementById('confirm-title').textContent = title;
  confirmDialog.returnValue = '';
  confirmDialog.showModal();
  return new Promise((resolve) => confirmDialog.addEventListener('close', () => resolve(confirmDialog.returnValue === 'ok'), { once: true }));
}

function enhanceSelect(select) {
  const wrapper = document.createElement('div');
  wrapper.className = 'select';
  select.before(wrapper);
  wrapper.append(select);
  select.classList.add('native-select');
  select.tabIndex = -1;
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'select-trigger';
  trigger.setAttribute('aria-haspopup', 'listbox');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.setAttribute('aria-label', select.getAttribute('aria-label') || '');
  const label = document.createElement('span');
  trigger.append(label);
  const list = document.createElement('ul');
  list.className = 'select-options';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  const items = [...select.options].map((option) => {
    const item = document.createElement('li');
    item.setAttribute('role', 'option');
    item.tabIndex = -1;
    item.dataset.value = option.value;
    item.textContent = option.textContent;
    item.addEventListener('click', () => choose(item));
    list.append(item);
    return item;
  });
  wrapper.append(trigger, list);

  function sync() {
    label.textContent = select.selectedOptions[0]?.textContent || '';
    for (const item of items) item.setAttribute('aria-selected', String(item.dataset.value === select.value));
  }
  function open() {
    list.hidden = false;
    wrapper.classList.add('open');
    trigger.setAttribute('aria-expanded', 'true');
    (items.find((item) => item.dataset.value === select.value) || items[0]).focus();
  }
  function close(focusTrigger = false) {
    list.hidden = true;
    wrapper.classList.remove('open');
    trigger.setAttribute('aria-expanded', 'false');
    if (focusTrigger) trigger.focus();
  }
  function choose(item) {
    if (select.value !== item.dataset.value) {
      select.value = item.dataset.value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    sync();
    close(true);
  }

  trigger.addEventListener('click', () => (list.hidden ? open() : close()));
  trigger.addEventListener('keydown', (event) => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      open();
    }
  });
  list.addEventListener('keydown', (event) => {
    const index = items.indexOf(document.activeElement);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      items[(index + (event.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length].focus();
    } else if ((event.key === 'Enter' || event.key === ' ') && index >= 0) {
      event.preventDefault();
      choose(items[index]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'Tab') {
      close();
    }
  });
  document.addEventListener('click', (event) => { if (!wrapper.contains(event.target)) close(); });
  select.addEventListener('change', sync);
  select.form?.addEventListener('reset', () => setTimeout(sync));
  sync();
}

function showDashboard(session) {
  activeSession?.abort();
  clearTimeout(expiryTimer);
  const controller = new AbortController();
  activeSession = controller;
  loginForm.reset();
  if (Number.isSafeInteger(session.expiresAt)) {
    const watchExpiry = () => {
      if (activeSession !== controller) return;
      const remaining = session.expiresAt - Date.now();
      if (remaining <= 0) showLogin('登录已失效，请重新登录');
      else expiryTimer = setTimeout(watchExpiry, Math.min(remaining, 2147483647));
    };
    watchExpiry();
    if (activeSession !== controller) return;
  }
  loginView.classList.add('hidden');
  dashboardView.classList.remove('hidden');
  document.getElementById('admin-name').textContent = session.username;
  document.getElementById('session-expiry').textContent = `会话至 ${formatTime(session.expiresAt)}`;
  loadCards();
  loadLogs();
  loadStats();
  loadSettings();
  loadAnnouncements();
}

function showLogin(message = '', success = false) {
  activeSession?.abort();
  activeSession = null;
  clearTimeout(expiryTimer);
  dashboardView.classList.add('hidden');
  loginView.classList.remove('hidden');
  loginForm.reset();
  notify(loginError, message, success);
  logoutMessage.hidden = true;
  logoutMessage.textContent = '';
  selected.clear();
  cards = [];
  start = 0;
  total = 0;
  loading = false;
  adjustDirection = 'add';
  priorityAnnouncementId = 0;
  for (const dialog of document.querySelectorAll('dialog')) {
    if (dialog.open) dialog.close('cancel');
  }
  for (const form of document.querySelectorAll('#dashboard-view form, dialog form')) form.reset();
  for (const id of ['card-list', 'log-list', 'announcement-list', 'admin-name', 'session-expiry', 'adjust-description', 'concurrency-description', 'export-description', 'priority-title']) {
    document.getElementById(id).replaceChildren();
  }
  document.getElementById('import-file-name').textContent = '未选择文件';
  for (const id of ['online-cards', 'total-cards', 'activated-cards']) document.getElementById(id).textContent = '0';
  document.getElementById('page-summary').textContent = '共 0 张';
  document.getElementById('page-number').textContent = '第 1 页';
  for (const element of document.querySelectorAll('#dashboard-view .form-message, dialog .form-message')) notify(element, '');
  updateSelection();
}

async function request(url, options = {}, session = activeSession) {
  const publicRequest = url === '/api/login' || url === '/api/session';
  if (!publicRequest && !session) throw new DOMException('会话已结束', 'AbortError');
  const signal = publicRequest ? options.signal : session.signal;
  try {
    const response = await fetch(url, { ...options, signal, redirect: 'error', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
    const result = await response.json();
    signal?.throwIfAborted();
    if (!publicRequest && response.status === 401 && ['ADMIN_SESSION_REQUIRED', 'ADMIN_SESSION_EXPIRED'].includes(result.code)) {
      showLogin(result.msg || '登录已失效，请重新登录');
      throw session.signal.reason;
    }
    if (!response.ok) throw new Error(result.msg || '请求失败');
    return result;
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  }
}

async function loadStats() {
  const session = activeSession;
  if (!session) return;
  try {
    const result = await request('/api/stats');
    session.signal.throwIfAborted();
    document.getElementById('online-cards').textContent = result.onlineCards;
    document.getElementById('total-cards').textContent = result.totalCards;
    document.getElementById('activated-cards').textContent = result.activatedCards;
  } catch (error) {
    notifyError(operationMessage, error);
  }
}

async function loadSettings() {
  const session = activeSession;
  if (!session) return;
  try {
    const result = await request('/api/settings');
    session.signal.throwIfAborted();
    document.getElementById('bind-device').checked = result.bindDevice;
    document.getElementById('encryption-required').checked = result.encryptionRequired;
    document.getElementById('heartbeat-interval').value = result.heartbeatIntervalSeconds;
    document.getElementById('heartbeat-timeout').value = result.heartbeatTimeoutSeconds;
    document.getElementById('required-version').value = result.requiredClientVersion;
    const policy = document.getElementById('version-policy');
    policy.value = result.versionPolicy;
    policy.dispatchEvent(new Event('change'));
  } catch (error) {
    notifyError(document.getElementById('settings-message'), error);
  }
}

function updateSelection() {
  selectionCount.textContent = `已选择 ${selected.size} 张`;
  document.querySelectorAll('[data-batch]').forEach((button) => { button.disabled = selected.size === 0; });
  const selectedOnPage = cards.filter((card) => selected.has(card.serial)).length;
  selectAll.checked = cards.length > 0 && selectedOnPage === cards.length;
  selectAll.indeterminate = selectedOnPage > 0 && selectedOnPage < cards.length;
}

function addCell(row, text, className = '') {
  const cell = document.createElement('td');
  cell.textContent = text;
  if (className) cell.className = className;
  row.append(cell);
  return cell;
}

function renderCards() {
  cardList.replaceChildren();
  if (cards.length === 0) {
    const row = document.createElement('tr');
    addCell(row, loading ? '正在读取卡密…' : '暂无卡密，点击“生成卡密”开始创建。', 'table-empty').colSpan = 8;
    cardList.append(row);
  }
  const statuses = { banned: ['已封禁', 'status-banned'], expired: ['已过期', 'status-used'], unused: ['未激活', 'status-unused'], active: ['使用中', 'status-unused'] };
  for (const card of cards) {
    const row = document.createElement('tr');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selected.has(card.serial);
    checkbox.setAttribute('aria-label', `选择卡密 ${card.serial}`);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) selected.add(card.serial);
      else selected.delete(card.serial);
      updateSelection();
    });
    const checkboxCell = document.createElement('td');
    checkboxCell.append(checkbox);
    row.append(checkboxCell);
    addCell(row, card.serial, 'serial-number');
    addCell(row, formatDuration(card.durationSeconds));
    addCell(row, `${card.activeSessions} / ${card.maxConcurrent}`);
    addCell(row, formatTime(card.createdAt));
    addCell(row, formatTime(card.expiresAt));
    const status = statuses[card.status];
    addCell(row, status[0], `status-badge ${status[1]}`);
    const deviceCell = addCell(row, '', 'device-cell');
    const device = document.createElement('span');
    device.className = card.boundDeviceId ? 'device-id' : 'device-id device-empty';
    device.textContent = card.boundDeviceId || '未绑定';
    if (card.boundDeviceId) device.title = card.boundDeviceId;
    deviceCell.append(device);
    cardList.append(row);
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  document.getElementById('page-summary').textContent = `共 ${total} 张`;
  document.getElementById('page-number').textContent = `第 ${Math.floor(start / pageSize) + 1} / ${pageCount} 页`;
  document.getElementById('previous-page').disabled = start === 0 || loading;
  document.getElementById('next-page').disabled = start + pageSize >= total || loading;
  selectAll.disabled = cards.length === 0 || loading;
  updateSelection();
}

async function loadCards() {
  const session = activeSession;
  if (!session || loading) return;
  loading = true;
  renderCards();
  try {
    const result = await request(`/api/cards?start=${start}&end=${start + pageSize}`);
    session.signal.throwIfAborted();
    total = result.total;
    if (start >= total && start > 0) {
      start = Math.floor((total - 1) / pageSize) * pageSize;
      loading = false;
      await loadCards();
      return;
    }
    cards = result.cards;
  } catch (error) {
    notifyError(operationMessage, error);
  } finally {
    if (activeSession === session) {
      loading = false;
      renderCards();
    }
  }
}

async function loadLogs() {
  const session = activeSession;
  if (!session) return;
  try {
    const result = await request('/api/logs?limit=100');
    session.signal.throwIfAborted();
    const list = document.getElementById('log-list');
    list.replaceChildren();
    if (result.logs.length === 0) {
      const row = document.createElement('tr');
      addCell(row, '暂无操作日志', 'table-empty').colSpan = 6;
      list.append(row);
    }
    for (const log of result.logs) {
      const row = document.createElement('tr');
      addCell(row, formatTime(log.createdAt));
      addCell(row, log.actor);
      addCell(row, log.action);
      addCell(row, log.target || '-', 'serial-number');
      addCell(row, log.detail || '-', 'log-detail');
      addCell(row, log.ip || '-');
      list.append(row);
    }
  } catch (error) {
    notifyError(operationMessage, error);
  }
}

function addButton(container, text, className, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.addEventListener('click', onClick);
  container.append(button);
}

async function announcementAction(url, body) {
  const session = activeSession;
  try {
    const result = await request(url, { method: 'POST', body: JSON.stringify(body) });
    if (activeSession !== session) return;
    notify(announcementMessage, result.msg, true);
    await Promise.all([loadAnnouncements(), loadLogs()]);
  } catch (error) { notifyError(announcementMessage, error); }
}

async function loadAnnouncements() {
  const session = activeSession;
  if (!session) return;
  try {
    const result = await request('/api/announcements');
    session.signal.throwIfAborted();
    const list = document.getElementById('announcement-list');
    list.replaceChildren();
    if (result.announcements.length === 0) {
      const row = document.createElement('tr');
      addCell(row, '暂无公告，点击“新增公告”开始发布。', 'table-empty').colSpan = 6;
      list.append(row);
    }
    for (const item of result.announcements) {
      const row = document.createElement('tr');
      addCell(row, item.priority);
      const title = document.createElement('span');
      title.className = 'cell-ellipsis announcement-title';
      title.textContent = item.title;
      title.title = item.title;
      addCell(row, '').append(title);
      const content = document.createElement('span');
      content.className = 'cell-ellipsis';
      content.textContent = item.content;
      content.title = item.content;
      addCell(row, '').append(content);
      addCell(row, item.enabled ? '下发中' : '已停止', `status-badge ${item.enabled ? 'status-unused' : 'status-used'}`);
      addCell(row, formatTime(item.updatedAt));
      const actions = document.createElement('div');
      actions.className = 'row-actions';
      addButton(actions, '优先级', 'secondary-button', () => {
        priorityAnnouncementId = item.id;
        document.getElementById('priority-title').textContent = item.title;
        document.getElementById('priority-value').value = item.priority;
        notify(document.getElementById('priority-message'), '');
        priorityDialog.showModal();
      });
      addButton(actions, item.enabled ? '停止下发' : '恢复下发', item.enabled ? 'warning-button' : 'secondary-button', () => announcementAction('/api/announcements/status', { id: item.id, enabled: !item.enabled }));
      addButton(actions, '删除', 'danger-button', async () => {
        if (await confirmAction('确认删除') && activeSession === session) await announcementAction('/api/announcements/delete', { id: item.id });
      });
      addCell(row, '').append(actions);
      list.append(row);
    }
  } catch (error) {
    notifyError(announcementMessage, error);
  }
}

async function refreshData() {
  await Promise.all([loadCards(), loadLogs(), loadStats()]);
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (loginButton.disabled) return;
  startupSessionCheck.abort();
  notify(loginError, '');
  loginButton.disabled = true;
  loginButton.textContent = '正在登录…';
  try {
    const session = await request('/api/login', { method: 'POST', body: JSON.stringify({ username: loginUsername.value, password: loginPassword.value }) });
    start = 0;
    showDashboard(session);
  } catch (error) {
    notify(loginError, error.message);
  } finally {
    loginButton.disabled = false;
    loginButton.textContent = '登录管理后台';
  }
});

logoutButton.addEventListener('click', async () => {
  const session = activeSession;
  if (!session || logoutButton.disabled) return;
  logoutButton.disabled = true;
  logoutMessage.hidden = true;
  try {
    await request('/api/logout', { method: 'POST', body: '{}' });
    if (activeSession === session) showLogin();
  } catch {
    if (activeSession === session) {
      logoutMessage.hidden = false;
      notify(logoutMessage, '无法确认已退出，请重试');
    }
  } finally { logoutButton.disabled = false; }
});
document.querySelectorAll('.nav-item').forEach((item) => item.addEventListener('click', () => {
  document.querySelectorAll('.nav-item').forEach((navItem) => navItem.classList.remove('active'));
  item.classList.add('active');
  document.getElementById('page-title').textContent = item.textContent.replace(/^\d+/, '');
}));
document.getElementById('generate-button').addEventListener('click', () => {
  document.getElementById('generate-form').reset();
  generateDialog.showModal();
});
document.getElementById('generate-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  const submit = event.target.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await request('/api/cards/generate', { method: 'POST', body: JSON.stringify({ count: document.getElementById('generate-count').value, duration: document.getElementById('generate-duration').value, durationUnit: document.getElementById('generate-unit').value, maxConcurrent: document.getElementById('generate-concurrent').value }) });
    if (activeSession !== session) return;
    generateDialog.close();
    selected.clear();
    start = 0;
    notify(operationMessage, result.msg, true);
    await refreshData();
  } catch (error) { notifyError(operationMessage, error); } finally { submit.disabled = false; }
});

function openAdjust(direction) {
  adjustDirection = direction;
  document.getElementById('adjust-title').textContent = direction === 'add' ? '加时' : '减时';
  document.getElementById('adjust-description').textContent = `为选中的 ${selected.size} 张卡密${direction === 'add' ? '增加' : '减少'}时长。未激活卡修改总时长，已激活卡同步调整过期时间。`;
  document.getElementById('adjust-form').reset();
  adjustDialog.showModal();
}
document.getElementById('add-time-button').addEventListener('click', () => openAdjust('add'));
document.getElementById('subtract-time-button').addEventListener('click', () => openAdjust('subtract'));
document.getElementById('adjust-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  const submit = event.target.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await request('/api/cards/adjust', { method: 'POST', body: JSON.stringify({ serials: [...selected], amount: document.getElementById('adjust-amount').value, durationUnit: document.getElementById('adjust-unit').value, direction: adjustDirection }) });
    if (activeSession !== session) return;
    adjustDialog.close();
    selected.clear();
    notify(operationMessage, result.msg, true);
    await refreshData();
  } catch (error) { notifyError(operationMessage, error); } finally { submit.disabled = false; }
});
document.getElementById('concurrency-button').addEventListener('click', () => {
  document.getElementById('concurrency-description').textContent = `为选中的 ${selected.size} 张卡密设定同时在线数量。`;
  document.getElementById('concurrency-form').reset();
  notify(document.getElementById('concurrency-message'), '');
  concurrencyDialog.showModal();
});
document.getElementById('concurrency-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  const submit = event.target.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await request('/api/cards/concurrency', { method: 'POST', body: JSON.stringify({ serials: [...selected], maxConcurrent: document.getElementById('concurrency-value').value }) });
    if (activeSession !== session) return;
    concurrencyDialog.close();
    selected.clear();
    notify(operationMessage, result.msg, true);
    await refreshData();
  } catch (error) { notifyError(document.getElementById('concurrency-message'), error); } finally { submit.disabled = false; }
});
document.getElementById('announcement-create-button').addEventListener('click', () => {
  document.getElementById('announcement-form').reset();
  notify(document.getElementById('announcement-form-message'), '');
  announcementDialog.showModal();
});
document.getElementById('announcement-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  const submit = event.target.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await request('/api/announcements/create', { method: 'POST', body: JSON.stringify({
      title: document.getElementById('announcement-title').value,
      content: document.getElementById('announcement-content').value,
      priority: document.getElementById('announcement-priority').value,
    }) });
    if (activeSession !== session) return;
    announcementDialog.close();
    notify(announcementMessage, result.msg, true);
    await Promise.all([loadAnnouncements(), loadLogs()]);
  } catch (error) { notifyError(document.getElementById('announcement-form-message'), error); } finally { submit.disabled = false; }
});
document.getElementById('priority-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  const submit = event.target.querySelector('[type="submit"]');
  submit.disabled = true;
  try {
    const result = await request('/api/announcements/priority', { method: 'POST', body: JSON.stringify({ id: priorityAnnouncementId, priority: document.getElementById('priority-value').value }) });
    if (activeSession !== session) return;
    priorityDialog.close();
    notify(announcementMessage, result.msg, true);
    await Promise.all([loadAnnouncements(), loadLogs()]);
  } catch (error) { notifyError(document.getElementById('priority-message'), error); } finally { submit.disabled = false; }
});
document.getElementById('version-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  const button = document.getElementById('save-version-button');
  const message = document.getElementById('version-message');
  button.disabled = true;
  try {
    const result = await request('/api/settings/version', { method: 'POST', body: JSON.stringify({
      requiredClientVersion: document.getElementById('required-version').value,
      versionPolicy: document.getElementById('version-policy').value,
    }) });
    if (activeSession !== session) return;
    notify(message, result.msg, true);
    await Promise.all([loadSettings(), loadLogs()]);
  } catch (error) { notifyError(message, error); } finally { button.disabled = false; }
});
document.getElementById('settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  const button = document.getElementById('save-settings-button');
  const message = document.getElementById('settings-message');
  button.disabled = true;
  try {
    const result = await request('/api/settings', { method: 'POST', body: JSON.stringify({
      bindDevice: document.getElementById('bind-device').checked,
      encryptionRequired: document.getElementById('encryption-required').checked,
      heartbeatIntervalSeconds: document.getElementById('heartbeat-interval').value,
      heartbeatTimeoutSeconds: document.getElementById('heartbeat-timeout').value,
    }) });
    if (activeSession !== session) return;
    notify(message, result.msg, true);
    await Promise.all([loadSettings(), loadStats(), loadLogs()]);
  } catch (error) { notifyError(message, error); } finally { button.disabled = false; }
});

document.getElementById('account-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  if (!session) return;
  const message = document.getElementById('account-message');
  const newPassword = document.getElementById('new-password').value;
  if (newPassword !== document.getElementById('confirm-password').value) {
    notify(message, '两次输入的新密码不一致');
    return;
  }
  const button = document.getElementById('save-account-button');
  button.disabled = true;
  try {
    const result = await request('/api/admin/account', { method: 'POST', body: JSON.stringify({
      newUsername: document.getElementById('new-username').value,
      currentPassword: document.getElementById('current-password').value,
      newPassword,
    }) });
    session.signal.throwIfAborted();
    showLogin(result.msg, true);
  } catch (error) { notifyError(message, error); } finally { button.disabled = false; }
});

async function batchOperation(action, title) {
  const session = activeSession;
  if (!session || selected.size === 0 || !(await confirmAction(title)) || activeSession !== session) return;
  try {
    const result = await request(`/api/cards/${action}`, { method: 'POST', body: JSON.stringify({ serials: [...selected] }) });
    if (activeSession !== session) return;
    selected.clear();
    notify(operationMessage, result.msg, true);
    await refreshData();
  } catch (error) { notifyError(operationMessage, error); }
}
document.getElementById('ban-button').addEventListener('click', () => batchOperation('ban', '确认封禁'));
document.getElementById('delete-button').addEventListener('click', () => batchOperation('delete', '确认删除'));
document.getElementById('unbind-button').addEventListener('click', () => batchOperation('unbind', '确认解绑'));
document.getElementById('refresh-button').addEventListener('click', () => Promise.all([loadCards(), loadStats()]));
document.getElementById('refresh-logs-button').addEventListener('click', loadLogs);

document.getElementById('export-button').addEventListener('click', () => {
  const serialList = [...selected];
  document.getElementById('export-description').textContent = `已选择 ${serialList.length} 张卡密，每行一个。`;
  document.getElementById('export-text').value = serialList.join('\n');
  notify(document.getElementById('export-message'), '');
  exportDialog.showModal();
});
document.getElementById('export-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  if (!session) return;
  const text = document.getElementById('export-text');
  const message = document.getElementById('export-message');
  const count = text.value ? text.value.split('\n').length : 0;
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text.value);
    } else {
      text.select();
      if (!document.execCommand('copy')) throw new Error();
    }
    if (activeSession === session) notify(message, `已复制 ${count} 张卡密`, true);
  } catch {
    if (activeSession !== session) return;
    text.select();
    notify(message, '复制失败，请按 Ctrl+C 手动复制已选中的内容');
  }
});

const importFile = document.getElementById('import-file');
document.getElementById('import-button').addEventListener('click', () => {
  document.getElementById('import-form').reset();
  document.getElementById('import-file-name').textContent = '未选择文件';
  notify(document.getElementById('import-message'), '');
  importDialog.showModal();
});
importFile.addEventListener('change', () => {
  document.getElementById('import-file-name').textContent = importFile.files[0]?.name || '未选择文件';
  notify(document.getElementById('import-message'), '');
});

function importBatches(lines, extra) {
  const encoder = new TextEncoder();
  const overhead = encoder.encode(JSON.stringify({ ...extra, serials: [] })).length;
  const batches = [];
  let batch = [];
  let size = overhead;
  for (const line of lines) {
    const lineSize = encoder.encode(JSON.stringify(line)).length + 1;
    if (batch.length > 0 && size + lineSize > importBatchBytes) {
      batches.push(batch);
      batch = [];
      size = overhead;
    }
    batch.push(line);
    size += lineSize;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

document.getElementById('import-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const session = activeSession;
  if (!session) return;
  const message = document.getElementById('import-message');
  const file = importFile.files[0];
  if (!file) {
    notify(message, '请选择要导入的 txt 文件');
    return;
  }
  const extra = { duration: document.getElementById('import-duration').value, durationUnit: document.getElementById('import-unit').value, maxConcurrent: document.getElementById('import-concurrent').value };
  const submit = document.getElementById('import-submit');
  submit.disabled = true;
  const totals = { imported: 0, existing: 0, tooLong: 0 };
  try {
    const content = await file.text();
    session.signal.throwIfAborted();
    const lines = [...new Set(content.replace(/^\uFEFF/, '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean))];
    if (lines.length === 0) {
      notify(message, '文件中没有可导入的卡密');
      return;
    }
    const batches = importBatches(lines, extra);
    for (const [index, serials] of batches.entries()) {
      if (batches.length > 1) notify(message, `正在导入第 ${index + 1} / ${batches.length} 批…`, true);
      const result = await request('/api/cards/import', { method: 'POST', body: JSON.stringify({ ...extra, serials }) }, session);
      session.signal.throwIfAborted();
      totals.imported += result.imported;
      totals.existing += result.existing;
      totals.tooLong += result.tooLong;
    }
    const parts = [`成功导入 ${totals.imported} 张卡密`];
    if (totals.existing) parts.push(`${totals.existing} 张已存在已跳过`);
    if (totals.tooLong) parts.push(`${totals.tooLong} 行超过 64 个字符已跳过`);
    importDialog.close();
    selected.clear();
    start = 0;
    notify(operationMessage, parts.join('，'), true);
    await refreshData();
  } catch (error) {
    if (activeSession !== session || error.name === 'AbortError') return;
    notify(message, totals.imported ? `已导入 ${totals.imported} 张后出错：${error.message}` : error.message);
    if (totals.imported) refreshData();
  } finally {
    submit.disabled = false;
  }
});

selectAll.addEventListener('change', () => {
  for (const card of cards) {
    if (selectAll.checked) selected.add(card.serial);
    else selected.delete(card.serial);
  }
  for (const checkbox of cardList.querySelectorAll('input[type="checkbox"]')) checkbox.checked = selectAll.checked;
  updateSelection();
});
document.getElementById('previous-page').addEventListener('click', () => { start = Math.max(0, start - pageSize); loadCards(); });
document.getElementById('next-page').addEventListener('click', () => { start += pageSize; loadCards(); });
document.querySelectorAll('select').forEach(enhanceSelect);
document.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => button.closest('dialog').close()));
setInterval(loadStats, 15000);
loginUsername.disabled = false;
loginPassword.disabled = false;
loginButton.disabled = false;
document.getElementById('login-readiness').hidden = true;
request('/api/session', { signal: startupSessionCheck.signal }).then((session) => {
  if (!startupSessionCheck.signal.aborted) showDashboard(session);
}, () => {
  // The login form is already visible when there is no active session.
});
