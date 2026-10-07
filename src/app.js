import { loadState, saveState } from './state.js';
import { TAGS, trace } from './tags.js';
import * as V21 from './v21.js?v=20261007-2';

let state = loadState();
let currentPage = 'today';
let selectedProjectId = null;
let notificationOpen = false;
let planningTaskId = null;
let taskModalOpen = false;
let taskModalProjectId = null;
let projectModalOpen = false;
let projectModalParentId = null;
let projectDetailTab = 'overview';
let documentModalProjectId = null;
let projectTreeMoveBusy = false;
let draggedProjectId = null;
const PROJECT_TREE_COLLAPSE_KEY = 'speedarti-pilotage-project-tree-collapsed';
let collapsedProjectIds = new Set((() => {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROJECT_TREE_COLLAPSE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
})());
let projectFilter = 'all';
let planningFilterProject = 'all';
let planningFilterOwner = 'all';
let planningFilterPriority = 'all';
let activityFilter = 'all';
let notificationFilter = 'all';
let aiSimulationOpen = false;
let taskEditId = null;
let projectEditId = null;
let calendarView = 'today';
let documentSearch = '';
let documentProjectFilter = 'all';
let documentModalOpen = false;
let mobilePlanningBucket = 'this_month';
let approvalRequestId = null;
let quickActionOpen = false;
let activityProjectFilter = 'all';
let activitySearch = '';
let archiveModalProjectId = null;
let deferTaskId = null;
let teamWorkloadOpen = false;
let dailyReportModalOpen = false;
let dailyReportEditId = null;
let dailyReportDate = currentDateKey();
let dailyReportPersonFilter = 'all';
let dailyReportPresetPersonId = null;

// PILOT-GOOGLE-004 / 009 — sélecteur Drive et association Agenda.
let googleDrivePickerOpen = false;
let googleDrivePickerBusy = false;
let googleDriveRoots = [];
let googleDriveFolders = [];
let googleDriveCurrent = null;
let googleDriveStack = [];
let googleBusy = '';
let googleDriveProgressText = '';
let googleCalendarLinkEventId = null;

// PILOT-AI-018 / PILOT-UI-043 — assistant ChatGPT Pilotage réel.
let assistantMessages = [];
let assistantLoading = false;
let assistantHistoryLoaded = false;
let assistantHistoryLoading = false;
let assistantNeedsRefresh = false;
let assistantStatus = { configured:null, model:'gpt-5.6', error:'' };

state.changeRequests = Array.isArray(state.changeRequests) ? state.changeRequests : [];
state.aiRequests = Array.isArray(state.aiRequests) ? state.aiRequests : [];
state.aiEvents = Array.isArray(state.aiEvents) ? state.aiEvents : [];
state.dailyReports = Array.isArray(state.dailyReports) ? state.dailyReports : [];
state.integrations = Array.isArray(state.integrations) ? state.integrations : [];
state.driveItems = Array.isArray(state.driveItems) ? state.driveItems : [];
state.calendarSources = Array.isArray(state.calendarSources) ? state.calendarSources : [];
state.calendarEvents = Array.isArray(state.calendarEvents) ? state.calendarEvents : [];
// PILOT-UI-040 — toutes les dates opérationnelles utilisent désormais l’horloge réelle de l’appareil.

const app = document.querySelector('#app');

const navItems = [
  ['today', 'Aujourd’hui', '⌂'],
  ['assistant', 'ChatGPT', '✦'],
  ['planning', 'Planification', '↔'],
  ['projects', 'Projets', '▦'],
  ['ideas', 'Idées', '💡'],
  ['calendar', 'Agenda', '□'],
  ['documents', 'Documents', '▤'],
  ['activity', 'Activité', '≋'],
  ['reports', 'Comptes rendus', '☷']
];

const statusLabels = {
  todo: 'À faire', in_progress: 'En cours', to_validate: 'À valider', to_test: 'À tester',
  completed: 'Terminé', blocked: 'Bloqué', paused: 'En pause'
};
const priorityLabels = { urgent: 'Urgente', high: 'Haute', medium: 'Moyenne', low: 'Faible' };
const planningLabels = {
  backlog: 'À organiser', this_week: 'Cette semaine', this_month: 'Ce mois', next_3_months: '1 à 3 mois', later: 'Plus tard'
};

const DEFAULT_AI_AGENTS = Object.freeze([
  { id:'chatgpt_thibault', name:'ChatGPT', provider:'OpenAI', personId:'u-thibault', category:'Généraliste', active:true },
  { id:'claude_anne_sophie', name:'Claude', provider:'Anthropic', personId:'u-anne', category:'Développement', active:true },
  { id:'chatgpt_anne_sophie', name:'ChatGPT', provider:'OpenAI', personId:'u-anne', category:'Généraliste', active:true },
  { id:'chatgpt_guillaume', name:'ChatGPT', provider:'OpenAI', personId:'u-guillaume', category:'Généraliste', active:true },
  { id:'marketing_guillaume_future', name:'IA marketing', provider:'À connecter', personId:'u-guillaume', category:'Marketing', active:false }
]);

function ensureAiAgents() {
  const existing = Array.isArray(state.aiAgents) ? state.aiAgents : [];
  const byId = new Map(existing.map(agent => [agent.id, agent]));
  let changed = !Array.isArray(state.aiAgents);
  DEFAULT_AI_AGENTS.forEach(defaultAgent => {
    if (!byId.has(defaultAgent.id)) {
      existing.push({ ...defaultAgent });
      changed = true;
    }
  });
  state.aiAgents = existing;
  if (changed) trace(TAGS.AI_AGENT_REGISTRY, 'Registre multi-IA initialisé / complété', { count:state.aiAgents.length });
  return state.aiAgents;
}

function aiAgent(source) {
  return ensureAiAgents().find(agent => agent.id === source) || null;
}

function activeAiAgents() {
  return ensureAiAgents().filter(agent => agent.active !== false);
}

function aiAgentsForPerson(personId, includeInactive = false) {
  return ensureAiAgents().filter(agent => agent.personId === personId && (includeInactive || agent.active !== false));
}

function aiAgentLabel(source) {
  const agent = aiAgent(source);
  if (!agent) return source || 'IA';
  return `${agent.name} · ${teamName(agent.personId)}`;
}

function aiSourceActor(source) {
  const agent = aiAgent(source);
  return agent ? `${teamName(agent.personId)} via ${agent.name}` : 'IA';
}

function aiSourceType(source) {
  const agent = aiAgent(source);
  const value = `${agent?.provider || ''} ${agent?.name || source || ''}`.toLowerCase();
  if (value.includes('anthropic') || value.includes('claude')) return 'claude';
  if (value.includes('openai') || value.includes('chatgpt')) return 'chatgpt';
  return 'other_ai';
}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}

function teamName(id) { return state.team.find(x => x.id === id)?.name || 'Non attribué'; }
function project(id) { return state.projects.find(x => x.id === id); }
function task(id) { return state.tasks.find(x => x.id === id); }
function integration(provider, ownerId = state.currentUser.id) {
  return (state.integrations || []).find(x => x.provider === provider && x.ownerId === ownerId) || null;
}
function driveDocumentRefs() {
  return (state.driveItems || [])
    .filter(item => !item.isFolder)
    .filter(item => !/(^|\/)node_modules\//i.test(item.relativePath || ''))
    .map(item => ({
    id:`drive-${item.id}`,
    driveItemId:item.id,
    projectId:item.projectId || null,
    name:item.name,
    type:item.mimeType?.includes('spreadsheet') ? 'Tableur' : item.mimeType === 'application/pdf' ? 'PDF' : 'Document',
    source:'Google Drive · synchronisé',
    url:item.url || '',
    externalFileId:item.externalFileId,
    relativePath:item.relativePath || item.name,
    ownerId:item.ownerId,
    lastSyncedAt:item.lastSyncedAt || null
  }));
}
function allDocumentRefs() { return [...(state.documents || []), ...driveDocumentRefs()]; }
function formatSyncDate(value) {
  if (!value) return 'Jamais synchronisé';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Synchronisation inconnue' : `Synchro ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})}`;
}

function formatTime(iso) { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
function formatDate(iso) { return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }); }
function localDateKey(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function currentDateKey() { return localDateKey(new Date()); }
function dateKey(value) {
  if (!value) return '';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return localDateKey(new Date(value));
}
function dateFromKey(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return new Date(value);
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
}
function dateAtHourIso(value, hour = 9) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hour, 0, 0, 0).toISOString();
}
function addDaysKey(days, base = new Date()) {
  const d = base instanceof Date ? new Date(base) : dateFromKey(base);
  d.setDate(d.getDate() + days);
  return localDateKey(d);
}
function nextWeekMondayKey(base = new Date()) {
  const d = base instanceof Date ? new Date(base) : dateFromKey(base);
  const day = d.getDay();
  const daysUntilNextMonday = ((8 - day) % 7) || 7;
  d.setDate(d.getDate() + daysUntilNextMonday);
  return localDateKey(d);
}
function startOfWeek(base = new Date()) {
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return d;
}
function endOfWeek(base = new Date()) {
  const d = startOfWeek(base);
  d.setDate(d.getDate() + 6);
  d.setHours(23, 59, 59, 999);
  return d;
}
function capitalizeFirst(value = '') { return value ? value.charAt(0).toUpperCase() + value.slice(1) : value; }
function longDateLabel(value = currentDateKey()) {
  return capitalizeFirst(dateFromKey(value).toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long' }));
}
function weekLabel(base = new Date()) {
  const start = startOfWeek(base);
  const end = endOfWeek(base);
  const startLabel = start.toLocaleDateString('fr-FR', { day:'numeric', month: start.getMonth() === end.getMonth() ? undefined : 'long' });
  const endLabel = end.toLocaleDateString('fr-FR', { day:'numeric', month:'long' });
  return `Semaine du ${startLabel} au ${endLabel}`;
}
function monthLabel(base = new Date()) {
  return capitalizeFirst(base.toLocaleDateString('fr-FR', { month:'long', year:'numeric' }));
}
function toDueIso(value) { return value ? dateAtHourIso(value, 18) : null; }
function personInitials(name = '') { return name.split(/\s|-/).filter(Boolean).slice(0,2).map(x => x[0]).join('').toUpperCase(); }
function isAdmin() { return state.currentUser?.role === 'admin'; }
function adminMemberId() {
  return state.team.find(m => m.accessRole === 'admin')?.id
    || state.team.find(m => m.id === 'u-thibault')?.id
    || null;
}
function memberIdFromIdentity(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return null;
  return state.team.find(m =>
    String(m.id || '').toLowerCase() === raw
    || String(m.name || '').trim().toLowerCase() === raw
  )?.id || null;
}
function memberLabel(value) {
  const id = memberIdFromIdentity(value);
  return id ? teamName(id) : String(value || 'Utilisateur');
}
function canManageProject(p) { return Boolean(p) && (isAdmin() || p.owner === state.currentUser.id); }
function canEditReport(report) { return Boolean(report) && (isAdmin() || report.personId === state.currentUser.id); }
function canCreateReportFor(memberId) { return isAdmin() || memberId === state.currentUser.id; }
function selectedProfileIds() { return V21.getSelectedProfileIds(state); }
function selectedMembers() { return V21.getSelectedMembers(state); }
function profileSelected(memberId) { return selectedProfileIds().has(memberId); }
function canManageNotification(notification) { return isAdmin() || notification?.recipientId === state.currentUser.id; }
function visibleReportMembers() {
  return selectedMembers();
}
function teamPicker(targetId, selectedId) {
  const selected = selectedId || state.currentUser.id;
  return `<div class="team-picker" data-picker="${targetId}"><input type="hidden" id="${targetId}" value="${selected}" />${state.team.map(m => `<button type="button" class="team-choice ${m.id === selected ? 'active' : ''}" data-team-target="${targetId}" data-team-value="${m.id}"><span>${personInitials(m.name)}</span><b>${esc(m.name)}</b><small>${esc(m.role)}</small></button>`).join('')}</div>`;
}

// PILOT-PROJ-013 / PILOT-UI-041 — participants projet multiples, administrés côté Direction.
function projectMemberIds(p) {
  return [...new Set([
    ...(Array.isArray(p?.members) ? p.members : []),
    p?.owner
  ].filter(Boolean))];
}

function projectMemberPicker(selectedIds = [], ownerId = null) {
  const selected = new Set([...selectedIds, ownerId].filter(Boolean));
  return `<div class="team-picker" data-project-members>${state.team.map(m => `<button type="button" class="team-choice ${selected.has(m.id) ? 'active' : ''}" data-project-member="${m.id}" aria-pressed="${selected.has(m.id) ? 'true' : 'false'}"><span>${personInitials(m.name)}</span><b>${esc(m.name)}</b><small>${esc(m.role)} · ${m.authUserId ? 'compte actif' : 'accès à créer'}</small></button>`).join('')}</div>`;
}

function selectedProjectMembers(ownerId, fallbackMembers = []) {
  if (!isAdmin()) {
    return [...new Set([...(fallbackMembers || []), state.currentUser.id, ownerId].filter(Boolean))];
  }
  const selected = [...document.querySelectorAll('[data-project-member].active')]
    .map(el => el.dataset.projectMember)
    .filter(Boolean);
  return [...new Set([...selected, ownerId].filter(Boolean))];
}

function taskAssignableMemberIds(projectId) {
  if (projectId) return projectMemberIds(project(projectId));
  return isAdmin() ? state.team.map(m => m.id) : [state.currentUser.id];
}

function taskAssigneeAllowed(projectId, memberId) {
  return taskAssignableMemberIds(projectId).includes(memberId);
}

function refreshTaskOwnerAvailability(projectId) {
  const allowed = new Set(taskAssignableMemberIds(projectId));
  const hidden = document.querySelector('#taskOwner');
  let selected = hidden?.value || state.currentUser.id;
  if (!allowed.has(selected)) {
    selected = allowed.has(state.currentUser.id) ? state.currentUser.id : [...allowed][0] || state.currentUser.id;
    if (hidden) hidden.value = selected;
  }
  document.querySelectorAll('[data-team-target="taskOwner"]').forEach(btn => {
    const enabled = allowed.has(btn.dataset.teamValue);
    btn.disabled = !enabled;
    btn.classList.toggle('active', enabled && btn.dataset.teamValue === selected);
    btn.setAttribute('aria-disabled', enabled ? 'false' : 'true');
    btn.title = enabled ? '' : 'Cette personne ne participe pas à ce projet';
  });
}

function ensureRuntimeState() {
  if (!Array.isArray(state.changeRequests)) state.changeRequests = [];
  if (!Array.isArray(state.notifications)) state.notifications = [];
  if (!Array.isArray(state.aiRequests)) state.aiRequests = [];
  if (!Array.isArray(state.dailyReports)) state.dailyReports = [];
  ensureAiAgents();
  state.dailyReports.forEach(report => {
    if (report.source === 'ai' && !report.sourceAgent) report.sourceAgent = aiAgentsForPerson(report.personId)[0]?.id || null;
  });
  state.projects.forEach((p, index) => {
    if (typeof p.archived !== 'boolean') p.archived = false;
    p.members = projectMemberIds(p);
    if (!('parentProjectId' in p)) p.parentProjectId = null;
    if (!Number.isFinite(Number(p.treeSortOrder))) p.treeSortOrder = (index + 1) * 1000;
    if (!Number.isFinite(Number(p.manualProgress))) p.manualProgress = Number(p.progress || 0);
  });
  state.notifications = state.notifications.filter(n => !(n.type === 'approval_required' && !n.changeRequestId && !n.projectId));
  state.notifications.forEach(n => {
    if (typeof n.read !== 'boolean') n.read = Boolean(n.readAt);
    if (typeof n.resolved !== 'boolean') n.resolved = Boolean(n.resolvedAt);
  });
  V21.recalculateAutomaticProgress(state);
}

function pendingCompletionRequest(projectId) {
  return state.changeRequests.find(r => r.projectId === projectId && r.type === 'project_complete' && r.status === 'pending');
}

function notificationRecipientId(notification) {
  return notification?.recipientId || state.currentUser.id;
}

function isMyNotification(notification) {
  return notificationRecipientId(notification) === state.currentUser.id;
}

function upsertNotification({ recipientId=null, severity='info', type='task_update', title, message, actionType='read', taskId=null, projectId=null, changeRequestId=null, groupKey=null, internalTag=TAGS.NOTIF_CREATE, increment=false, reactivate=false }) {
  ensureRuntimeState();
  const targetRecipientId = recipientId || state.currentUser.id;
  const existing = groupKey ? state.notifications.find(n =>
    !n.resolved
    && n.groupKey === groupKey
    && notificationRecipientId(n) === targetRecipientId
  ) : null;
  if (existing) {
    existing.title = title;
    existing.message = message;
    existing.severity = severity;
    existing.type = type;
    existing.actionType = actionType;
    existing.taskId = taskId || existing.taskId || null;
    existing.projectId = projectId || existing.projectId || null;
    existing.changeRequestId = changeRequestId || existing.changeRequestId || null;
    existing.recipientId = recipientId || existing.recipientId || null;
    existing.updatedAt = new Date().toISOString();
    if (increment || reactivate) { existing.read = false; existing.readAt = null; }
    if (increment) existing.count = Number(existing.count || 1) + 1;
    trace(TAGS.NOTIF_DEDUP, 'Notification regroupée', { groupKey, count: existing.count || 1 });
    return existing;
  }
  const notification = {
    id: crypto.randomUUID(), recipientId, severity, type, title, message, actionType,
    taskId, projectId, changeRequestId, groupKey, internalTag,
    count: 1, read: false, resolved: false, readAt: null, resolvedAt: null,
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString()
  };
  state.notifications.unshift(notification);
  trace(TAGS.NOTIF_CREATE, 'Notification créée', { type, severity, groupKey, notificationId: notification.id });
  return notification;
}

function refreshSmartNotifications() {
  ensureRuntimeState();
  let changed = false;
  state.notifications.filter(n => isMyNotification(n) && !n.resolved && (n.type === 'deadline' || n.type === 'blocker')).forEach(n => {
    if (n.type === 'deadline') {
      const t = task(n.taskId);
      const stillActive = t && t.status !== 'completed' && t.dueAt && new Date(t.dueAt) < new Date();
      if (!stillActive) { n.resolved = true; n.resolvedAt = new Date().toISOString(); changed = true; trace(TAGS.NOTIF_RESOLVE, 'Alerte échéance résolue automatiquement', { notificationId:n.id, taskId:n.taskId }); }
    }
    if (n.type === 'blocker') {
      const p = project(n.projectId);
      const stillActive = p && p.status !== 'completed' && Boolean(p.blocker);
      if (!stillActive) { n.resolved = true; n.resolvedAt = new Date().toISOString(); changed = true; trace(TAGS.NOTIF_RESOLVE, 'Alerte blocage résolue automatiquement', { notificationId:n.id, projectId:n.projectId }); }
    }
  });
  state.tasks.filter(t => t.assignedTo === state.currentUser.id && t.status !== 'completed' && t.dueAt && new Date(t.dueAt) < new Date() && (!t.projectId || !project(t.projectId)?.archived)).forEach(t => {
    const key = `deadline:${t.id}`;
    const before = state.notifications.find(n => isMyNotification(n) && !n.resolved && n.groupKey === key);
    upsertNotification({ severity:'warning', type:'deadline', title:'Échéance dépassée', message:`${t.title} · échéance ${formatDate(t.dueAt)}`, actionType:'edit_task', taskId:t.id, projectId:t.projectId, groupKey:key, internalTag:TAGS.NOTIF_DEADLINE });
    if (!before) { changed = true; trace(TAGS.SMART_ALERTS, 'Alerte échéance générée', { taskId:t.id }); }
  });
  state.projects.filter(p => p.owner === state.currentUser.id && p.blocker && p.status !== 'completed' && !p.archived).forEach(p => {
    const key = `blocker:${p.id}`;
    const before = state.notifications.find(n => isMyNotification(n) && !n.resolved && n.groupKey === key);
    upsertNotification({ severity:'warning', type:'blocker', title:'Blocage projet', message:`${p.name} · ${p.blocker}`, actionType:'open_project', projectId:p.id, groupKey:key, internalTag:TAGS.NOTIF_BLOCKER });
    if (!before) { changed = true; trace(TAGS.SMART_ALERTS, 'Alerte blocage générée', { projectId:p.id }); }
  });
  if (changed) saveState(state);
}

function queueProjectCompletion(projectId, { sourceType='manual', requestedBy=null, note='' } = {}) {
  requestedBy = requestedBy || state.currentUser?.name || teamName(state.currentUser?.id) || 'Utilisateur';
  ensureRuntimeState();
  const p = project(projectId);
  if (!p || p.status === 'completed') return null;
  const already = pendingCompletionRequest(projectId);
  if (already) return already;
  const request = {
    id: crypto.randomUUID(), type:'project_complete', projectId, status:'pending',
    requestedBy, requestedByMemberId:state.currentUser.id, sourceType, note, requestedAt:new Date().toISOString(),
    proposed:{ status:'completed', progress:100 }
  };
  state.changeRequests.unshift(request);
  upsertNotification({
    recipientId:adminMemberId() || state.currentUser.id,
    severity:'action', type:'approval_required', title:'Validation projet demandée',
    message:`${p.name} · passage en Terminé · demandé par ${memberLabel(state.currentUser.id)}`, actionType:'approval', projectId,
    changeRequestId:request.id, groupKey:`approval:${request.id}`, internalTag:TAGS.NOTIF_APPROVAL
  });
  addActivity({ actor: requestedBy, projectId, text:`Passage en Terminé proposé${note ? ` · ${note}` : ''}`, internalTag:TAGS.PROJECT_COMPLETE_REQUEST });
  persist(TAGS.PROJECT_COMPLETE_REQUEST, 'Demande de clôture projet créée', { projectId, requestId:request.id, sourceType });
  return request;
}

function persist(tag, message, details = {}) {
  saveState(state);
  trace(tag, message, details);
}

function addActivity({ actor = null, projectId = null, taskId = null, text, internalTag }) {
  actor = actor || state.currentUser?.name || teamName(state.currentUser?.id) || 'Utilisateur';
  state.activity.unshift({
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    actor,
    actorMemberId: state.currentUser?.id || null,
    projectId,
    taskId,
    text,
    internalTag
  });
  persist(TAGS.ACTIVITY_LOG, 'Activité ajoutée', { projectId, taskId, internalTag });
}

function unreadNotifications() {
  return state.notifications.filter(n => V21.notificationInScope(state, n) && !n.resolved && !n.read).length;
}

function layout(content) {
  const unread = unreadNotifications();
  return `
    <div class="shell">
      <aside class="sidebar">
        <div class="brand"><span class="brand-mark">S</span><div><strong>SpeedArti</strong><small>Pilotage</small></div></div>
        <nav class="side-nav">
          ${navItems.map(([id, label, icon]) => `<button class="nav-item ${currentPage === id ? 'active' : ''}" data-page="${id}"><span>${icon}</span>${label}</button>`).join('')}
        </nav>
        <div class="sidebar-foot"></div>
      </aside>

      <div class="workspace">
        <header class="topbar">
          <div class="mobile-brand">SpeedArti <span>Pilotage</span></div>
          <div class="v21-profile-slot">${V21.renderProfileSelector(state)}</div>
          <div class="top-actions">
            <button class="quick-create-btn" id="quickCreateBtn" title="Actions rapides"><span>＋</span><b>Créer</b></button>
            <button class="icon-btn" id="refreshRemoteBtn" aria-label="Actualiser les données équipe" title="Actualiser les données équipe">↻</button>
            <button class="icon-btn search-btn" id="searchBtn" aria-label="Rechercher">⌕</button>
            <button class="icon-btn notif-btn" id="notificationBtn" aria-label="Notifications">♢${unread ? `<b>${unread}</b>` : ''}</button>
            <span class="avatar" title="${esc(state.currentUser.name || 'Utilisateur')}" aria-label="Utilisateur ${esc(state.currentUser.name || 'Utilisateur')}">${esc(state.currentUser.initials)}</span>
          </div>
        </header>
        <main class="content">${content}</main>
      </div>

      <nav class="mobile-nav">
        ${[['today','Aujourd’hui','⌂'],['planning','Planif.','↔'],['projects','Projets','▦'],['calendar','Agenda','□'],['more','Plus','•••']].map(([id,label,icon]) => `<button class="mobile-nav-item ${currentPage === id ? 'active' : ''}" data-mobile-page="${id}"><span>${icon}</span><small>${label}</small></button>`).join('')}
      </nav>

      ${notificationOpen ? renderNotifications() : ''}
      ${planningTaskId ? renderPlanningModal(planningTaskId) : ''}
      ${taskModalOpen ? renderTaskModal() : ''}
      ${projectModalOpen ? renderProjectModal() : ''}
      ${documentModalOpen ? renderDocumentModal() : ''}
      ${googleDrivePickerOpen ? renderGoogleDrivePickerModal() : ''}
      ${googleCalendarLinkEventId ? renderGoogleCalendarLinkModal(googleCalendarLinkEventId) : ''}
      ${approvalRequestId ? renderApprovalModal(approvalRequestId) : ''}
      ${quickActionOpen ? renderQuickActionModal() : ''}
      ${archiveModalProjectId ? renderArchiveModal(archiveModalProjectId) : ''}
      ${deferTaskId ? renderDeferModal(deferTaskId) : ''}
      ${teamWorkloadOpen ? renderTeamWorkloadModal() : ''}
      ${dailyReportModalOpen ? renderDailyReportModal() : ''}
    </div>
  `;
}

function pageHeader(title, subtitle = '', action = '') {
  return `<div class="page-header"><div><h1>${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ''}</div>${action}</div>`;
}

function statusBadge(status) { return `<span class="badge status-${status}">${statusLabels[status] || status}</span>`; }
function priorityBadge(priority) { return `<span class="badge priority-${priority}">${priorityLabels[priority] || priority}</span>`; }

function taskQuickLabel(t) {
  if (!t) return '';
  if (t.status === 'completed') return 'Réouvrir';
  if (t.status === 'todo' || t.status === 'paused' || t.status === 'blocked') return 'Démarrer';
  return 'Terminer';
}

function taskCompletionSummary(projectId) {
  const list = state.tasks.filter(t => t.projectId === projectId);
  const done = list.filter(t => t.status === 'completed').length;
  return { done, total:list.length };
}

function projectChildren(parentId) {
  return state.projects
    .filter(p => (p.parentProjectId || null) === (parentId || null))
    .sort((a,b) =>
      Number(a.treeSortOrder || 0) - Number(b.treeSortOrder || 0)
      || String(a.name || '').localeCompare(String(b.name || ''), 'fr')
    );
}

function projectHasChildren(projectId) {
  return state.projects.some(p => p.parentProjectId === projectId);
}

function projectAncestorChain(projectId) {
  const chain = [];
  const seen = new Set();
  let current = project(projectId);
  while (current?.parentProjectId && !seen.has(current.parentProjectId)) {
    seen.add(current.parentProjectId);
    const parent = project(current.parentProjectId);
    if (!parent) break;
    chain.unshift(parent);
    current = parent;
  }
  return chain;
}

function projectDescendantIds(projectId) {
  const ids = [];
  const walk = id => {
    projectChildren(id).forEach(child => {
      ids.push(child.id);
      walk(child.id);
    });
  };
  walk(projectId);
  return ids;
}

function projectTreeTaskSummary(projectId) {
  const scope = new Set([projectId, ...projectDescendantIds(projectId)]);
  const list = state.tasks.filter(t => scope.has(t.projectId));
  return {
    done: list.filter(t => t.status === 'completed').length,
    total: list.length
  };
}

function projectEffectiveProgress(p) {
  return V21.projectProgress(state, p);
}

function projectDepthLocal(projectId) {
  return projectAncestorChain(projectId).length;
}

function projectTreeMaxDepth(projectId) {
  const walk = (id, depth) => {
    const children = projectChildren(id);
    if (!children.length) return depth;
    return Math.max(...children.map(child => walk(child.id, depth + 1)));
  };
  return walk(projectId, 0);
}

function projectMoveAllowed(projectId, parentId) {
  if (!projectId) return false;
  if (!parentId) return true;
  if (projectId === parentId) return false;
  if (projectDescendantIds(projectId).includes(parentId)) return false;
  const targetDepth = projectDepthLocal(parentId) + 1;
  return targetDepth + projectTreeMaxDepth(projectId) <= 2;
}

function persistProjectTreeCollapse() {
  localStorage.setItem(PROJECT_TREE_COLLAPSE_KEY, JSON.stringify([...collapsedProjectIds]));
}

function toggleProjectTree(projectId) {
  if (collapsedProjectIds.has(projectId)) collapsedProjectIds.delete(projectId);
  else collapsedProjectIds.add(projectId);
  persistProjectTreeCollapse();
  render();
}

function projectMatchesFilter(p) {
  if (projectFilter === 'archived') return Boolean(p.archived);
  if (p.archived) return false;
  if (projectFilter === 'all') return true;
  if (projectFilter === 'blocked') return p.status === 'blocked' || Boolean(p.blocker);
  return p.status === projectFilter;
}

function visibleProjectTreeSet() {
  const matched = state.projects.filter(p => V21.projectInScope(state, p) && projectMatchesFilter(p));
  const visible = new Set(matched.map(p => p.id));
  matched.forEach(p => projectAncestorChain(p.id).forEach(parent => visible.add(parent.id)));
  return visible;
}

function projectTreeRoots(visibleSet) {
  return state.projects
    .filter(p => visibleSet.has(p.id))
    .filter(p => !p.parentProjectId || !visibleSet.has(p.parentProjectId))
    .sort((a,b) =>
      Number(a.treeSortOrder || 0) - Number(b.treeSortOrder || 0)
      || String(a.name || '').localeCompare(String(b.name || ''), 'fr')
    );
}

async function moveProjectInTree(projectId, { parentId = null, beforeId = null } = {}) {
  if (projectTreeMoveBusy || !projectId) return;
  const moving = project(projectId);
  if (!moving || !canManageProject(moving)) return;

  const targetParentId = beforeId ? (project(beforeId)?.parentProjectId || null) : parentId;
  if (!projectMoveAllowed(projectId, targetParentId)) {
    window.alert('Déplacement impossible : la hiérarchie est limitée à 3 niveaux et aucune boucle n’est autorisée.');
    return;
  }

  const client = window.PILOTAGE_SUPABASE_CLIENT;
  if (!client) {
    window.alert('Connexion Supabase indisponible.');
    return;
  }

  const pageBeforeMove = currentPage;
  const selectedBeforeMove = selectedProjectId;
  const tabBeforeMove = projectDetailTab;
  const filterBeforeMove = projectFilter;

  projectTreeMoveBusy = true;
  render();

  try {
    await window.PILOTAGE_REMOTE?.flush?.();
    const { error } = await client.rpc('move_pilotage_project', {
      p_project_client_key: projectId,
      p_parent_client_key: parentId || null,
      p_before_client_key: beforeId || null
    });
    if (error) throw new Error(error.message || 'Déplacement impossible');

    // Recharge les données calculées par Supabase sans recharger toute l'application.
    const refreshed = await window.PILOTAGE_REMOTE?.refreshFromSupabase?.({ reload:false });
    if (refreshed) {
      state = refreshed;
      ensureRuntimeState();
    }

    projectTreeMoveBusy = false;
    currentPage = pageBeforeMove || 'projects';
    projectFilter = filterBeforeMove;
    projectDetailTab = tabBeforeMove;
    selectedProjectId = selectedBeforeMove && project(selectedBeforeMove) ? selectedBeforeMove : null;
    render();
  } catch (error) {
    projectTreeMoveBusy = false;
    window.alert(error?.message || 'Le projet n’a pas pu être déplacé.');
    render();
  }
}

function scopedPendingValidations() {
  ensureRuntimeState();
  const selected = selectedProfileIds();
  return state.changeRequests.filter(r => {
    if (r.status !== 'pending' || project(r.projectId)?.archived) return false;
    const requester = memberIdFromIdentity(r.requestedByMemberId || r.requestedBy);
    if (requester && selected.has(requester)) return true;
    const p = project(r.projectId);
    return p ? V21.projectInScope(state, p) : false;
  });
}

function pendingValidationCount() {
  return scopedPendingValidations().length;
}

function pendingApprovals() {
  if (!isAdmin()) return [];
  return scopedPendingValidations();
}


function actorMatchesPerson(actor, personId) {
  const value = String(actor || '').toLowerCase();
  if (personId === 'u-anne') return value.includes('anne-sophie');
  if (personId === 'u-guillaume') return value.includes('guillaume');
  return value.includes('thibault');
}

function dailyReportsForDate(reportDate) {
  ensureRuntimeState();
  return state.dailyReports.filter(r => r.reportDate === reportDate);
}

function dailyReportsForPerson(personId, reportDate) {
  return dailyReportsForDate(reportDate).filter(r => r.personId === personId);
}

function manualDailyReportForPerson(personId, reportDate) {
  return dailyReportsForPerson(personId, reportDate).find(r => r.source === 'manual') || null;
}

function splitReportLines(value = '') {
  return String(value).split(/\n+/).map(x => x.trim()).filter(Boolean).slice(0, 12);
}

function buildAutomaticDailyReport(member, reportDate, agent = null) {
  const activities = state.activity
    .filter(a => dateKey(a.at) === reportDate && actorMatchesPerson(a.actor, member.id))
    .slice(0, 8);
  const completedTasks = state.tasks.filter(t =>
    t.assignedTo === member.id && t.status === 'completed' &&
    (dateKey(t.completedAt) === reportDate || (!t.completedAt && t.scheduledFor === reportDate))
  );
  const achievements = [...new Set([
    ...completedTasks.map(t => `Tâche terminée : ${t.title}`),
    ...activities.map(a => a.text)
  ])].slice(0, 6);
  const blockers = state.projects
    .filter(p => !p.archived && p.owner === member.id && p.blocker)
    .map(p => `${p.name} : ${p.blocker}`)
    .slice(0, 4);
  const nextSteps = state.projects
    .filter(p => !p.archived && p.owner === member.id && p.status !== 'completed' && p.nextAction)
    .map(p => `${p.name} : ${p.nextAction}`)
    .slice(0, 4);
  const projectIds = [...new Set([
    ...activities.map(a => a.projectId).filter(Boolean),
    ...completedTasks.map(t => t.projectId).filter(Boolean),
    ...state.projects.filter(p => !p.archived && p.owner === member.id).map(p => p.id)
  ])].slice(0, 8);
  const sourceName = agent?.name || 'IA';
  const summary = achievements.length
    ? `${sourceName} a synthétisé ${achievements.length} avancée${achievements.length > 1 ? 's' : ''} aujourd’hui${blockers.length ? `, avec ${blockers.length} blocage${blockers.length > 1 ? 's' : ''} à suivre` : ''}.`
    : `${sourceName} n’a détecté aucune réalisation enregistrée automatiquement pour ${member.name} aujourd’hui.`;
  return { summary, achievements, blockers, nextSteps, projectIds };
}

function consolidatePersonDailyReports(personId, reportDate) {
  const reports = dailyReportsForPerson(personId, reportDate);
  const unique = values => [...new Set(values.filter(Boolean))];
  const achievements = unique(reports.flatMap(r => r.achievements || []));
  const blockers = unique(reports.flatMap(r => r.blockers || []));
  const nextSteps = unique(reports.flatMap(r => r.nextSteps || []));
  const projectIds = unique(reports.flatMap(r => r.projectIds || []));
  const validatedCount = reports.filter(r => r.validatedAt).length;
  return {
    reports, achievements, blockers, nextSteps, projectIds,
    validatedCount,
    allValidated: reports.length > 0 && validatedCount === reports.length,
    summary: reports.length > 1
      ? `${reports.length} sources consolidées · ${achievements.length} réalisation${achievements.length > 1 ? 's' : ''}${blockers.length ? ` · ${blockers.length} blocage${blockers.length > 1 ? 's' : ''}` : ''}.`
      : (reports[0]?.summary || '')
  };
}

function collectAutomaticDailyReports(reportDate = dailyReportDate) {
  ensureRuntimeState();
  let created = 0;
  let updated = 0;
  let skipped = 0;
  activeAiAgents().filter(agent => selectedProfileIds().has(agent.personId)).forEach(agent => {
    const member = state.team.find(m => m.id === agent.personId);
    if (!member) return;
    const existing = dailyReportsForPerson(member.id, reportDate).find(r => r.source === 'ai' && r.sourceAgent === agent.id);
    if (existing?.validatedAt) { skipped += 1; return; }
    const generated = buildAutomaticDailyReport(member, reportDate, agent);
    if (existing) {
      Object.assign(existing, generated, {
        source:'ai', sourceAgent:agent.id, updatedAt:new Date().toISOString()
      });
      updated += 1;
    } else {
      state.dailyReports.unshift({
        id:crypto.randomUUID(), reportDate, personId:member.id,
        source:'ai', sourceAgent:agent.id, status:'draft',
        ...generated, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), validatedAt:null
      });
      created += 1;
    }
  });
  addActivity({ actor:'Pilotage', projectId:null, text:`Collecte multi-IA du ${formatDate(reportDate)} : ${created} créé(s), ${updated} actualisé(s), ${skipped} conservé(s)`, internalTag:TAGS.REPORT_MULTI_SOURCE });
  trace(TAGS.REPORT_MULTI_SOURCE, 'Collecte multi-source terminée', { reportDate, activeAgents:activeAiAgents().length, created, updated, skipped });
  persist(TAGS.REPORT_AUTO_COLLECT, 'Collecte quotidienne multi-IA simulée', { reportDate, created, updated, skipped, activeAgents:activeAiAgents().map(a => a.id) });
  currentPage = 'reports';
  render();
}

function teamDailySummary(reportDate) {
  const scopeMembers = visibleReportMembers();
  const scopeIds = new Set(scopeMembers.map(m => m.id));
  const reports = dailyReportsForDate(reportDate).filter(r => scopeIds.has(r.personId));
  const unique = values => [...new Set(values.filter(Boolean))];
  const achievements = unique(reports.flatMap(r => r.achievements || []));
  const blockers = unique(reports.flatMap(r => r.blockers || []));
  const nextSteps = unique(reports.flatMap(r => r.nextSteps || []));
  const received = new Set(reports.map(r => r.personId)).size;
  const sources = reports.length;
  const validated = reports.filter(r => r.validatedAt).length;
  return {
    received,
    expected: scopeMembers.length,
    sources,
    expectedSources: activeAiAgents().filter(agent => scopeIds.has(agent.personId)).length,
    validated,
    achievements: achievements.length,
    blockers: blockers.length,
    nextSteps: nextSteps.length,
    text: received
      ? `${received}/${scopeMembers.length} personne${scopeMembers.length > 1 ? 's' : ''} couverte${scopeMembers.length > 1 ? 's' : ''} · ${sources} source${sources > 1 ? 's' : ''} reçue${sources > 1 ? 's' : ''} · ${achievements.length} réalisation${achievements.length > 1 ? 's' : ''} · ${blockers.length} blocage${blockers.length > 1 ? 's' : ''}.`
      : 'Aucun compte rendu reçu pour cette journée.'
  };
}

// PILOT-SEC-002 — l’interface de production n’expose plus les outils de simulation/réinitialisation de démo.
function renderToday() {
  const today = currentDateKey();
  const myTasks = state.tasks.filter(t => V21.taskInScope(state, t) && t.scheduledFor === today && t.status !== 'completed' && (!t.projectId || !project(t.projectId)?.archived));
  const blocked = state.projects.filter(p => V21.projectInScope(state, p) && !p.archived && (p.status === 'blocked' || p.blocker)).slice(0, 3);
  const toPlan = state.tasks.filter(t => V21.taskInScope(state, t) && t.needsPlanning && t.planningStatus === 'unplanned').length;
  const approvals = pendingValidationCount();
  const events = state.calendarEvents.filter(e => e.at && e.at.startsWith(today) && V21.eventInScope(state, e));

  const overdue = state.tasks.filter(t => V21.taskInScope(state, t) && t.status !== 'completed' && t.dueAt && new Date(t.dueAt) < new Date() && (!t.projectId || !project(t.projectId)?.archived)).length;
  const activeBlockers = state.projects.filter(p => V21.projectInScope(state, p) && !p.archived && p.blocker && p.status !== 'completed').length;
  const reportSummary = teamDailySummary(today);
  return pageHeader(`Bonjour ${state.currentUser.name || teamName(state.currentUser.id)}`, `${longDateLabel(today)} · ${V21.getProfileScopeLabel(state)}`) + `
    <section class="pilot-pulse">
      <button class="pulse-card pulse-red" data-notif-open-filter="warning"><span>Retards</span><strong>${overdue}</strong><small>échéance${overdue > 1 ? 's' : ''} dépassée${overdue > 1 ? 's' : ''}</small></button>
      <button class="pulse-card pulse-orange" data-notif-open-filter="warning"><span>Blocages</span><strong>${activeBlockers}</strong><small>projet${activeBlockers > 1 ? 's' : ''} à surveiller</small></button>
      <button class="pulse-card pulse-violet" data-notif-open-filter="action"><span>Validations</span><strong>${approvals}</strong><small>décision${approvals > 1 ? 's' : ''} attendue${approvals > 1 ? 's' : ''}</small></button>
      <button class="pulse-card pulse-blue" data-page="planning"><span>À planifier</span><strong>${toPlan}</strong><small>nouvel élément</small></button>
    </section>
    <section class="section daily-report-today">
      <div class="section-title"><h2>Compte rendu du jour</h2><button class="text-button" data-page="reports">Voir les comptes rendus →</button></div>
      <button class="daily-report-summary-card" data-page="reports"><div><span class="report-progress-ring">${reportSummary.received}/${reportSummary.expected}</span><div><strong>${reportSummary.text}</strong><small>${reportSummary.sources ? `${reportSummary.validated}/${reportSummary.sources} source${reportSummary.sources > 1 ? 's' : ''} validée${reportSummary.sources > 1 ? 's' : ''}` : 'Aucune source reçue'} · multi-IA + manuel</small></div></div><span>Ouvrir →</span></button>
    </section>
    <section class="section">
      <div class="section-title"><h2>Agenda du jour</h2><button class="text-button" data-page="calendar">Voir l’agenda →</button></div>
      <div class="simple-list">
        ${events.map(e => `<div class="time-row source-google"><time>${formatTime(e.at)}</time><div><strong>${esc(e.title)}</strong><small>Google Calendar</small></div></div>`).join('') || `<div class="empty-line">Aucun rendez-vous aujourd’hui.</div>`}
      </div>
    </section>

    <section class="section">
      <div class="section-title"><h2>Tâches · ${esc(V21.getProfileScopeLabel(state))}</h2><button class="text-button" data-action="quick-add">+ Ajouter</button></div>
      <div class="task-list">
        ${myTasks.map(t => `<div class="task-row"><button class="checkbox ${t.status === 'completed' ? 'checked' : ''}" data-complete="${t.id}" aria-label="Terminer"></button><button class="task-main task-main-button" data-edit-task="${t.id}"><strong>${esc(t.title)}</strong><small>${esc(project(t.projectId)?.name || 'Sans projet')} · ${esc(teamName(t.assignedTo))}</small>${V21.renderTaskProgress(t)}</button>${priorityBadge(t.priority)}<button class="quick-status-btn" data-task-status="${t.id}">${taskQuickLabel(t)}</button><button class="defer-btn" data-defer-task="${t.id}">Reporter</button><button class="row-action" data-edit-task="${t.id}">Modifier</button></div>`).join('') || `<div class="empty-line">Aucune tâche prévue aujourd’hui pour les profils sélectionnés.</div>`}
      </div>
    </section>

    <section class="section two-col">
      <div>
        <div class="section-title"><h2>À surveiller</h2></div>
        <div class="watch-list">${blocked.map(p => `<button class="watch-row" data-project="${p.id}"><span class="dot ${p.status === 'blocked' ? 'red' : 'amber'}"></span><div><strong>${esc(p.name)}</strong><small>${esc(p.blocker || p.nextAction)}</small></div></button>`).join('')}</div>
      </div>
      <div>
        ${isAdmin() ? `
          <div class="section-title"><h2>Équipe</h2><button class="text-button" id="openTeamWorkload">Voir la charge →</button></div>
          <div class="team-list">
            ${selectedMembers().filter(m => m.id !== state.currentUser.id).map(m => {
              const pending = state.tasks.filter(t => t.assignedTo === m.id && t.status !== 'completed').length;
              const blockers = state.projects.filter(p => p.owner === m.id && p.blocker).length;
              return `<button class="team-row team-row-button" data-team-planning="${m.id}"><div><strong>${esc(m.name)}</strong><small>${esc(m.role)}</small></div><span>${pending} tâches · ${blockers ? `${blockers} blocage` : 'Tout va bien'} →</span></button>`;
            }).join('')}
          </div>`
        : `
          <div class="section-title"><h2>Mes projets accessibles</h2><button class="text-button" data-page="projects">Voir les projets →</button></div>
          <div class="team-list">
            ${state.projects.filter(p => !p.archived && V21.projectInScope(state, p)).slice(0,4).map(p => `<button class="team-row team-row-button" data-project="${p.id}"><div><strong>${esc(p.name)}</strong><small>${p.owner === state.currentUser.id ? 'Responsable' : 'Participant'} · ${projectMemberIds(p).length} membre${projectMemberIds(p).length > 1 ? 's' : ''}</small></div><span>${projectEffectiveProgress(p)} % →</span></button>`).join('') || '<div class="empty-line">Aucun projet accessible.</div>'}
          </div>`}
      </div>
    </section>

    ${pendingApprovals().length ? `<section class="section decisions-box">
      <div class="section-title"><h2>Décisions à prendre</h2><button class="text-button" id="openNotifFromToday">Tout voir →</button></div>
      <div class="decision-list">${pendingApprovals().slice(0,3).map(r => { const p=project(r.projectId); return `<button class="decision-row" data-approval="${r.id}"><div><strong>${esc(p?.name || 'Projet')}</strong><small>Passage en Terminé demandé par ${esc(memberLabel(r.requestedByMemberId || r.requestedBy || 'IA'))}</small></div><span>Examiner →</span></button>`; }).join('')}</div>
    </section>` : ''}
    <section class="section attention-box">
      <div class="section-title"><h2>À traiter</h2></div>
      <button class="attention-row" data-page="planning"><strong>${toPlan} élément${toPlan > 1 ? 's' : ''} à planifier</strong><span>Voir →</span></button>
      <button class="attention-row" id="openNotifFromTodayBottom"><strong>${approvals} validation${approvals > 1 ? 's' : ''} demandée${approvals > 1 ? 's' : ''}</strong><span>Voir →</span></button>
    </section>`;
}

function renderPlanning() {
  const header = pageHeader('Planification', `Organiser le court, moyen et long terme · ${V21.getProfileScopeLabel(state)}`, '<button class="primary-btn" data-action="quick-add">+ Ajouter une tâche</button>');
  const modeSwitch = V21.renderPlanningModeSwitch();
  if (V21.getPlanningMode() === 'gantt') {
    return header + modeSwitch + V21.renderGantt(state, { statusLabels, priorityLabels });
  }

  const buckets = ['backlog','this_week','this_month','next_3_months','later'];
  const filteredTasks = state.tasks.filter(t => {
    if (!V21.taskInScope(state, t)) return false;
    if (t.status === 'completed') return false;
    if (t.projectId && project(t.projectId)?.archived) return false;
    if (planningFilterProject !== 'all' && t.projectId !== planningFilterProject) return false;
    if (planningFilterOwner !== 'all' && t.assignedTo !== planningFilterOwner) return false;
    if (planningFilterPriority !== 'all' && t.priority !== planningFilterPriority) return false;
    return true;
  });

  return header + modeSwitch + `
    <div class="toolbar">
      <select id="planningProjectFilter">
        <option value="all">Tous les projets</option>
        ${state.projects.filter(p => !p.archived && V21.projectInScope(state, p)).map(p => `<option value="${p.id}" ${planningFilterProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}
      </select>
      <select id="planningOwnerFilter">
        <option value="all">Tous les responsables</option>
        ${selectedMembers().map(m => `<option value="${m.id}" ${planningFilterOwner === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
      </select>
      <select id="planningPriorityFilter">
        <option value="all">Toutes les priorités</option>
        ${Object.entries(priorityLabels).map(([value,label]) => `<option value="${value}" ${planningFilterPriority === value ? 'selected' : ''}>${label}</option>`).join('')}
      </select>
    </div>
    <div class="mobile-roadmap-tabs">${buckets.map(bucket => `<button class="${mobilePlanningBucket === bucket ? 'active' : ''}" data-mobile-bucket="${bucket}">${planningLabels[bucket]}</button>`).join('')}</div>
    <div class="planning-board">
      ${buckets.map(bucket => {
        const items = filteredTasks.filter(t => t.planningBucket === bucket).sort((a,b) => a.sortOrder - b.sortOrder);
        return `<section class="planning-column ${mobilePlanningBucket === bucket ? 'mobile-active' : ''}" data-bucket="${bucket}">
          <header><h2>${planningLabels[bucket]}</h2><span>${items.length}</span></header>
          <div class="planning-dropzone" data-dropzone="${bucket}">
            ${items.map(t => `<article class="planning-card ${t.needsPlanning && t.planningStatus === 'unplanned' ? 'needs-planning' : ''}" draggable="true" data-task="${t.id}">
              <div class="planning-card-head"><strong>${esc(t.title)}</strong><button class="card-edit" data-edit-task="${t.id}" title="Modifier">✎</button></div>
              <small>${esc(project(t.projectId)?.name || 'Sans projet')} · ${esc(teamName(t.assignedTo))}</small>
              ${V21.renderTaskProgress(t)}
              ${t.scheduledFor ? `<div class="date-chip">Prévue ${formatDate(t.scheduledFor)}</div>` : ''}
              <footer><span class="owner-pill">${esc(teamName(t.assignedTo))}</span>${priorityBadge(t.priority)}</footer>
              <div class="card-actions"><button class="mini-action" data-plan="${t.id}">${t.needsPlanning && t.planningStatus === 'unplanned' ? 'Planifier' : 'Déplacer / dater'}</button><button class="mini-action secondary-mini" data-edit-task="${t.id}">Modifier</button></div>
            </article>`).join('') || `<div class="planning-empty">Aucune tâche</div>`}
          </div>
        </section>`;
      }).join('')}
    </div>`;
}
function renderProjectTreeNode(p, visibleSet, depth = 0) {
  const children = projectChildren(p.id).filter(child => visibleSet.has(child.id));
  const hasChildren = children.length > 0;
  const collapsed = collapsedProjectIds.has(p.id);
  const summary = hasChildren ? projectTreeTaskSummary(p.id) : taskCompletionSummary(p.id);
  const progress = projectEffectiveProgress(p);
  const pending = pendingCompletionRequest(p.id);
  const movable = canManageProject(p) && !p.archived;

  return `
    <div class="project-tree-node" style="--tree-depth:${depth}">
      <div class="project-drop-before" data-project-before="${p.id}" aria-hidden="true"></div>
      <div class="project-row project-tree-row ${projectTreeMoveBusy ? 'tree-busy' : ''}"
           data-project-tree-row="${p.id}"
           data-project-nest="${p.id}"
           ${movable ? 'draggable="true"' : ''}>
        <div class="project-tree-controls">
          ${hasChildren
            ? `<button class="project-tree-toggle" data-project-toggle="${p.id}" title="${collapsed ? 'Déplier' : 'Replier'}">${collapsed ? '›' : '⌄'}</button>`
            : '<span class="project-tree-toggle placeholder">·</span>'}
          <span class="project-drag-handle" title="${movable ? 'Glisser pour déplacer' : 'Déplacement réservé au responsable'}">⋮⋮</span>
        </div>

        <button class="project-main project-open-area" data-project-open="${p.id}">
          <div class="project-title-line">
            <strong>${hasChildren ? '📁 ' : '▣ '}${esc(p.name)}</strong>
            ${statusBadge(p.status)}
            ${priorityBadge(p.priority)}
            ${pending ? '<span class="badge status-to_validate">Validation</span>' : ''}
            ${hasChildren ? `<span class="project-tree-count">${children.length} sous-projet${children.length > 1 ? 's' : ''}</span>` : ''}
          </div>
          <small>
            ${esc(teamName(p.owner))} ·
            ${projectMemberIds(p).length} participant${projectMemberIds(p).length > 1 ? 's' : ''} ·
            ${summary.done}/${summary.total} tâches terminées
            ${hasChildren ? ' · arborescence' : ''}
          </small>
        </button>

        <div class="project-progress">
          <span>${progress} % <em>auto</em></span>
          <div class="progress"><i style="width:${progress}%"></i></div>
        </div>

        <div class="project-context">
          <small>${p.blocker ? 'Blocage' : 'Prochaine action'}</small>
          <span>${esc(p.blocker || p.nextAction || 'À définir')}</span>
        </div>

        <div class="project-nest-hint">Déposer dans ce projet</div>
      </div>

      ${hasChildren && !collapsed
        ? `<div class="project-tree-children">${children.map(child => renderProjectTreeNode(child, visibleSet, depth + 1)).join('')}</div>`
        : ''}
    </div>`;
}

function renderProjects() {
  if (selectedProjectId) return renderProjectDetail(selectedProjectId);

  const filters = [
    ['all', 'Tous'],
    ['in_progress', 'En cours'],
    ['blocked', 'Bloqués'],
    ['to_test', 'À tester'],
    ['completed', 'Terminés'],
    ['archived', 'Archivés']
  ];

  const visibleSet = visibleProjectTreeSet();
  const roots = projectTreeRoots(visibleSet);

  return pageHeader(
    'Projets',
    isAdmin()
      ? 'Organisation en arborescence · glisse un projet sur un autre pour créer un sous-projet'
      : 'Projets accessibles · 3 niveaux maximum',
    '<button class="primary-btn" data-action="new-project">+ Nouveau projet</button>'
  ) + `
    <div class="tabs">
      ${filters.map(([value,label]) => `<button class="${projectFilter === value ? 'active' : ''}" data-project-filter="${value}">${label}</button>`).join('')}
    </div>

    <div class="project-tree-help">
      <span>↕</span>
      <div>
        <strong>Glisser-déposer</strong>
        <small>Dépose un projet <b>sur</b> un autre pour l'imbriquer, ou sur le trait entre deux projets pour le réordonner. Maximum 3 niveaux.</small>
      </div>
    </div>

    <div class="project-root-drop" data-project-root-drop>
      ↰ Déposer ici pour remettre le projet au niveau principal
    </div>

    <div class="project-list project-tree-list">
      ${roots.map(p => renderProjectTreeNode(p, visibleSet, 0)).join('') || '<div class="empty-state">Aucun projet dans cette vue.</div>'}
    </div>`;
}

function renderProjectDetail(id) {
  const p = project(id);
  if (!p || !V21.projectInScope(state, p)) { selectedProjectId = null; return renderProjects(); }

  const tasks = state.tasks.filter(t => t.projectId === id && V21.taskInScope(state, t));
  const docs = allDocumentRefs().filter(d => d.projectId === id);
  const activities = state.activity.filter(a => a.projectId === id).slice(0,20);
  const children = projectChildren(id).filter(child => !child.archived);
  const ancestors = projectAncestorChain(id);
  const subtree = projectTreeTaskSummary(id);
  const progress = projectEffectiveProgress(p);
  const hasChildren = children.length > 0;
  const pending = pendingCompletionRequest(p.id);

  const breadcrumbs = `
    <div class="project-breadcrumbs">
      <button id="backProjects">Projets</button>
      ${ancestors.map(parent => `<span>›</span><button data-project-open="${parent.id}">${esc(parent.name)}</button>`).join('')}
      <span>›</span><strong>${esc(p.name)}</strong>
    </div>`;

  const quickAdd = !p.archived ? `
    <div class="project-add-bar">
      <strong>+ Ajouter dans ce projet</strong>
      <div>
        <button data-action="add-project-task" data-project-id="${p.id}">✓ Tâche</button>
        <button data-action="add-subproject" data-project-id="${p.id}" ${projectDepthLocal(p.id) >= 2 ? 'disabled title="3 niveaux maximum"' : ''}>📁 Sous-projet</button>
        <button data-action="link-project-document" data-project-id="${p.id}">▤ Document</button>
        <button data-action="add-project-idea" data-project-id="${p.id}">💡 Idée</button>
      </div>
    </div>` : '';

  const overviewTab = `
    <section class="section info-grid">
      <div class="${p.blocker ? 'info-blocker' : ''}">
        <small>Blocage actuel</small>
        <strong>${esc(p.blocker || 'Aucun blocage')}</strong>
        ${p.blocker && !p.archived && canManageProject(p) ? `<button class="clear-blocker-btn" data-clear-blocker="${p.id}">Lever le blocage</button>` : ''}
      </div>
      <div><small>Prochaine action</small><strong>${esc(p.nextAction || 'Non définie')}</strong></div>
      <div><small>Participants</small><strong>${projectMemberIds(p).map(memberId => esc(teamName(memberId))).join(' · ') || 'Aucun'}</strong></div>
    </section>

    ${hasChildren ? `
      <section class="section project-tree-summary">
        <div class="section-title">
          <div><h2>Arborescence</h2><small>La progression du projet principal est calculée automatiquement sur toutes les tâches ci-dessous.</small></div>
          <button class="text-button" data-project-tab="subprojects">Voir les sous-projets →</button>
        </div>
        <div class="project-tree-stats">
          <span><b>${children.length}</b><small>Sous-projets directs</small></span>
          <span><b>${projectDescendantIds(p.id).length}</b><small>Sous-projets au total</small></span>
          <span><b>${subtree.done}/${subtree.total}</b><small>Tâches terminées</small></span>
          <span><b>${progress}%</b><small>Progression automatique</small></span>
        </div>
        <div class="project-child-preview">
          ${children.slice(0,5).map(child => {
            const childProgress = projectEffectiveProgress(child);
            return `<button data-project-open="${child.id}"><span>📁</span><div><strong>${esc(child.name)}</strong><small>${taskCompletionSummary(child.id).done}/${taskCompletionSummary(child.id).total} tâches directes</small></div><b>${childProgress}%</b></button>`;
          }).join('')}
        </div>
      </section>`
      : `
      <section class="section project-leaf-progress-note">
        <span>◉</span>
        <div><strong>Progression automatique</strong><small>La barre est toujours calculée à partir des tâches du projet. Une tâche simple vaut 0 % tant qu’elle n’est pas terminée puis 100 % une fois terminée.</small></div>
      </section>`}

    ${pending ? `
      <section class="approval-banner">
        <div><span>Validation requise</span><strong>Passage du projet en Terminé</strong><small>Le projet reste dans son état actuel tant que la Direction n'a pas décidé.</small></div>
        ${isAdmin() ? `<button class="primary-btn" data-approval="${pending.id}">Examiner</button>` : '<span class="owner-pill">En attente Direction</span>'}
      </section>` : ''}
  `;

  const subprojectsTab = `
    <section class="section">
      <div class="section-title">
        <div><h2>Sous-projets</h2><small>${children.length} directement dans ce projet</small></div>
        ${projectDepthLocal(p.id) < 2 && !p.archived ? `<button class="text-button" data-action="add-subproject" data-project-id="${p.id}">+ Ajouter un sous-projet</button>` : ''}
      </div>
      <div class="project-subproject-list">
        ${children.length ? children.map(child => {
          const childSummary = projectTreeTaskSummary(child.id);
          const childProgress = projectEffectiveProgress(child);
          return `
            <button data-project-open="${child.id}">
              <span class="subproject-folder">📁</span>
              <div><strong>${esc(child.name)}</strong><small>${childSummary.done}/${childSummary.total} tâches · ${projectChildren(child.id).length} sous-projet${projectChildren(child.id).length > 1 ? 's' : ''}</small></div>
              <div class="subproject-progress"><b>${childProgress}%</b><div class="progress"><i style="width:${childProgress}%"></i></div></div>
              <em>Ouvrir →</em>
            </button>`;
        }).join('') : '<div class="empty-line">Aucun sous-projet. Utilise “+ Ajouter un sous-projet” ou glisse un projet dans celui-ci.</div>'}
      </div>
    </section>`;

  const tasksTab = `
    <section class="section">
      <div class="section-title"><h2>Tâches de ce projet</h2><button class="text-button" data-action="add-project-task" data-project-id="${p.id}">+ Ajouter</button></div>
      <div class="task-list">
        ${tasks.map(t => `<div class="task-row"><button class="checkbox ${t.status === 'completed' ? 'checked' : ''}" data-complete="${t.id}"></button><button class="task-main task-main-button" data-edit-task="${t.id}"><strong>${esc(t.title)}</strong><small>${statusLabels[t.status]} · ${esc(teamName(t.assignedTo))}${t.scheduledFor ? ` · ${formatDate(t.scheduledFor)}` : ''}</small>${V21.renderTaskProgress(t)}</button>${priorityBadge(t.priority)}<button class="quick-status-btn" data-task-status="${t.id}">${taskQuickLabel(t)}</button><button class="row-action" data-edit-task="${t.id}">Modifier</button></div>`).join('') || '<div class="empty-line">Aucune tâche directe dans ce projet.</div>'}
      </div>
    </section>`;

  const documentsTab = `
    <section class="section">
      <div class="section-title"><h2>Documents de ce projet</h2><button class="text-button" data-action="link-project-document" data-project-id="${p.id}">+ Lier un document</button></div>
      <div class="doc-list">
        ${docs.map(d => `<div class="doc-row"><span class="doc-icon ${d.type === 'Tableur' ? 'doc-sheet' : 'doc-document'}">▤</span><div><strong>${esc(d.name)}</strong><small>${esc(d.source)}</small></div>${d.url ? `<button class="text-button" data-open-doc="${d.id}">Ouvrir →</button>` : '<span class="demo-label">Référence</span>'}</div>`).join('') || '<div class="empty-line">Aucun document lié directement à ce projet.</div>'}
      </div>
    </section>`;

  const ideasTab = `
    <section class="section project-ideas-tab">
      <div><span>💡</span><div><h2>Idées liées au projet</h2><p>Les idées restent gérées dans le module Idées, avec votes, commentaires et transformation en tâche.</p></div></div>
      <div>
        <button class="secondary-btn" data-action="open-project-ideas" data-project-id="${p.id}">Voir les idées liées</button>
        <button class="primary-btn" data-action="add-project-idea" data-project-id="${p.id}">+ Nouvelle idée</button>
      </div>
    </section>`;

  const activityTab = `
    <section class="section">
      <div class="section-title"><h2>Activité du projet</h2></div>
      <div class="activity-list">${activities.map(renderActivityItem).join('') || '<div class="empty-line">Aucune activité récente.</div>'}</div>
    </section>`;

  const tabContent = {
    overview: overviewTab,
    subprojects: subprojectsTab,
    tasks: tasksTab,
    documents: documentsTab,
    ideas: ideasTab,
    activity: activityTab
  }[projectDetailTab] || overviewTab;

  return `
    ${breadcrumbs}
    ${pageHeader(
      p.name,
      hasChildren ? `${teamName(p.owner)} · projet principal / dossier` : teamName(p.owner),
      `<div class="header-actions">${canManageProject(p) ? (p.archived ? `<button class="secondary-btn" data-restore-project="${p.id}">Restaurer</button>` : `<button class="secondary-btn" data-edit-project="${p.id}">Modifier</button><button class="archive-btn" data-archive-project="${p.id}">Archiver</button>`) : ''}</div>`
    )}
    ${p.archived ? '<div class="archive-banner"><strong>Projet archivé</strong><span>Il reste consultable, mais n’apparaît plus dans le pilotage actif.</span></div>' : ''}

    <div class="project-detail-head">
      <div>${statusBadge(p.status)} ${priorityBadge(p.priority)} <span class="owner-pill">${esc(teamName(p.owner))}</span><span class="project-auto-progress-badge">Progression auto</span></div>
      <strong>${progress} %</strong>
    </div>
    <div class="progress large"><i style="width:${progress}%"></i></div>
    <div class="project-progress-caption">${subtree.done}/${subtree.total} tâches terminées dans le projet et son arborescence</div>

    ${quickAdd}

    <div class="project-detail-tabs">
      ${[
        ['overview','Vue d’ensemble'],
        ['subprojects',`Sous-projets (${children.length})`],
        ['tasks',`Tâches (${tasks.length})`],
        ['documents',`Documents (${docs.length})`],
        ['ideas','Idées'],
        ['activity','Activité']
      ].map(([value,label]) => `<button class="${projectDetailTab === value ? 'active' : ''}" data-project-tab="${value}">${label}</button>`).join('')}
    </div>

    ${tabContent}
  `;
}

function renderGoogleDrivePanel() {
  const drive = integration('google_drive');
  const connected = drive?.status === 'connected';
  const rootName = drive?.configuration?.root_folder_name || '';
  const error = drive?.lastError || '';
  return `<section class="section google-integration-card">
    <div class="google-integration-head">
      <div><span class="google-logo">G</span><div><strong>Google Drive</strong><small>${connected ? 'Connecté en lecture seule' : 'Non connecté'}</small></div></div>
      <span class="integration-pill ${connected ? 'is-connected' : 'is-disconnected'}">${connected ? 'Connecté' : 'À connecter'}</span>
    </div>
    ${connected ? `<div class="google-integration-body">
      <div><small>Dossier synchronisé</small><strong>${esc(rootName || 'Aucun dossier sélectionné')}</strong><span>${esc(formatSyncDate(drive.lastSyncedAt))}</span></div>
      <div class="google-integration-actions">
        <button class="secondary-btn" id="googleDriveChoose" ${googleBusy ? 'disabled' : ''}>${rootName ? 'Changer le dossier' : 'Choisir le dossier'}</button>
        <button class="primary-btn" id="googleDriveSync" ${!rootName || googleBusy ? 'disabled' : ''}>${googleBusy === 'drive-sync' ? 'Synchronisation…' : 'Synchroniser'}</button>
      </div>
    </div>
    ${googleDriveProgressText ? `<div class="drive-sync-progress">${esc(googleDriveProgressText)}</div>` : ''}` : `<div class="google-integration-body"><p>Connecte ton compte Google puis choisis <strong>un seul dossier racine</strong>. Pilotage synchronisera uniquement ce dossier et ses sous-dossiers.</p><button class="primary-btn" id="googleConnectDrive" ${googleBusy ? 'disabled' : ''}>Connecter Google</button></div>`}
    ${error ? `<p class="integration-error">${esc(error)}</p>` : ''}
  </section>`;
}

function renderGoogleCalendarPanel() {
  const cal = integration('google_calendar');
  const connected = cal?.status === 'connected';
  const sources = (state.calendarSources || []).filter(source => source.ownerId === state.currentUser.id);
  const selected = sources.filter(source => source.selected).length;
  return `<section class="section google-integration-card">
    <div class="google-integration-head">
      <div><span class="google-logo">G</span><div><strong>Google Agenda</strong><small>${connected ? `${selected} agenda${selected > 1 ? 's' : ''} actif${selected > 1 ? 's' : ''}` : 'Non connecté'}</small></div></div>
      <span class="integration-pill ${connected ? 'is-connected' : 'is-disconnected'}">${connected ? 'Connecté' : 'À connecter'}</span>
    </div>
    ${connected ? `<div class="google-integration-actions calendar-actions">
      <button class="secondary-btn" id="googleCalendarRefresh" ${googleBusy ? 'disabled' : ''}>Actualiser les agendas</button>
      <button class="primary-btn" id="googleCalendarSync" ${googleBusy ? 'disabled' : ''}>${googleBusy === 'calendar-sync' ? 'Synchronisation…' : 'Synchroniser les événements'}</button>
    </div>
    <div class="calendar-source-list">
      ${sources.length ? sources.map(source => `<div class="calendar-source-row">
        <label><input type="checkbox" data-google-calendar-selected="${esc(source.externalCalendarId)}" ${source.selected ? 'checked' : ''} /> <strong>${esc(source.name)}</strong>${source.primary ? '<small>Principal</small>' : ''}</label>
        <label class="calendar-share"><input type="checkbox" ${source.selected ? 'checked' : ''} disabled /> Visible équipe automatiquement</label>
      </div>`).join('') : '<div class="empty-line">Clique sur “Actualiser les agendas” pour récupérer la liste.</div>'}
    </div>
    ${sources.length ? '<button class="text-button" id="googleCalendarSaveSelection">Enregistrer la sélection</button>' : ''}` : `<div class="google-integration-body"><p>Chaque membre connecte son propre compte. Il choisit les agendas à synchroniser et ceux qu’il souhaite rendre visibles à l’équipe.</p><button class="primary-btn" id="googleConnectCalendar" ${googleBusy ? 'disabled' : ''}>Connecter Google</button></div>`}
    ${cal?.lastError ? `<p class="integration-error">${esc(cal.lastError)}</p>` : ''}
  </section>`;
}

function renderCalendar() {
  const ref = new Date();
  const today = currentDateKey();
  const startWeek = startOfWeek(ref);
  const endWeek = endOfWeek(ref);
  const events = [
    ...state.calendarEvents.map(e => ({...e, source:'google', label:e.calendarName || 'Google Calendar'})),
    ...state.tasks.filter(t => t.scheduledFor).map(t => ({ id:`scheduled-${t.id}`, taskId:t.id, ownerId:t.assignedTo, projectId:t.projectId, at:dateAtHourIso(t.scheduledFor, 9), title:t.title, source:'SpeedArti', label:'Tâche planifiée' })),
    ...state.tasks.filter(t => t.dueAt).map(t => ({ id:`due-${t.id}`, taskId:t.id, ownerId:t.assignedTo, projectId:t.projectId, at:t.dueAt, title:t.title, source:'SpeedArti', label:'Échéance' }))
  ].filter(e => e.at && V21.eventInScope(state, e)).sort((a,b) => new Date(a.at)-new Date(b.at));

  const visible = events.filter(e => {
    const d = new Date(e.at);
    if (calendarView === 'today') return dateKey(e.at) === today;
    if (calendarView === 'week') return d >= startWeek && d <= endWeek;
    return d.getFullYear() === ref.getFullYear() && d.getMonth() === ref.getMonth();
  });

  const title = calendarView === 'today' ? longDateLabel(today) : calendarView === 'week' ? weekLabel(ref) : monthLabel(ref);
  return pageHeader('Agenda', `Rendez-vous, tâches et échéances · ${V21.getProfileScopeLabel(state)}`) + `
    ${renderGoogleCalendarPanel()}
    <div class="tabs">
      <button class="${calendarView === 'today' ? 'active' : ''}" data-calendar-view="today">Aujourd’hui</button>
      <button class="${calendarView === 'week' ? 'active' : ''}" data-calendar-view="week">Semaine</button>
      <button class="${calendarView === 'month' ? 'active' : ''}" data-calendar-view="month">Mois</button>
    </div>
    <section class="section"><div class="date-heading">${title}</div><div class="agenda-list">${visible.map(e => {
      const inner = `<time>${calendarView === 'today' ? formatTime(e.at) : `${dateKey(e.at).slice(8,10)}/${dateKey(e.at).slice(5,7)} ${formatTime(e.at)}`}</time><div><strong>${esc(e.title)}</strong><small>${esc(teamName(e.ownerId))} · ${esc(e.label)}</small></div>`;
      if (e.taskId && e.source !== 'google') return `<button class="agenda-row source-speedarti ${e.label === 'Échéance' ? 'source-deadline' : ''}" data-edit-task="${e.taskId}">${inner}</button>`;
      const canLink = e.source === 'google' && (e.ownerId === state.currentUser.id || isAdmin());
      return `<div class="agenda-row source-google">${inner}${canLink ? `<button class="text-button agenda-link-btn" data-calendar-link="${e.id}">${e.projectId || e.taskId ? 'Modifier le lien' : 'Associer'}</button>` : ''}${e.meetUrl ? `<button class="text-button meet-join-btn" data-open-url="${esc(e.meetUrl)}">📹 Rejoindre</button>` : ''}${e.url ? `<button class="text-button" data-open-url="${esc(e.url)}">Agenda</button>` : ''}</div>`;
    }).join('') || '<div class="empty-line">Aucun élément dans cette période.</div>'}</div></section>`;
}

function renderDocuments() {
  const q = documentSearch.trim().toLowerCase();
  const docs = allDocumentRefs().filter(d => {
    if (!V21.documentInScope(state, d)) return false;
    if (documentProjectFilter !== 'all' && d.projectId !== documentProjectFilter) return false;
    if (q && !`${d.name} ${d.type || ''} ${d.relativePath || ''} ${project(d.projectId)?.name || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const grouped = state.projects.map(p => ({ project:p, docs:docs.filter(d => d.projectId === p.id) })).filter(g => g.docs.length);
  const orphan = docs.filter(d => !d.projectId);
  const docRow = d => `<div class="doc-row"><span class="doc-icon ${d.type === 'Tableur' ? 'doc-sheet' : 'doc-document'}">▤</span><div><strong>${esc(d.name)}</strong><small>${esc(d.type || 'Document')} · ${esc(d.source)}${d.relativePath ? ` · ${esc(d.relativePath)}` : ''}</small></div>${d.driveItemId && (d.ownerId === state.currentUser.id || isAdmin()) ? `<select class="drive-project-select" data-drive-project="${d.driveItemId}" title="Rattacher à un projet"><option value="">Sans projet</option>${state.projects.map(p => `<option value="${p.id}" ${d.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}${d.url ? `<button class="text-button" data-open-doc="${d.id}">Ouvrir →</button>` : '<span class="demo-label">Référence</span>'}</div>`;
  return pageHeader('Documents', 'Google Drive reste la source : Pilotage synchronise uniquement le dossier choisi', '<button class="primary-btn" data-action="link-document">+ Lier une référence</button>') + `
    ${renderGoogleDrivePanel()}
    <div class="toolbar"><input id="documentSearch" class="search-field" value="${esc(documentSearch)}" placeholder="Rechercher un fichier…" /><select id="documentProjectFilter"><option value="all">Tous les projets</option>${state.projects.filter(p => V21.projectInScope(state,p)).map(p => `<option value="${p.id}" ${documentProjectFilter === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <div class="documents-list">
      ${grouped.map(({project:p,docs:list}) => `<section class="section doc-group"><h2>${esc(p.name)}</h2>${list.map(docRow).join('')}</section>`).join('')}
      ${orphan.length ? `<section class="section doc-group"><h2>Sans projet</h2>${orphan.map(docRow).join('')}</section>` : ''}
      ${!docs.length ? '<div class="empty-state">Aucun document trouvé.</div>' : ''}
    </div>`;
}

function renderGoogleDrivePickerModal() {
  const current = googleDriveCurrent;
  const rootsMode = !current;
  const rows = rootsMode ? googleDriveRoots : googleDriveFolders;
  return `<div class="modal-backdrop" id="googleDrivePickerBackdrop"></div><div class="modal-card google-picker-modal" role="dialog" aria-modal="true">
    <header><div><small>GOOGLE DRIVE</small><h2>Choisir le dossier à synchroniser</h2></div><button class="icon-btn" id="closeGoogleDrivePicker">×</button></header>
    <p class="form-note">Pilotage synchronisera uniquement le dossier choisi et ses sous-dossiers. Aucun autre dossier du Drive ne sera parcouru.</p>
    ${current ? `<div class="folder-current"><button class="text-button" id="googleDriveBack">← Retour</button><div><small>Dossier actuel</small><strong>${esc(current.name)}</strong></div><button class="primary-btn" id="googleDriveSelectCurrent" ${googleDrivePickerBusy ? 'disabled' : ''}>Choisir ce dossier</button></div>` : '<div class="folder-current"><div><small>Emplacement</small><strong>Mes espaces Drive</strong></div></div>'}
    <div class="folder-browser">
      ${googleDrivePickerBusy ? '<div class="empty-line">Chargement…</div>' : rows.length ? rows.map(folder => `<button class="folder-row" data-drive-browse="${esc(folder.id)}" data-drive-name="${esc(folder.name)}" data-drive-id="${esc(folder.drive_id || current?.driveId || '')}"><span>▣</span><strong>${esc(folder.name)}</strong><small>${folder.kind === 'shared_drive' ? 'Drive partagé' : 'Dossier'}</small><b>›</b></button>`).join('') : '<div class="empty-line">Aucun sous-dossier.</div>'}
    </div>
    <footer><button class="secondary-btn" id="cancelGoogleDrivePicker">Annuler</button></footer>
  </div>`;
}

function renderGoogleCalendarLinkModal(eventId) {
  const event = state.calendarEvents.find(item => item.id === eventId);
  if (!event) return '';
  const tasks = state.tasks.filter(t => !event.projectId || t.projectId === event.projectId);
  return `<div class="modal-backdrop" id="googleCalendarLinkBackdrop"></div><div class="modal-card form-modal" role="dialog" aria-modal="true">
    <header><div><small>GOOGLE AGENDA</small><h2>Associer l’événement</h2></div><button class="icon-btn" id="closeGoogleCalendarLink">×</button></header>
    <div class="form-grid">
      <div class="form-field form-field-full"><span>Événement</span><strong>${esc(event.title)}</strong></div>
      <label class="form-field form-field-full"><span>Projet</span><select id="googleCalendarProject"><option value="">Sans projet</option>${state.projects.map(p => `<option value="${p.id}" ${event.projectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="form-field form-field-full"><span>Tâche (optionnel)</span><select id="googleCalendarTask"><option value="">Aucune tâche</option>${tasks.map(t => `<option value="${t.id}" ${event.taskId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}</select></label>
    </div>
    <footer><button class="secondary-btn" id="cancelGoogleCalendarLink">Annuler</button><button class="primary-btn" id="saveGoogleCalendarLink">Enregistrer</button></footer>
  </div>`;
}

function renderActivityItem(a) {
  const p = project(a.projectId);
  const actor = String(a.actor || 'Système');
  const sourceClass = /chatgpt|claude| via /i.test(actor) ? 'activity-ai' : 'activity-human';
  return `<div class="activity-item ${sourceClass}"><time>${formatDate(a.at)}<small>${formatTime(a.at)}</small></time><div><strong>${esc(actor)}</strong><small>${esc(p?.name || 'SpeedArti')}</small><p>${esc(a.text)}</p></div></div>`;
}

function renderActivity() {
  const filters = [
    ['all','Tous'],
    ['thibault','Thibault'],
    ['anne','Anne-Sophie'],
    ['guillaume','Guillaume'],
    ['ai','IA']
  ];
  const q = activitySearch.trim().toLowerCase();
  const visible = state.activity.filter(a => {
    if (!V21.activityInScope(state, a)) return false;
    const actor = String(a.actor || '').toLowerCase();
    if (activityFilter === 'thibault' && !actor.includes('thibault')) return false;
    if (activityFilter === 'anne' && !actor.includes('anne-sophie')) return false;
    if (activityFilter === 'guillaume' && !actor.includes('guillaume')) return false;
    if (activityFilter === 'ai' && !(actor.includes('via') || actor.includes('chatgpt') || actor.includes('claude'))) return false;
    if (activityProjectFilter !== 'all' && a.projectId !== activityProjectFilter) return false;
    if (q && !`${a.actor || ''} ${a.text || ''} ${project(a.projectId)?.name || ''}`.toLowerCase().includes(q)) return false;
    return true;
  });
  return pageHeader('Activité', 'Historique lisible de ce qui a réellement changé') + `
    <div class="tabs">
      ${filters.map(([value,label]) => `<button class="${activityFilter === value ? 'active' : ''}" data-activity-filter="${value}">${label}</button>`).join('')}
    </div>
    <div class="toolbar activity-toolbar"><input id="activitySearch" class="search-field" value="${esc(activitySearch)}" placeholder="Rechercher dans l’activité…" /><select id="activityProjectFilter"><option value="all">Tous les projets</option>${state.projects.map(p => `<option value="${p.id}" ${activityProjectFilter === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>
    <section class="section"><div class="activity-list">${visible.map(renderActivityItem).join('') || '<div class="empty-line">Aucune activité dans ce filtre.</div>'}</div></section>`;
}



// PILOT-AI-018..023 — ChatGPT Pilotage via Edge Function Supabase.
// Aucune clé OpenAI n'est présente dans le navigateur.
async function invokePilotageAssistant(body) {
  const client = window.PILOTAGE_SUPABASE_CLIENT;
  if (!client?.functions?.invoke) {
    throw new Error('Connexion Supabase indisponible pour ChatGPT Pilotage.');
  }

  trace(TAGS.AI_EDGE_REQUEST, 'Appel Edge Function ChatGPT Pilotage', { action:body?.action || 'chat' });

  const { data, error } = await client.functions.invoke('pilotage-chatgpt', { body });

  if (error) {
    let detail = null;
    try {
      if (error.context?.json) detail = await error.context.json();
    } catch {}
    const failure = new Error(detail?.error || error.message || 'Erreur du connecteur ChatGPT Pilotage.');
    failure.code = detail?.code || null;
    throw failure;
  }

  if (data?.error) {
    const failure = new Error(data.error);
    failure.code = data.code || null;
    throw failure;
  }

  return data || {};
}

function assistantMessageHtml(message) {
  const role = message?.role === 'user' ? 'user' : message?.role === 'system' ? 'system' : 'assistant';
  const text = esc(message?.content || '').replace(/\n/g, '<br>');
  const actionCount = Array.isArray(message?.actions) ? message.actions.length : 0;
  return `<article class="pilot-ai-message pilot-ai-${role}">
    <div class="pilot-ai-avatar">${role === 'user' ? esc(state.currentUser.initials || 'MOI') : role === 'system' ? '!' : '✦'}</div>
    <div class="pilot-ai-bubble">
      <small>${role === 'user' ? esc(state.currentUser.name || 'Moi') : role === 'system' ? 'Pilotage' : 'ChatGPT Pilotage'}</small>
      <p>${text}</p>
      ${actionCount ? `<span class="pilot-ai-action-count">${actionCount} action${actionCount > 1 ? 's' : ''} Pilotage</span>` : ''}
    </div>
  </article>`;
}

async function loadAssistantHistory(force = false) {
  if (assistantHistoryLoading || (assistantHistoryLoaded && !force)) return;
  assistantHistoryLoading = true;
  if (currentPage === 'assistant') render();

  try {
    const data = await invokePilotageAssistant({ action:'history' });
    assistantMessages = Array.isArray(data.messages) ? data.messages : [];
    assistantStatus = {
      configured: Boolean(data.configured),
      model: data.model || 'gpt-5.6',
      error: ''
    };
    assistantHistoryLoaded = true;
    trace(TAGS.AI_CHAT_UI, 'Historique ChatGPT Pilotage chargé', { count:assistantMessages.length });
  } catch (error) {
    assistantStatus.error = error.message || 'Historique ChatGPT indisponible.';
    trace(TAGS.AI_CHAT_UI, 'Erreur chargement historique ChatGPT', { message:assistantStatus.error });
  } finally {
    assistantHistoryLoading = false;
    if (currentPage === 'assistant') render();
  }
}

async function sendAssistantMessage(textOverride = null) {
  if (assistantLoading) return;

  const input = document.querySelector('#assistantInput');
  const message = String(textOverride ?? input?.value ?? '').trim();
  if (!message) {
    input?.focus();
    return;
  }

  const history = assistantMessages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-10)
    .map(m => ({ role:m.role, content:m.content }));

  assistantMessages.push({ role:'user', content:message, at:new Date().toISOString() });
  assistantLoading = true;
  assistantStatus.error = '';
  render();

  try {
    const data = await invokePilotageAssistant({
      action:'chat',
      message,
      history
    });

    assistantStatus.configured = data.configured !== false;
    assistantStatus.model = data.model || assistantStatus.model || 'gpt-5.6';
    assistantMessages.push({
      role:'assistant',
      content:data.reply || 'Demande traitée.',
      actions:Array.isArray(data.actions) ? data.actions : [],
      at:new Date().toISOString()
    });

    if (Array.isArray(data.actions) && data.actions.some(action => action?.ok)) {
      assistantNeedsRefresh = true;
    }

    assistantHistoryLoaded = true;
    trace(TAGS.AI_TOOL_EXECUTION, 'Réponse ChatGPT Pilotage reçue', {
      requestId:data.requestId || null,
      actions:Array.isArray(data.actions) ? data.actions.length : 0
    });
  } catch (error) {
    if (error.code === 'openai_not_configured') assistantStatus.configured = false;
    assistantStatus.error = error.message || 'ChatGPT Pilotage est momentanément indisponible.';
    assistantMessages.push({
      role:'system',
      content:assistantStatus.error,
      at:new Date().toISOString()
    });
  } finally {
    assistantLoading = false;
    render();
    requestAnimationFrame(() => {
      document.querySelector('#assistantInput')?.focus();
      document.querySelector('.pilot-ai-thread')?.scrollTo?.({ top:999999, behavior:'smooth' });
    });
  }
}

function renderAssistant() {
  const configured = assistantStatus.configured;
  const statusClass = assistantStatus.error ? 'error' : configured === false ? 'warning' : configured === true ? 'ok' : 'neutral';
  const statusText = assistantStatus.error
    ? assistantStatus.error
    : configured === false
      ? 'Connecteur installé. Il reste à ajouter la clé API OpenAI dans les secrets Supabase.'
      : configured === true
        ? `Connecté · ${assistantStatus.model || 'OpenAI'} · contexte Pilotage sécurisé par RLS`
        : 'Vérification du connecteur ChatGPT Pilotage…';

  const quickPrompts = [
    'Quels sont les blocages actuels et les prochaines actions ?',
    'Résume-moi la situation des projets auxquels j’ai accès.',
    'Quelles sont mes priorités aujourd’hui ?',
    'Prépare un brouillon de mon compte rendu du jour avec les données disponibles.'
  ];

  return `
    <style>
      .pilot-ai-shell{display:grid;grid-template-columns:minmax(0,1fr) 290px;gap:16px;align-items:start}
      .pilot-ai-card{border:1px solid var(--border);border-radius:14px;background:#fff;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,.04)}
      .pilot-ai-status{display:flex;gap:9px;align-items:center;margin:0 0 14px;padding:11px 13px;border-radius:10px;font-size:11px;font-weight:700}
      .pilot-ai-status.ok{background:#ecfdf5;color:#166534;border:1px solid #bbf7d0}.pilot-ai-status.warning{background:#fff7ed;color:#9a3412;border:1px solid #fed7aa}.pilot-ai-status.error{background:#fef2f2;color:#b91c1c;border:1px solid #fecaca}.pilot-ai-status.neutral{background:#f8fafc;color:#475569;border:1px solid #e2e8f0}
      .pilot-ai-thread{min-height:390px;max-height:58vh;overflow:auto;padding:18px;background:linear-gradient(180deg,#f8fbff,#fff)}
      .pilot-ai-empty{min-height:350px;display:grid;place-items:center;text-align:center;color:var(--muted);padding:30px}.pilot-ai-empty span{display:grid;place-items:center;margin:0 auto 12px;width:54px;height:54px;border-radius:15px;background:#eff6ff;color:#2563eb;font-size:26px}.pilot-ai-empty strong{display:block;color:#17345f;font-size:15px}.pilot-ai-empty p{max-width:450px;line-height:1.55}
      .pilot-ai-message{display:flex;gap:9px;margin:0 0 13px;align-items:flex-start}.pilot-ai-message.pilot-ai-user{flex-direction:row-reverse}.pilot-ai-avatar{width:30px;height:30px;flex:0 0 auto;border-radius:9px;display:grid;place-items:center;background:#e0ecff;color:#1d4ed8;font-size:11px;font-weight:900}.pilot-ai-user .pilot-ai-avatar{background:#dbeafe}.pilot-ai-system .pilot-ai-avatar{background:#fee2e2;color:#b91c1c}
      .pilot-ai-bubble{max-width:min(76%,720px);padding:10px 12px;border:1px solid #dbeafe;border-radius:11px;background:#fff}.pilot-ai-user .pilot-ai-bubble{background:#2563eb;color:#fff;border-color:#2563eb}.pilot-ai-system .pilot-ai-bubble{background:#fff7ed;border-color:#fed7aa}.pilot-ai-bubble small{display:block;margin-bottom:4px;font-size:9px;font-weight:900;opacity:.7;letter-spacing:.04em;text-transform:uppercase}.pilot-ai-bubble p{margin:0;font-size:12px;line-height:1.55}.pilot-ai-action-count{display:inline-flex;margin-top:7px;padding:3px 7px;border-radius:999px;background:#ecfdf5;color:#15803d;font-size:9px;font-weight:800}
      .pilot-ai-compose{padding:13px;border-top:1px solid var(--border);background:#fff}.pilot-ai-compose textarea{width:100%;min-height:76px;max-height:180px;resize:vertical;border:1px solid #cbd5e1;border-radius:10px;padding:11px 12px;font:inherit;line-height:1.45}.pilot-ai-compose textarea:focus{outline:none;border-color:#60a5fa;box-shadow:0 0 0 3px rgba(37,99,235,.08)}.pilot-ai-compose footer{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:9px}.pilot-ai-compose footer small{color:var(--muted);font-size:10px}
      .pilot-ai-side{display:grid;gap:12px}.pilot-ai-side-card{border:1px solid var(--border);border-radius:12px;background:#fff;padding:14px}.pilot-ai-side-card h3{margin:0 0 9px;font-size:12px}.pilot-ai-prompts{display:grid;gap:7px}.pilot-ai-prompts button{border:1px solid #dbeafe;background:#f8fbff;border-radius:9px;padding:9px 10px;text-align:left;color:#1e3a5f;font-size:10px;line-height:1.4}.pilot-ai-prompts button:hover{background:#eff6ff;border-color:#93c5fd}.pilot-ai-rules{margin:0;padding-left:17px;color:#475569;font-size:10px;line-height:1.55}.pilot-ai-refresh{width:100%;margin-top:9px}
      .pilot-ai-config{margin-top:8px;font-size:10px;line-height:1.45;color:#7c2d12}
      @media(max-width:900px){.pilot-ai-shell{grid-template-columns:1fr}.pilot-ai-side{grid-template-columns:1fr 1fr}.pilot-ai-thread{max-height:50vh}.pilot-ai-bubble{max-width:86%}}
      @media(max-width:620px){.pilot-ai-side{grid-template-columns:1fr}.pilot-ai-thread{padding:12px;min-height:330px}.pilot-ai-bubble{max-width:90%}.pilot-ai-compose footer{align-items:stretch;flex-direction:column}.pilot-ai-compose .primary-btn{width:100%}}
    </style>
    ${pageHeader('ChatGPT Pilotage', 'Assistant opérationnel relié aux données réelles de Pilotage')}
    <div class="pilot-ai-status ${statusClass}"><span>✦</span><span>${esc(statusText)}</span></div>
    <div class="pilot-ai-shell">
      <section class="pilot-ai-card">
        <div class="pilot-ai-thread">
          ${assistantHistoryLoading && !assistantMessages.length
            ? '<div class="pilot-ai-empty"><div><span>✦</span><strong>Chargement de l’historique…</strong></div></div>'
            : assistantMessages.length
              ? assistantMessages.map(assistantMessageHtml).join('')
              : '<div class="pilot-ai-empty"><div><span>✦</span><strong>ChatGPT Pilotage est prêt.</strong><p>Il peut analyser tes projets et tâches, créer ou modifier des tâches, mettre à jour les projets et préparer un brouillon de compte rendu.</p></div></div>'}
          ${assistantLoading ? '<article class="pilot-ai-message pilot-ai-assistant"><div class="pilot-ai-avatar">✦</div><div class="pilot-ai-bubble"><small>ChatGPT Pilotage</small><p>Analyse en cours…</p></div></article>' : ''}
        </div>
        <div class="pilot-ai-compose">
          <textarea id="assistantInput" maxlength="6000" placeholder="Ex. Crée une tâche urgente pour Guillaume sur le projet test v14…"></textarea>
          <footer>
            <small>Entrée pour envoyer · Maj+Entrée pour une nouvelle ligne</small>
            <button class="primary-btn" id="assistantSend" ${assistantLoading ? 'disabled' : ''}>${assistantLoading ? 'En cours…' : 'Envoyer'}</button>
          </footer>
        </div>
      </section>
      <aside class="pilot-ai-side">
        <section class="pilot-ai-side-card">
          <h3>Demandes rapides</h3>
          <div class="pilot-ai-prompts">${quickPrompts.map(prompt => `<button data-assistant-prompt="${esc(prompt)}">${esc(prompt)}</button>`).join('')}</div>
        </section>
        <section class="pilot-ai-side-card">
          <h3>Garde-fous actifs</h3>
          <ul class="pilot-ai-rules">
            <li>Droits Supabase de l’utilisateur connecté.</li>
            <li>Aucune donnée critique inventée.</li>
            <li>Clôture projet soumise à validation humaine.</li>
            <li>Compte rendu IA créé uniquement en brouillon.</li>
            <li>Historique des demandes dans <code>ai_requests</code>.</li>
          </ul>
          ${assistantNeedsRefresh ? '<button class="secondary-btn pilot-ai-refresh" id="assistantRefreshData">↻ Actualiser les données Pilotage</button>' : ''}
          <button class="secondary-btn pilot-ai-refresh" id="assistantReloadHistory">Recharger l’historique</button>
          ${configured === false ? '<p class="pilot-ai-config">La clé OpenAI reste exclusivement dans les secrets de l’Edge Function Supabase, jamais dans GitHub ni dans le navigateur.</p>' : ''}
        </section>
      </aside>
    </div>`;
}


// PILOT-AI-024..027 / PILOT-UI-044 — remontées structurées des IA externes.
function aiEventsForDate(reportDate = currentDateKey()) {
  return (state.aiEvents || [])
    .filter(event => dateKey(event.happenedAt) === reportDate)
    .sort((a,b) => new Date(b.happenedAt) - new Date(a.happenedAt));
}

function aiEventsForAgent(agentId, reportDate = currentDateKey()) {
  return aiEventsForDate(reportDate).filter(event => event.sourceAgent === agentId);
}

function aiEventTypeLabel(type) {
  return ({
    work_done:'Travail réalisé',
    task_created:'Tâche créée',
    task_updated:'Tâche mise à jour',
    task_completed:'Tâche terminée',
    project_progress:'Progression projet',
    blocker:'Blocage',
    next_step:'Prochaine étape',
    decision:'Décision',
    note:'Note'
  })[type] || type || 'Événement';
}

function aiConnectorStatus(agent, reportDate = currentDateKey()) {
  const events = aiEventsForAgent(agent.id, reportDate);
  const last = agent.lastSeenAt || events[0]?.receivedAt || events[0]?.happenedAt || null;
  const today = last && dateKey(last) === currentDateKey();
  if (events.length) return { tone:'ok', label:`${events.length} remontée${events.length > 1 ? 's' : ''} ce jour`, last };
  if (today) return { tone:'ok', label:'Connecteur actif aujourd’hui', last };
  if (last) return { tone:'warning', label:`Dernière remontée ${formatDate(last)}`, last };
  return { tone:'neutral', label:'En attente de connexion', last:null };
}

function renderAiIngestPanel() {
  const scopeIds = new Set(visibleReportMembers().map(member => member.id));
  const agents = activeAiAgents().filter(agent => scopeIds.has(agent.personId));
  const dayEvents = aiEventsForDate(dailyReportDate).filter(event => scopeIds.has(event.personId));
  const latest = dayEvents.slice(0, 8);

  return `<section class="section ai-ingest-panel">
    <div class="section-title">
      <div><h2>Remontées IA · ${esc(formatDate(dailyReportDate))}</h2><small>Événements envoyés automatiquement par les agents connectés</small></div>
      <span class="owner-pill">${dayEvents.length} événement${dayEvents.length > 1 ? 's' : ''}</span>
    </div>
    <div class="ai-ingest-grid">
      ${agents.map(agent => {
        const events = aiEventsForAgent(agent.id, dailyReportDate);
        const completed = events.filter(event => event.eventType === 'task_completed').length;
        const blockers = events.filter(event => event.eventType === 'blocker').length;
        const status = aiConnectorStatus(agent, dailyReportDate);
        return `<article class="ai-ingest-card">
          <header><div><strong>${esc(agent.name)} · ${esc(teamName(agent.personId))}</strong><small>${esc(agent.provider || 'IA')}</small></div><span class="ai-source-status ${status.tone}">${esc(status.label)}</span></header>
          <div class="ai-ingest-stats"><span><b>${events.length}</b><small>Remontées</small></span><span><b>${completed}</b><small>Tâches terminées</small></span><span class="${blockers ? 'stat-warning' : ''}"><b>${blockers}</b><small>Blocages</small></span></div>
          ${status.last ? `<small class="ai-ingest-last">Dernier signal : ${esc(formatDate(status.last))} ${esc(formatTime(status.last))}</small>` : '<small class="ai-ingest-last">Aucun signal reçu pour le moment.</small>'}
        </article>`;
      }).join('') || '<div class="empty-state">Aucun agent IA visible.</div>'}
    </div>
    ${latest.length ? `<div class="ai-event-feed">${latest.map(event => `<div class="ai-event-row"><span>${esc(formatTime(event.happenedAt))}</span><div><strong>${esc(aiEventTypeLabel(event.eventType))}</strong><p>${esc(event.summary)}</p><small>${esc(aiAgentLabel(event.sourceAgent))}${event.projectId ? ` · ${esc(project(event.projectId)?.name || 'Projet')}` : ''}</small></div></div>`).join('')}</div>` : '<div class="empty-line">Aucune remontée IA pour cette journée.</div>'}
  </section>`;
}

function reportSourceLabel(report) {
  if (report.source === 'manual') return 'Ajout manuel';
  return aiAgentLabel(report.sourceAgent);
}

function renderReportList(items, emptyText) {
  if (!items?.length) return `<p class="report-empty-line">${esc(emptyText)}</p>`;
  return `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
}

function renderDailyReportCard(member, reports) {
  const activeAgents = aiAgentsForPerson(member.id);
  const plannedAgents = aiAgentsForPerson(member.id, true).filter(a => a.active === false);
  if (!reports.length) return `<article class="daily-report-card report-missing">
    <header><div class="report-person"><span>${personInitials(member.name)}</span><div><strong>${esc(member.name)}</strong><small>${esc(member.role)} · ${activeAgents.length} IA active${activeAgents.length > 1 ? 's' : ''}</small></div></div><span class="report-status missing">Manquant</span></header>
    <div class="report-agent-chips">${activeAgents.map(a => `<span>${esc(a.name)}</span>`).join('')}${plannedAgents.map(a => `<span class="planned">${esc(a.name)} · prévu</span>`).join('')}</div>
    <div class="report-missing-body"><strong>Aucun compte rendu pour cette journée.</strong><small>Chaque IA active pourra envoyer son propre mini compte rendu. Pilotage les consolidera par personne.</small></div>
    <footer>${canCreateReportFor(member.id) ? `<button class="secondary-btn" data-report-new-person="${member.id}">+ Ajouter manuellement</button>` : `<span class="form-note">Saisie réservée à ${esc(member.name)} ou à la Direction.</span>`}</footer>
  </article>`;
  const consolidated = consolidatePersonDailyReports(member.id, dailyReportDate);
  const projectNames = consolidated.projectIds.map(id => project(id)?.name).filter(Boolean);
  return `<article class="daily-report-card ${consolidated.allValidated ? 'report-validated' : ''}">
    <header><div class="report-person"><span>${personInitials(member.name)}</span><div><strong>${esc(member.name)}</strong><small>${esc(member.role)} · ${reports.length} source${reports.length > 1 ? 's' : ''}</small></div></div><span class="report-status ${consolidated.allValidated ? 'validated' : 'draft'}">${consolidated.allValidated ? 'Tout validé' : `${consolidated.validatedCount}/${reports.length} validé${reports.length > 1 ? 's' : ''}`}</span></header>
    <div class="report-summary"><small>RÉSUMÉ CONSOLIDÉ</small><strong>${esc(consolidated.summary || 'Sans résumé')}</strong></div>
    <div class="report-columns">
      <section><h3>Réalisé</h3>${renderReportList(consolidated.achievements, 'Aucune réalisation renseignée.')}</section>
      <section><h3>Blocages</h3>${renderReportList(consolidated.blockers, 'Aucun blocage signalé.')}</section>
      <section><h3>Suite</h3>${renderReportList(consolidated.nextSteps, 'Aucune prochaine étape renseignée.')}</section>
    </div>
    <div class="report-source-list">
      ${reports.map(report => `<div class="report-source-row"><div class="report-source-meta"><span class="source-badge ${report.source === 'manual' ? 'manual' : 'ai'}">${esc(reportSourceLabel(report))}</span><p>${esc(report.summary || 'Sans résumé')}</p></div><div class="report-source-actions"><span class="report-status ${report.validatedAt ? 'validated' : 'draft'}">${report.validatedAt ? 'Validé' : 'À relire'}</span>${canEditReport(report) && !report.validatedAt ? `<button class="secondary-btn" data-edit-report="${report.id}">Modifier</button>` : ''}${report.validatedAt || !isAdmin() ? '' : `<button class="primary-btn" data-validate-report="${report.id}">Valider</button>`}</div></div>`).join('')}
    </div>
    ${projectNames.length ? `<div class="report-projects">${projectNames.map(name => `<span>${esc(name)}</span>`).join('')}</div>` : ''}
    <footer><small>${reports.length} compte${reports.length > 1 ? 's' : ''} rendu${reports.length > 1 ? 's' : ''} consolidé${reports.length > 1 ? 's' : ''}</small><div>${canCreateReportFor(member.id) ? `<button class="secondary-btn" data-report-new-person="${member.id}">+ Complément manuel</button>` : ''}</div></footer>
  </article>`;
}

function renderDailyReports() {
  const summary = teamDailySummary(dailyReportDate);
  const scopeMembers = visibleReportMembers();
  const members = dailyReportPersonFilter === 'all' ? scopeMembers : scopeMembers.filter(m => m.id === dailyReportPersonFilter);
  const subtitle = isAdmin() ? 'Synthèse quotidienne de l’équipe et des sources connectées' : 'Ton compte rendu quotidien et les sources qui te concernent';
  return pageHeader('Comptes rendus', subtitle, '<div class="header-actions report-header-actions"><button class="primary-btn" data-action="new-report">+ Ajouter manuellement</button></div>') + `
    <style>
      .ai-ingest-panel{margin-bottom:16px}.ai-ingest-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin:12px 0}.ai-ingest-card{border:1px solid var(--border);border-radius:11px;padding:11px;background:#fff}.ai-ingest-card header{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}.ai-ingest-card header strong{display:block;font-size:11px}.ai-ingest-card header small{color:var(--muted);font-size:9px}.ai-source-status{border-radius:999px;padding:4px 7px;font-size:8px;font-weight:900;white-space:nowrap}.ai-source-status.ok{background:#ecfdf5;color:#15803d}.ai-source-status.warning{background:#fff7ed;color:#c2410c}.ai-source-status.neutral{background:#f1f5f9;color:#64748b}.ai-ingest-stats{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px}.ai-ingest-stats span{background:#f8fafc;border-radius:8px;padding:7px;text-align:center}.ai-ingest-stats b{display:block;font-size:14px;color:#17345f}.ai-ingest-stats small{font-size:8px;color:var(--muted)}.ai-ingest-last{display:block;margin-top:8px;color:var(--muted);font-size:8px}.ai-event-feed{border-top:1px solid var(--border);margin-top:10px;padding-top:7px}.ai-event-row{display:grid;grid-template-columns:44px 1fr;gap:9px;padding:7px 0;border-bottom:1px solid #eef2f7}.ai-event-row>span{font-size:9px;font-weight:800;color:#2563eb}.ai-event-row strong{font-size:10px}.ai-event-row p{margin:2px 0;font-size:10px;line-height:1.35}.ai-event-row small{font-size:8px;color:var(--muted)}
    </style>
    <section class="report-automation-banner"><div><span>✦</span><div><strong>Collecte multi-IA active</strong><small>Chaque agent connecté peut remonter les tâches réalisées, blocages et prochaines étapes. Pilotage journalise les événements et alimente automatiquement les comptes rendus quotidiens.</small></div></div></section>
    <div class="toolbar report-toolbar"><label class="report-date-field"><span>Journée</span><input id="reportDateFilter" type="date" value="${dailyReportDate}" /></label>${isAdmin() ? `<select id="reportPersonFilter"><option value="all">Toute l’équipe</option>${scopeMembers.map(m => `<option value="${m.id}" ${dailyReportPersonFilter === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select>` : `<span class="owner-pill">${esc(teamName(state.currentUser.id))}</span>`}</div>
    ${renderAiIngestPanel()}
    <section class="team-report-summary">
      <div class="team-report-main"><span class="report-progress-ring large">${summary.received}/${summary.expected}</span><div><small>SYNTHÈSE ÉQUIPE</small><h2>${esc(summary.text)}</h2></div></div>
      <div class="team-report-stats"><span><b>${summary.achievements}</b><small>Réalisations</small></span><span class="${summary.blockers ? 'stat-warning' : ''}"><b>${summary.blockers}</b><small>Blocages</small></span><span><b>${summary.nextSteps}</b><small>Suites</small></span><span><b>${summary.sources}</b><small>Sources reçues</small></span><span class="${summary.validated === summary.sources && summary.sources ? 'stat-ok' : ''}"><b>${summary.validated}</b><small>Sources validées</small></span></div>
    </section>
    <section class="daily-report-grid">${members.map(member => renderDailyReportCard(member, dailyReportsForPerson(member.id, dailyReportDate))).join('')}</section>`;
}

function renderDailyReportModal() {
  const report = dailyReportEditId ? state.dailyReports.find(r => r.id === dailyReportEditId) : null;
  const selectedPerson = report?.personId || dailyReportPresetPersonId || state.currentUser.id;
  const selectedDate = report?.reportDate || dailyReportDate;
  const achievements = (report?.achievements || []).join('\n');
  const blockers = (report?.blockers || []).join('\n');
  const nextSteps = (report?.nextSteps || []).join('\n');
  const mainProject = report?.projectIds?.[0] || '';
  const aiLocked = report?.source === 'ai';
  const personField = aiLocked
    ? `<div class="form-field form-field-full"><span>Personne</span><div class="report-locked-source"><b>${esc(teamName(selectedPerson))}</b><small>Source liée à ${esc(reportSourceLabel(report))}</small></div><input type="hidden" id="dailyReportPerson" value="${selectedPerson}" /></div>`
    : isAdmin()
      ? `<label class="form-field form-field-full"><span>Personne</span>${teamPicker('dailyReportPerson', selectedPerson)}</label>`
      : `<div class="form-field form-field-full"><span>Personne</span><div class="report-locked-source"><b>${esc(teamName(state.currentUser.id))}</b><small>Tu peux saisir et modifier uniquement ton propre compte rendu.</small></div><input type="hidden" id="dailyReportPerson" value="${state.currentUser.id}" /></div>`;
  return `<div class="modal-backdrop" id="dailyReportBackdrop"></div><div class="modal-card report-modal" role="dialog" aria-modal="true">
    <header><div><small>${report ? 'MODIFIER' : 'AJOUT MANUEL'}</small><h2>${report ? 'Compte rendu quotidien' : 'Ajouter un compte rendu'}</h2></div><button class="icon-btn" id="closeDailyReport">×</button></header>
    <div class="form-grid">
      ${personField}
      ${report ? `<div class="form-field form-field-full"><span>Source</span><div class="report-locked-source"><b>${esc(reportSourceLabel(report))}</b><small>${report.source === 'manual' ? 'Saisie humaine' : 'Compte rendu reçu depuis un agent IA'}</small></div></div>` : ''}
      <label class="form-field"><span>Date</span><input id="dailyReportDateInput" type="date" value="${selectedDate}" /></label>
      <label class="form-field"><span>Projet principal (optionnel)</span><select id="dailyReportProject"><option value="">Aucun / plusieurs projets</option>${state.projects.filter(p => !p.archived).map(p => `<option value="${p.id}" ${mainProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="form-field form-field-full"><span>Résumé</span><textarea id="dailyReportSummary" rows="3" placeholder="Résumé très court de la journée…">${esc(report?.summary || '')}</textarea></label>
      <label class="form-field form-field-full"><span>Ce qui a été réalisé — 1 ligne par élément</span><textarea id="dailyReportAchievements" rows="4" placeholder="Ex. Module de planification terminé">${esc(achievements)}</textarea></label>
      <label class="form-field form-field-full"><span>Blocages — 1 ligne par élément</span><textarea id="dailyReportBlockers" rows="3" placeholder="Laisser vide si aucun blocage">${esc(blockers)}</textarea></label>
      <label class="form-field form-field-full"><span>Prochaines étapes — 1 ligne par élément</span><textarea id="dailyReportNextSteps" rows="3" placeholder="Ex. Tester demain matin">${esc(nextSteps)}</textarea></label>
    </div>
    <footer><button class="secondary-btn" id="cancelDailyReport">Annuler</button><button class="primary-btn" id="saveDailyReport">${report ? 'Enregistrer' : 'Ajouter le compte rendu'}</button></footer>
  </div>`;
}

function openDailyReportModal(reportId = null, personId = null) {
  if (!isAdmin()) {
    const report = reportId ? state.dailyReports.find(r => r.id === reportId) : null;
    if (report && report.personId !== state.currentUser.id) return;
    personId = state.currentUser.id;
  }
  dailyReportEditId = reportId;
  dailyReportPresetPersonId = reportId ? null : (personId || null);
  dailyReportModalOpen = true;
  if (!reportId && personId) {
    const existing = manualDailyReportForPerson(personId, dailyReportDate);
    if (existing) {
      dailyReportEditId = existing.id;
      dailyReportPresetPersonId = null;
    }
  }
  notificationOpen = false;
  quickActionOpen = false;
  trace(TAGS.REPORT_PERSON_PRESET, 'Personne préselectionnée pour le compte rendu', { personId:dailyReportPresetPersonId });
  trace(TAGS.REPORT_MODAL, 'Ouverture compte rendu', { reportId:dailyReportEditId, personId });
  render();
}

function closeDailyReportModal() {
  dailyReportModalOpen = false;
  dailyReportEditId = null;
  dailyReportPresetPersonId = null;
  render();
}

function saveDailyReportFromForm() {
  const personId = document.querySelector('#dailyReportPerson')?.value || state.currentUser.id;
  if (!isAdmin() && personId !== state.currentUser.id) {
    window.alert('Tu peux enregistrer uniquement ton propre compte rendu.');
    return;
  }
  const reportDate = document.querySelector('#dailyReportDateInput')?.value || dailyReportDate;
  const summaryInput = document.querySelector('#dailyReportSummary');
  const summary = summaryInput?.value.trim() || '';
  if (!summary) { summaryInput?.classList.add('field-error'); summaryInput?.focus(); return; }
  const projectId = document.querySelector('#dailyReportProject')?.value || null;
  const payload = {
    reportDate, personId, summary,
    achievements: splitReportLines(document.querySelector('#dailyReportAchievements')?.value || ''),
    blockers: splitReportLines(document.querySelector('#dailyReportBlockers')?.value || ''),
    nextSteps: splitReportLines(document.querySelector('#dailyReportNextSteps')?.value || ''),
    projectIds: projectId ? [projectId] : [], updatedAt:new Date().toISOString()
  };
  let report = dailyReportEditId ? state.dailyReports.find(r => r.id === dailyReportEditId) : manualDailyReportForPerson(personId, reportDate);
  if (report) {
    const changedPerson = report.personId !== personId || report.reportDate !== reportDate;
    if (changedPerson && report.source === 'manual') {
      const duplicate = state.dailyReports.find(r => r.id !== report.id && r.source === 'manual' && r.personId === personId && r.reportDate === reportDate);
      if (duplicate) { window.alert('Un complément manuel existe déjà pour cette personne et cette date. Modifie celui-ci directement.'); return; }
    }
    Object.assign(report, payload);
    report.source = report.source || 'manual';
    report.status = report.validatedAt ? 'validated' : 'draft';
    addActivity({ actor:teamName(personId), projectId, text:`Compte rendu (${reportSourceLabel(report)}) du ${formatDate(reportDate)} modifié`, internalTag:TAGS.REPORT_EDIT });
    persist(TAGS.REPORT_EDIT, 'Compte rendu modifié', { reportId:report.id, personId, reportDate, sourceAgent:report.sourceAgent || null });
  } else {
    report = { id:crypto.randomUUID(), ...payload, source:'manual', sourceAgent:null, status:'draft', createdAt:new Date().toISOString(), validatedAt:null };
    state.dailyReports.unshift(report);
    addActivity({ actor:teamName(personId), projectId, text:`Complément manuel du ${formatDate(reportDate)} ajouté`, internalTag:TAGS.REPORT_MANUAL_CREATE });
    persist(TAGS.REPORT_MANUAL_CREATE, 'Compte rendu manuel créé', { reportId:report.id, personId, reportDate });
  }
  dailyReportDate = reportDate;
  dailyReportModalOpen = false;
  dailyReportEditId = null;
  dailyReportPresetPersonId = null;
  currentPage = 'reports';
  render();
}

function validateDailyReport(reportId) {
  if (!isAdmin()) return;
  const report = state.dailyReports.find(r => r.id === reportId);
  if (!report || report.validatedAt) return;
  report.validatedAt = new Date().toISOString();
  report.validatedBy = state.currentUser.id;
  report.status = 'validated';
  report.updatedAt = new Date().toISOString();
  addActivity({ actor:state.currentUser.name || teamName(state.currentUser.id), projectId:report.projectIds?.[0] || null, text:`Compte rendu de ${teamName(report.personId)} du ${formatDate(report.reportDate)} validé`, internalTag:TAGS.REPORT_VALIDATE });
  persist(TAGS.REPORT_VALIDATE, 'Compte rendu validé', { reportId, personId:report.personId, reportDate:report.reportDate });
  render();
}

function renderMore() {
  return pageHeader('Plus', 'Outils complémentaires') + `<div class="menu-list"><button data-page="assistant">ChatGPT Pilotage <span>✦</span></button><button data-page="ideas">Idées <span>💡</span></button><button data-page="reports">Comptes rendus <span>→</span></button><button data-page="documents">Documents <span>→</span></button><button data-page="activity">Activité <span>→</span></button></div>`;
}

function renderQuickActionModal() {
  const unplanned = state.tasks.find(t => t.needsPlanning && t.planningStatus === 'unplanned');
  const approval = pendingApprovals()[0];
  return `<div class="modal-backdrop" id="quickActionBackdrop"></div><div class="quick-action-modal" role="dialog" aria-modal="true">
    <header><div><small>ACTIONS RAPIDES</small><h2>Que veux-tu faire ?</h2></div><button class="icon-btn" id="closeQuickAction">×</button></header>
    <div class="quick-action-grid">
      <button data-quick-action="task"><span>✓</span><div><strong>Nouvelle tâche</strong><small>Créer et assigner rapidement</small></div></button>
      <button data-quick-action="project"><span>▦</span><div><strong>Nouveau projet</strong><small>Créer un projet complet</small></div></button>
      <button data-quick-action="idea"><span>💡</span><div><strong>Nouvelle idée</strong><small>Proposer une évolution et la soumettre au vote</small></div></button>
      <button data-quick-action="document"><span>▤</span><div><strong>Lier un document</strong><small>Référence Google Drive</small></div></button>
      <button data-quick-action="report"><span>☷</span><div><strong>Compte rendu manuel</strong><small>Ajouter le mini bilan du jour</small></div></button>
      <button data-quick-action="assistant"><span>✦</span><div><strong>ChatGPT Pilotage</strong><small>Analyser, créer ou mettre à jour</small></div></button>
      <button data-quick-action="planning" ${unplanned ? '' : 'disabled'}><span>↔</span><div><strong>Planifier le prochain élément</strong><small>${unplanned ? esc(unplanned.title) : 'Rien à planifier'}</small></div></button>
      <button data-quick-action="approval" ${approval ? '' : 'disabled'}><span>!</span><div><strong>Traiter une validation</strong><small>${approval ? esc(project(approval.projectId)?.name || 'Projet') : 'Aucune validation'}</small></div></button>
      <button data-quick-action="notifications"><span>♢</span><div><strong>Centre de notifications</strong><small>${unreadNotifications()} non lue${unreadNotifications() > 1 ? 's' : ''}</small></div></button>
    </div>
  </div>`;
}

function renderNotifications() {
  const myNotifications = state.notifications.filter(n => V21.notificationInScope(state, n));
  const active = myNotifications.filter(n => !n.resolved).filter(n => {
    if (notificationFilter === 'all') return true;
    if (notificationFilter === 'action') return n.severity === 'action';
    if (notificationFilter === 'warning') return n.severity === 'warning';
    if (notificationFilter === 'error') return n.severity === 'error';
    return true;
  });
  const actionHtml = n => {
    const canManage = canManageNotification(n);
    if (n.actionType === 'plan') return canManage ? `<button class="text-button" data-plan="${n.taskId}" data-notif-read="${n.id}">Planifier →</button>` : '<span class="form-note">Planification du profil sélectionné</span>';
    if (n.actionType === 'approval') return isAdmin() ? `<button class="text-button" data-approval="${n.changeRequestId}" data-notif-read="${n.id}">Examiner →</button>` : '<span class="form-note">En attente de la Direction</span>';
    if (n.actionType === 'edit_task') return `<button class="text-button" data-edit-task="${n.taskId}">Ouvrir la tâche →</button>`;
    if (n.actionType === 'open_project') return `<button class="text-button" data-open-project="${n.projectId}"${canManage ? ` data-notif-read="${n.id}"` : ''}>Ouvrir le projet →</button>`;
    if (n.actionType === 'retry') return canManage ? `<button class="text-button" data-retry-notif="${n.id}">Clore l’erreur →</button>` : '<span class="form-note">Consultation uniquement</span>';
    if (!canManage) return '<span class="form-note">Consultation uniquement</span>';
    return `<button class="text-button" data-notif-read="${n.id}">Marquer lu</button>`;
  };
  return `<div class="drawer-backdrop" id="drawerBackdrop"></div><aside class="notification-drawer">
    <header><div><h2>Notifications</h2><small>${myNotifications.filter(n => !n.resolved).length} active${myNotifications.filter(n => !n.resolved).length > 1 ? 's' : ''} · ${unreadNotifications()} non lue${unreadNotifications() > 1 ? 's' : ''}</small></div><button class="icon-btn" id="closeNotif">×</button></header>
    <div class="drawer-tabs">
      <button class="${notificationFilter === 'all' ? 'active' : ''}" data-notif-filter="all">Toutes</button>
      <button class="${notificationFilter === 'action' ? 'active' : ''}" data-notif-filter="action">À traiter</button>
      <button class="${notificationFilter === 'warning' ? 'active' : ''}" data-notif-filter="warning">Alertes</button>
      <button class="${notificationFilter === 'error' ? 'active' : ''}" data-notif-filter="error">Erreurs</button>
    </div>
    <div class="notification-bulk"><button class="quiet-action" id="markAllRead">Tout marquer lu</button>${pendingApprovals().length ? `<button class="text-button" id="openFirstApproval">Traiter une validation</button>` : ''}</div>
    <div class="notification-list">
      ${active.map(n => `<article class="notification-item severity-${n.severity} ${n.read ? 'is-read' : 'is-unread'}" data-notif="${n.id}"><span class="notif-dot"></span><div><div class="notif-title-line"><strong>${esc(n.title)}</strong>${Number(n.count || 1) > 1 ? `<span class="count-badge">×${n.count}</span>` : ''}</div><p>${esc(n.message)}</p><div class="notif-actions">${actionHtml(n)}${!n.read && canManageNotification(n) ? `<button class="quiet-action" data-notif-read="${n.id}">Lu</button>` : ''}${canManageNotification(n) && n.actionType !== 'approval' && n.actionType !== 'plan' && !['deadline','blocker'].includes(n.type) ? `<button class="quiet-action" data-resolve="${n.id}">Résoudre</button>` : ''}</div></div></article>`).join('') || '<div class="empty-state">Aucune notification dans ce filtre.</div>'}
    </div>
  </aside>`;
}

function renderPlanningModal(taskId) {
  const t = task(taskId);
  if (!t) return '';
  const selectedBucket = t.planningBucket || 'backlog';
  return `<div class="modal-backdrop" id="modalBackdrop"></div><div class="modal-card form-modal" role="dialog" aria-modal="true">
    <header><div><small>${t.needsPlanning ? 'NOUVEL ÉLÉMENT' : 'PLANIFICATION'}</small><h2>${t.needsPlanning ? 'Planifier cette tâche' : 'Déplacer ou dater la tâche'}</h2></div><button class="icon-btn" id="closePlan">×</button></header>
    <div class="modal-task"><strong>${esc(t.title)}</strong><span>${esc(project(t.projectId)?.name || 'Sans projet')}</span></div>
    <div class="form-grid compact-grid">
      <div class="form-field form-field-full"><span>Responsable</span>${teamPicker('planOwner', t.assignedTo)}</div>
      <label class="form-field"><span>Jour prévu (optionnel)</span><input id="planScheduledFor" type="date" value="${esc(t.scheduledFor || '')}" /></label>
      <label class="form-field"><span>Échéance (optionnelle)</span><input id="planDueAt" type="date" value="${esc(dateKey(t.dueAt))}" /></label>
    </div>
    <fieldset class="plan-options"><legend>Période Roadmap</legend>
      ${['this_week','this_month','next_3_months','later','backlog'].map(bucket => `<label><input type="radio" name="planBucket" value="${bucket}" ${bucket === selectedBucket ? 'checked' : ''}/><span>${planningLabels[bucket]}</span></label>`).join('')}
    </fieldset>
    ${t.suggestedBucket && t.needsPlanning ? `<p class="ai-suggestion">Suggestion IA : <strong>${planningLabels[t.suggestedBucket]}</strong></p>` : ''}
    <footer><button class="secondary-btn" id="cancelPlan">Annuler</button><button class="primary-btn" id="confirmPlan" data-task="${t.id}">Enregistrer</button></footer>
  </div>`;
}

function renderTaskModal() {
  const existing = taskEditId ? task(taskEditId) : null;
  const defaultProject = existing?.projectId || taskModalProjectId || '';
  const owner = existing?.assignedTo || state.currentUser.id;
  const priority = existing?.priority || 'medium';
  const status = existing?.status || 'todo';
  const bucket = existing?.planningBucket || 'this_week';
  const scheduled = existing?.scheduledFor || (!existing && currentPage === 'today' ? currentDateKey() : '');
  const due = dateKey(existing?.dueAt);
  return `<div class="modal-backdrop" id="taskModalBackdrop"></div><div class="modal-card form-modal" role="dialog" aria-modal="true">
    <header><div><small>${existing ? 'MODIFIER LA TÂCHE' : 'NOUVELLE TÂCHE'}</small><h2>${existing ? esc(existing.title) : 'Ajouter une tâche'}</h2></div><button class="icon-btn" id="closeTaskModal">×</button></header>
    ${existing?.sourceIdeaId ? `<button class="task-origin-idea" data-open-idea-origin="${esc(existing.sourceIdeaId)}">💡 Origine : idée SpeedArti →</button>` : ''}
    <div class="form-grid">
      <label class="form-field form-field-full"><span>Titre</span><input id="taskTitle" type="text" value="${esc(existing?.title || '')}" placeholder="Ex. Tester la nouvelle intégration" maxlength="120" /></label>
      <label class="form-field form-field-full"><span>Projet</span><select id="taskProject"><option value="">Sans projet</option>${state.projects.filter(p => !p.archived || p.id === defaultProject).map(p => `<option value="${p.id}" ${defaultProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <div class="form-field form-field-full"><span>Responsable — clique sur une personne</span>${teamPicker('taskOwner', owner)}</div>
      <label class="form-field"><span>Priorité</span><select id="taskPriority">${Object.entries(priorityLabels).map(([value,label]) => `<option value="${value}" ${value === priority ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="form-field"><span>État</span><select id="taskStatus">${Object.entries(statusLabels).map(([value,label]) => `<option value="${value}" ${value === status ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <div class="form-field form-field-full"><span>Progression automatique</span>${V21.renderTaskProgress(existing || { status }, false)}<small>0 % tant que la tâche n’est pas terminée · 100 % une fois terminée.</small></div>
      <label class="form-field"><span>Période Roadmap</span><select id="taskPlanning">${['backlog','this_week','this_month','next_3_months','later'].map(value => `<option value="${value}" ${value === bucket ? 'selected' : ''}>${planningLabels[value]}</option>`).join('')}</select></label>
      <label class="form-field"><span>Jour prévu</span><input id="taskScheduledFor" type="date" value="${esc(scheduled)}" /></label>
      <label class="form-field"><span>Échéance</span><input id="taskDueAt" type="date" value="${esc(due)}" /></label>
    </div>
    <footer><button class="secondary-btn" id="cancelTaskModal">Annuler</button><button class="primary-btn" id="saveTask">${existing ? 'Enregistrer' : 'Ajouter la tâche'}</button></footer>
  </div>`;
}

function renderProjectModal() {
  const existing = projectEditId ? project(projectEditId) : null;
  const parent = existing?.parentProjectId ? project(existing.parentProjectId) : project(projectModalParentId);
  const owner = existing?.owner || parent?.owner || state.currentUser.id;
  const priority = existing?.priority || 'medium';
  const status = existing?.status || 'in_progress';
  const hasChildren = existing ? projectHasChildren(existing.id) : false;
  const progress = Number(existing?.progress || 0);
  const defaultMembers = existing
    ? projectMemberIds(existing)
    : parent
      ? projectMemberIds(parent)
      : [owner];

  return `<div class="modal-backdrop" id="projectModalBackdrop"></div><div class="modal-card form-modal" role="dialog" aria-modal="true">
    <header>
      <div>
        <small>${existing ? 'MODIFIER LE PROJET' : parent ? 'NOUVEAU SOUS-PROJET' : 'NOUVEAU PROJET'}</small>
        <h2>${existing ? esc(existing.name) : parent ? `Créer dans ${esc(parent.name)}` : 'Créer un projet'}</h2>
      </div>
      <button class="icon-btn" id="closeProjectModal">×</button>
    </header>

    <div class="form-grid">
      ${parent ? `
        <div class="form-field form-field-full project-parent-location">
          <span>Emplacement</span>
          <div><b>📁</b><strong>${esc(parent.name)}</strong><small>Sous-projet · niveau ${projectDepthLocal(parent.id) + 2}/3</small></div>
        </div>`
        : existing ? `
        <div class="form-field form-field-full project-parent-location">
          <span>Emplacement</span>
          <div><b>${existing.parentProjectId ? '📁' : '▣'}</b><strong>${esc(existing.parentProjectId ? project(existing.parentProjectId)?.name || 'Projet parent' : 'Niveau principal')}</strong><small>Pour changer l’emplacement, utilise le glisser-déposer dans la liste Projets.</small></div>
        </div>` : ''}

      <label class="form-field form-field-full"><span>Nom du projet</span><input id="projectName" type="text" value="${esc(existing?.name || '')}" placeholder="Ex. Module SAV fournisseurs" maxlength="120" /></label>

      <div class="form-field form-field-full">
        <span>Responsable</span>
        ${isAdmin()
          ? teamPicker('projectOwner', owner)
          : `<input type="hidden" id="projectOwner" value="${state.currentUser.id}" /><div class="owner-pill">${esc(teamName(state.currentUser.id))}</div>`}
      </div>

      ${isAdmin()
        ? `<div class="form-field form-field-full"><span>Participants — plusieurs choix possibles</span>${projectMemberPicker(defaultMembers, owner)}<p class="form-note">Le responsable est toujours inclus automatiquement. Un sous-projet peut conserver la même équipe que son projet parent.</p></div>`
        : existing
          ? `<div class="form-field form-field-full"><span>Participants</span><div>${projectMemberIds(existing).map(id => `<span class="owner-pill">${esc(teamName(id))}</span>`).join(' ')}</div><p class="form-note">La composition de l’équipe projet est gérée par la Direction.</p></div>`
          : ''}

      <label class="form-field"><span>Priorité</span><select id="projectPriority">${Object.entries(priorityLabels).map(([value,label]) => `<option value="${value}" ${value === priority ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="form-field"><span>État</span><select id="projectStatus">${Object.entries(statusLabels).filter(([value]) => existing || value !== 'completed').map(([value,label]) => `<option value="${value}" ${value === status ? 'selected' : ''}>${label}</option>`).join('')}</select></label>

      <div class="form-field form-field-full range-field range-field-automatic">
        <span>Progression <output>${progress} %</output></span>
        <div class="progress large"><i style="width:${progress}%"></i></div>
        <small>Calcul automatique à partir des tâches du projet et de ses sous-projets. La valeur n’est jamais saisie manuellement.</small>
      </div>

      <label class="form-field form-field-full"><span>Blocage actuel</span><input id="projectBlocker" type="text" value="${esc(existing?.blocker || '')}" placeholder="Laisser vide s’il n’y a aucun blocage" maxlength="180" /></label>
      <label class="form-field form-field-full"><span>Prochaine action</span><input id="projectNextAction" type="text" value="${esc(existing?.nextAction || '')}" placeholder="Ex. Définir le cahier fonctionnel" maxlength="160" /></label>
    </div>

    <footer><button class="secondary-btn" id="cancelProjectModal">Annuler</button><button class="primary-btn" id="saveProject">${existing ? 'Enregistrer' : parent ? 'Créer le sous-projet' : 'Créer le projet'}</button></footer>
  </div>`;
}

function renderAiSimulationModal() {
  return `<div class="modal-backdrop" id="aiSimulationBackdrop"></div><div class="modal-card form-modal ai-demo-modal" role="dialog" aria-modal="true">
    <header><div><small>SIMULATION IA</small><h2>Tester les flux automatiques</h2></div><button class="icon-btn" id="closeAiSimulation">×</button></header>
    <div class="ai-demo-intro"><span>✦</span><p>Teste plusieurs cas réalistes : nouvelle tâche, progression automatique, blocage, demande de clôture ou erreur technique.</p></div>
    <div class="form-grid">
      <label class="form-field form-field-full"><span>Type de mise à jour</span><select id="aiMode">
        <option value="new_task">Nouvelle tâche importante → à planifier</option>
        <option value="routine_progress">Progression normale → automatique</option>
        <option value="blocker">Nouveau blocage → automatique + alerte</option>
        <option value="complete_project">Projet proposé comme terminé → validation Thibault</option>
        <option value="technical_error">Erreur technique → notification regroupée</option><option value="duplicate_request">Rejouer une requête IA → doublon ignoré</option>
      </select></label>
      <label class="form-field form-field-full"><span>Source</span><select id="aiSource">${activeAiAgents().map(agent => `<option value="${agent.id}">${esc(aiAgentLabel(agent.id))}</option>`).join('')}</select></label>
      <label class="form-field form-field-full"><span>Projet</span><select id="aiProject"><option value="">Sans projet</option>${state.projects.filter(p => !p.archived).map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
      <label class="form-field form-field-full" data-ai-section="detail"><span id="aiDetailLabel">Nouvel élément détecté</span><input id="aiTaskTitle" type="text" value="Ajouter le contrôle automatique des marges" maxlength="180" /></label>
      <label class="form-field" data-ai-section="progress"><span>Nouvelle progression</span><input id="aiProgress" type="number" min="0" max="100" step="5" value="80" /></label>
      <div class="form-field form-field-full" data-ai-section="new-task"><span>Responsable proposé</span>${teamPicker('aiOwner', state.currentUser.id)}</div>
      <label class="form-field" data-ai-section="new-task"><span>Priorité proposée</span><select id="aiPriority">${Object.entries(priorityLabels).map(([value,label]) => `<option value="${value}" ${value === 'medium' ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
      <label class="form-field form-field-full" data-ai-section="new-task"><span>Suggestion IA pour la Roadmap</span><select id="aiSuggestedBucket">${['this_week','this_month','next_3_months','later','backlog'].map(value => `<option value="${value}" ${value === 'this_month' ? 'selected' : ''}>${planningLabels[value]}</option>`).join('')}</select></label>
    </div>
    <div class="ai-demo-rule" id="aiRuleText"><strong>Règle :</strong> l’IA suggère une période, mais elle ne décide jamais à ta place.</div>
    <footer><button class="secondary-btn" id="cancelAiSimulation">Annuler</button><button class="primary-btn ai-submit-btn" id="runAiSimulation">Simuler</button></footer>
  </div>`;
}

function renderApprovalModal(requestId) {
  const request = state.changeRequests.find(r => r.id === requestId);
  const p = request ? project(request.projectId) : null;
  if (!request || !p) return '';
  return `<div class="modal-backdrop" id="approvalBackdrop"></div><div class="modal-card approval-modal" role="dialog" aria-modal="true">
    <header><div><small>VALIDATION HUMAINE</small><h2>Passer le projet en Terminé ?</h2></div><button class="icon-btn" id="closeApproval">×</button></header>
    <div class="approval-project"><span class="status-dot status-${p.status}"></span><div><strong>${esc(p.name)}</strong><small>État actuel : ${esc(statusLabels[p.status])} · ${projectEffectiveProgress(p)} % · automatique</small></div></div>
    <div class="approval-summary"><div><small>Demandé par</small><strong>${esc(memberLabel(request.requestedByMemberId || request.requestedBy))}</strong></div><div><small>Action proposée</small><strong>Terminé · 100 %</strong></div></div>
    ${request.note ? `<p class="approval-note">${esc(request.note)}</p>` : ''}
    <p class="form-note">La progression peut évoluer automatiquement, mais le passage officiel du projet en <strong>Terminé</strong> demande une décision humaine.</p>
    <footer>${isAdmin() ? `<button class="danger-ghost-btn" id="rejectApproval" data-request="${request.id}">Refuser</button><button class="primary-btn" id="approveApproval" data-request="${request.id}">Valider le passage en Terminé</button>` : `<span class="form-note">Décision réservée à la Direction.</span>`}</footer>
  </div>`;
}

function renderDocumentModal() {
  return `<div class="modal-backdrop" id="documentModalBackdrop"></div><div class="modal-card form-modal" role="dialog" aria-modal="true">
    <header><div><small>RÉFÉRENCE DRIVE</small><h2>Lier un document</h2></div><button class="icon-btn" id="closeDocumentModal">×</button></header>
    <div class="form-grid">
      <label class="form-field form-field-full"><span>Nom</span><input id="documentName" type="text" placeholder="Ex. Cahier fonctionnel V2" maxlength="140" /></label>
      <label class="form-field form-field-full"><span>Projet</span><select id="documentProject">${isAdmin() ? '<option value="">Sans projet</option>' : '<option value="">Sélectionner un projet</option>'}${state.projects.map(p => `<option value="${p.id}" ${documentModalProjectId === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
      <label class="form-field"><span>Type</span><select id="documentType"><option>Document</option><option>Tableur</option><option>PDF</option><option>Plan</option></select></label>
      <label class="form-field form-field-full"><span>Lien Google Drive (optionnel)</span><input id="documentUrl" type="url" placeholder="https://drive.google.com/..." /></label>
    </div>
    <p class="form-note">Pilotage stocke uniquement la référence et le lien. Le fichier reste dans Google Drive.</p>
    <footer><button class="secondary-btn" id="cancelDocumentModal">Annuler</button><button class="primary-btn" id="saveDocument">Lier le document</button></footer>
  </div>`;
}

function renderArchiveModal(projectId) {
  const p = project(projectId);
  if (!p) return '';
  const openTasks = state.tasks.filter(t => t.projectId === projectId && t.status !== 'completed').length;
  return `<div class="modal-backdrop" id="archiveBackdrop"></div><div class="modal-card archive-modal" role="dialog" aria-modal="true">
    <header><div><small>ARCHIVAGE PROJET</small><h2>Archiver ${esc(p.name)} ?</h2></div><button class="icon-btn" id="closeArchive">×</button></header>
    <div class="archive-summary"><span>▣</span><div><strong>Le projet ne sera pas supprimé.</strong><p>Historique, tâches et documents restent conservés. Il disparaîtra seulement des vues de pilotage actives.</p></div></div>
    ${openTasks ? `<p class="archive-warning"><strong>${openTasks} tâche${openTasks > 1 ? 's' : ''} encore ouverte${openTasks > 1 ? 's' : ''}.</strong> Elles resteront attachées au projet archivé.</p>` : ''}
    <footer><button class="secondary-btn" id="cancelArchive">Annuler</button><button class="danger-solid-btn" id="confirmArchive" data-project="${p.id}">Archiver le projet</button></footer>
  </div>`;
}

function renderDeferModal(taskId) {
  const t = task(taskId);
  if (!t) return '';
  const tomorrowLabel = dateFromKey(addDaysKey(1)).toLocaleDateString('fr-FR', { day:'numeric', month:'long' });
  const nextWeekLabel = dateFromKey(nextWeekMondayKey()).toLocaleDateString('fr-FR', { day:'numeric', month:'long' });
  return `<div class="modal-backdrop" id="deferBackdrop"></div><div class="modal-card defer-modal" role="dialog" aria-modal="true">
    <header><div><small>REPORTER</small><h2>${esc(t.title)}</h2></div><button class="icon-btn" id="closeDefer">×</button></header>
    <p class="form-note">Choisis quand tu veux revoir cette tâche. L’action est enregistrée dans l’historique.</p>
    <div class="defer-options">
      <button data-defer-choice="tomorrow"><strong>Demain</strong><small>${esc(tomorrowLabel)}</small></button>
      <button data-defer-choice="next_week"><strong>Semaine prochaine</strong><small>${esc(nextWeekLabel)}</small></button>
      <button data-defer-choice="this_month"><strong>Plus tard ce mois</strong><small>Roadmap · Ce mois</small></button>
      <button data-defer-choice="backlog"><strong>À organiser</strong><small>Retirer le jour prévu</small></button>
    </div>
    <footer><button class="secondary-btn" id="cancelDefer">Annuler</button></footer>
  </div>`;
}

function renderTeamWorkloadModal() {
  const cards = state.team.map(m => {
    const tasks = state.tasks.filter(t => t.assignedTo === m.id && t.status !== 'completed' && (!t.projectId || !project(t.projectId)?.archived));
    const today = tasks.filter(t => t.scheduledFor === currentDateKey()).length;
    const overdue = tasks.filter(t => t.dueAt && new Date(t.dueAt) < new Date()).length;
    const active = tasks.filter(t => t.status === 'in_progress').length;
    const blockers = state.projects.filter(p => !p.archived && p.owner === m.id && p.blocker).length;
    return `<button class="workload-card" data-team-planning="${m.id}"><div class="workload-person"><span>${personInitials(m.name)}</span><div><strong>${esc(m.name)}</strong><small>${esc(m.role)}</small></div></div><div class="workload-stats"><span><b>${today}</b><small>Aujourd’hui</small></span><span class="${overdue ? 'stat-alert' : ''}"><b>${overdue}</b><small>Retard</small></span><span><b>${active}</b><small>En cours</small></span><span class="${blockers ? 'stat-warning' : ''}"><b>${blockers}</b><small>Blocage</small></span></div><em>Voir sa Roadmap →</em></button>`;
  }).join('');
  return `<div class="modal-backdrop" id="teamWorkloadBackdrop"></div><div class="modal-card workload-modal" role="dialog" aria-modal="true"><header><div><small>ÉQUIPE</small><h2>Charge de travail</h2></div><button class="icon-btn" id="closeTeamWorkload">×</button></header><div class="workload-list">${cards}</div><footer><button class="secondary-btn" id="cancelTeamWorkload">Fermer</button></footer></div>`;
}

function renderSearchOverlay() {
  return `<div class="modal-backdrop" id="searchBackdrop"></div><div class="search-modal"><input id="globalSearchInput" autofocus placeholder="Rechercher dans SpeedArti Pilotage…" /><div id="searchResults"><p class="search-hint">Projet, tâche, document, compte rendu ou activité.</p></div></div>`;
}

function render() {
  ensureRuntimeState();
  refreshSmartNotifications();
  let content;
  switch (currentPage) {
    case 'assistant': content = renderAssistant(); break;
    case 'planning': content = renderPlanning(); break;
    case 'projects': content = renderProjects(); break;
    case 'ideas': content = '<div id="ideasPageMount"><div class="ideas-empty">Chargement du module Idées…</div></div>'; break;
    case 'calendar': content = renderCalendar(); break;
    case 'documents': content = renderDocuments(); break;
    case 'activity': content = renderActivity(); break;
    case 'reports': content = renderDailyReports(); break;
    case 'more': content = renderMore(); break;
    default: content = renderToday();
  }
  app.innerHTML = layout(content);
  bindEvents();
  if (currentPage === 'ideas') {
    void mountIdeasPage();
  }
}

function loadExternalScript(src, marker) {
  if (marker && window[marker]) return Promise.resolve();
  const existing = [...document.scripts].find(script => script.src && script.src.includes(src.split('?')[0]));
  if (existing && existing.dataset.loaded === 'true') return Promise.resolve();

  return new Promise((resolve, reject) => {
    const script = existing || document.createElement('script');
    const onLoad = () => {
      script.dataset.loaded = 'true';
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('Impossible de charger ' + src));
    };
    const cleanup = () => {
      script.removeEventListener('load', onLoad);
      script.removeEventListener('error', onError);
    };

    script.addEventListener('load', onLoad, { once:true });
    script.addEventListener('error', onError, { once:true });

    if (!existing) {
      script.src = src;
      script.async = false;
      document.body.appendChild(script);
    } else if (marker && window[marker]) {
      cleanup();
      resolve();
    } else {
      // Le tag existe mais son ancien chargement n'a pas fourni le module.
      // On charge une copie versionnée pour éviter une page blanche silencieuse.
      cleanup();
      const retry = document.createElement('script');
      retry.src = src + (src.includes('?') ? '&' : '?') + 'retry=' + Date.now();
      retry.async = false;
      retry.addEventListener('load', resolve, { once:true });
      retry.addEventListener('error', () => reject(new Error('Impossible de recharger ' + src)), { once:true });
      document.body.appendChild(retry);
    }
  });
}

async function ensureIdeasAssets() {
  if (!document.querySelector('link[href*="ideas.css"]')) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = './src/ideas.css?v=20260923-4';
    document.head.appendChild(link);
  }

  if (!window.PILOTAGE_IDEAS) {
    await loadExternalScript('./src/pilotage-ideas.js?v=20260923-3', 'PILOTAGE_IDEAS');
  }
  if (!window.PILOTAGE_IDEAS_UI) {
    await loadExternalScript('./src/ideas-ui.js?v=20260923-5', 'PILOTAGE_IDEAS_UI');
  }

  if (!window.PILOTAGE_IDEAS || !window.PILOTAGE_IDEAS_UI) {
    throw new Error('Le module Idées ne s’est pas initialisé.');
  }
}

async function mountIdeasPage() {
  const mount = document.querySelector('#ideasPageMount');
  if (!mount) return;

  try {
    await ensureIdeasAssets();
    if (currentPage !== 'ideas' || !document.querySelector('#ideasPageMount')) return;

    await window.PILOTAGE_IDEAS_UI.mount({
      state,
      currentUser: state.currentUser,
      isAdmin: isAdmin(),
      profileIds: [...selectedProfileIds()],
      openProject: projectId => {
        selectedProjectId = projectId;
        currentPage = 'projects';
        render();
      },
      openTask: taskId => openTaskEditor(taskId),
      navigateIdeas: () => {
        currentPage = 'ideas';
        selectedProjectId = null;
        render();
      },
      refreshRemote: () => window.PILOTAGE_REMOTE?.refreshFromSupabase?.()
    });
  } catch (error) {
    console.error('Module Idées', error);
    const currentMount = document.querySelector('#ideasPageMount');
    if (currentMount) {
      currentMount.innerHTML = `
        <div class="ideas-error">
          <strong>Le module Idées n’a pas pu se charger</strong>
          <p>${esc(error?.message || 'Erreur inconnue')}</p>
          <button class="secondary-btn" id="retryIdeasMount">Réessayer</button>
        </div>`;
      currentMount.querySelector('#retryIdeasMount')?.addEventListener('click', mountIdeasPage);
    }
  }
}

function navigate(page) {
  currentPage = page;
  selectedProjectId = null;
  trace(TAGS.NAVIGATE, 'Navigation', { page });
  render();
  if (page === 'assistant') setTimeout(() => loadAssistantHistory(), 0);
}

function openPlanning(taskId) {
  planningTaskId = taskId;
  notificationOpen = false;
  trace(TAGS.PLAN_MODAL, 'Ouverture fenêtre de planification', { taskId });
  render();
}

function completeTask(taskId) {
  const t = task(taskId);
  if (!t) return;
  const done = t.status === 'completed';
  t.status = done ? 'todo' : 'completed';
  t.completedAt = done ? null : new Date().toISOString();
  V21.recalculateAutomaticProgress(state);
  addActivity({ projectId: t.projectId, taskId:t.id, text: `${t.title} : ${done ? 'réouverte' : 'terminée'}`, internalTag: TAGS.TASK_COMPLETE });
  persist(TAGS.TASK_COMPLETE, 'Statut tâche modifié', { taskId, status: t.status });
  render();
}

function moveTask(taskId, bucket) {
  const t = task(taskId);
  if (!t) return;
  const previous = t.planningBucket;
  t.planningBucket = bucket;
  t.planningStatus = 'planned';
  t.needsPlanning = false;
  t.sortOrder = Date.now();
  addActivity({ projectId: t.projectId, text: `${t.title} : ${planningLabels[previous]} → ${planningLabels[bucket]}`, internalTag: TAGS.PLAN_MOVE });
  persist(TAGS.PLAN_MOVE, 'Tâche déplacée dans la roadmap', { taskId, previous, bucket });
}

function resolveNotification(id) {
  const n = state.notifications.find(x => x.id === id);
  if (!n) return;
  n.read = true;
  n.resolved = true;
  n.readAt = n.readAt || new Date().toISOString();
  n.resolvedAt = new Date().toISOString();
  persist(TAGS.NOTIF_RESOLVE, 'Notification résolue', { id });
  render();
}

function retryNotification(id) {
  const n = state.notifications.find(x => x.id === id);
  if (!n) return;
  n.read = true;
  n.resolved = true;
  n.readAt = n.readAt || new Date().toISOString();
  n.resolvedAt = new Date().toISOString();
  addActivity({ actor:'Pilotage', projectId:n.projectId || null, text:`Erreur technique clôturée manuellement : ${n.title}`, internalTag:TAGS.NOTIF_RETRY });
  persist(TAGS.NOTIF_RETRY, 'Erreur technique clôturée manuellement', { id, type:n.type, groupKey:n.groupKey || null });
  render();
}

function markNotificationRead(id, shouldRender = true) {
  const n = state.notifications.find(x => x.id === id);
  if (!n) return;
  n.read = true;
  n.readAt = new Date().toISOString();
  persist(TAGS.NOTIF_READ, 'Notification lue', { id });
  if (shouldRender) render();
}

function openApproval(requestId) {
  if (!isAdmin()) return;
  const request = state.changeRequests.find(r => r.id === requestId && r.status === 'pending');
  if (!request) return;
  approvalRequestId = requestId;
  notificationOpen = false;
  state.notifications.filter(n => n.changeRequestId === requestId).forEach(n => { n.read = true; n.readAt = new Date().toISOString(); });
  trace(TAGS.APPROVAL_MODAL, 'Ouverture validation projet', { requestId, projectId:request.projectId });
  saveState(state);
  render();
}

function closeApproval() {
  approvalRequestId = null;
  render();
}

function decideApproval(requestId, approved) {
  if (!isAdmin()) return;
  const request = state.changeRequests.find(r => r.id === requestId && r.status === 'pending');
  if (!request) return;
  const p = project(request.projectId);
  if (!p) return;
  request.status = approved ? 'approved' : 'rejected';
  request.decidedAt = new Date().toISOString();
  request.decidedBy = state.currentUser.id;
  if (approved) {
    p.status = 'completed';
    if (!projectHasChildren(p.id)) {
      p.progress = 100;
      p.manualProgress = 100;
    }
    p.blocker = '';
    p.nextAction = 'Projet clôturé';
    p.updatedAt = new Date().toISOString();
    addActivity({ projectId:p.id, text:'Projet validé comme Terminé', internalTag:TAGS.PROJECT_COMPLETE_APPROVE });
    trace(TAGS.PROJECT_COMPLETE_APPROVE, 'Clôture projet approuvée', { projectId:p.id, requestId });
  } else {
    addActivity({ projectId:p.id, text:'Passage en Terminé refusé', internalTag:TAGS.PROJECT_COMPLETE_REJECT });
    trace(TAGS.PROJECT_COMPLETE_REJECT, 'Clôture projet refusée', { projectId:p.id, requestId });
  }
  state.notifications.filter(n => n.changeRequestId === requestId).forEach(n => {
    n.read = true; n.resolved = true; n.readAt = n.readAt || new Date().toISOString(); n.resolvedAt = new Date().toISOString();
  });
  const requesterId = memberIdFromIdentity(request.requestedByMemberId || request.requestedBy);
  if (requesterId && requesterId !== state.currentUser.id) {
    upsertNotification({
      recipientId:requesterId,
      severity:approved ? 'info' : 'warning',
      type:'project_decision',
      title:approved ? 'Projet clôturé' : 'Clôture refusée',
      message:`${p.name} · ${approved ? 'passage en Terminé validé' : 'la demande de clôture a été refusée'}`,
      actionType:'open_project', projectId:p.id,
      groupKey:`project-decision:${request.id}:${requesterId}`, internalTag:TAGS.NOTIF_DECISION
    });
  }
  approvalRequestId = null;
  persist(approved ? TAGS.PROJECT_COMPLETE_APPROVE : TAGS.PROJECT_COMPLETE_REJECT, 'Décision validation projet', { projectId:p.id, requestId, approved });
  render();
}


function openTaskModal(projectId = null, editId = null) {
  taskModalOpen = true;
  taskModalProjectId = projectId;
  taskEditId = editId;
  projectModalOpen = false;
  documentModalOpen = false;
  planningTaskId = null;
  notificationOpen = false;
  trace(editId ? TAGS.TASK_EDITOR : TAGS.TASK_MODAL, editId ? 'Ouverture édition tâche' : 'Ouverture formulaire tâche', { projectId, taskId: editId });
  render();
  requestAnimationFrame(() => document.querySelector('#taskTitle')?.focus());
}

function openTaskEditor(taskId) {
  const t = task(taskId);
  if (!t) return;
  openTaskModal(t.projectId || null, taskId);
}

function closeTaskModal() {
  taskModalOpen = false;
  taskModalProjectId = null;
  taskEditId = null;
  render();
}

function createTaskFromForm() {
  const title = document.querySelector('#taskTitle')?.value.trim();
  if (!title) {
    document.querySelector('#taskTitle')?.classList.add('field-error');
    document.querySelector('#taskTitle')?.focus();
    return;
  }
  const projectId = document.querySelector('#taskProject')?.value || null;
  const assignedTo = document.querySelector('#taskOwner')?.value || state.currentUser.id;
  const priority = document.querySelector('#taskPriority')?.value || 'medium';
  const status = document.querySelector('#taskStatus')?.value || 'todo';
  const planningBucket = document.querySelector('#taskPlanning')?.value || 'backlog';
  const scheduledFor = document.querySelector('#taskScheduledFor')?.value || null;
  const dueAt = toDueIso(document.querySelector('#taskDueAt')?.value || '');

  if (!taskAssigneeAllowed(projectId, assignedTo)) {
    window.alert(projectId
      ? 'Le responsable de la tâche doit faire partie des participants du projet.'
      : 'Sans projet, un membre peut créer une tâche uniquement pour lui-même. La Direction peut assigner toute l’équipe.');
    refreshTaskOwnerAvailability(projectId);
    return;
  }

  if (taskEditId) {
    const existing = task(taskEditId);
    if (!existing) return;
    const oldOwner = existing.assignedTo;
    const oldProject = existing.projectId;
    const oldScheduledFor = existing.scheduledFor || null;
    const oldDueAt = existing.dueAt || null;
    Object.assign(existing, {
      title, projectId, assignedTo, priority, status, planningBucket, scheduledFor, dueAt,
      plannedStart: scheduledFor || dateKey(dueAt) || null,
      plannedEnd: dateKey(dueAt) || scheduledFor || null,
      planningStatus: 'planned', needsPlanning: false, sortOrder: existing.sortOrder || Date.now(),
      completedAt: status === 'completed' ? (existing.completedAt || new Date().toISOString()) : null,
      updatedAt: new Date().toISOString()
    });
    V21.recalculateAutomaticProgress(state);
    addActivity({ projectId, taskId:existing.id, text: `Tâche modifiée : ${title}`, internalTag: TAGS.TASK_EDIT });
    if (oldOwner !== assignedTo) {
      addActivity({ projectId, text: `${title} assignée à ${teamName(assignedTo)}`, internalTag: TAGS.TASK_ASSIGN });
      if (assignedTo !== state.currentUser.id) {
        upsertNotification({
          recipientId:assignedTo, severity:'info', type:'task_assignment',
          title:'Tâche réassignée', message:`${title}${projectId ? ` · ${project(projectId)?.name || 'Projet'}` : ''}`,
          actionType:'edit_task', taskId:existing.id, projectId,
          groupKey:`task-assignment:${existing.id}:${assignedTo}`, internalTag:TAGS.NOTIF_ASSIGNMENT, reactivate:true
        });
      }
    }
    if (oldScheduledFor !== scheduledFor || oldDueAt !== dueAt) addActivity({ projectId, text: `Planification mise à jour : ${title}`, internalTag: TAGS.TASK_SCHEDULE });
    persist(TAGS.TASK_EDIT, 'Tâche modifiée', { taskId: existing.id, oldProject, projectId, assignedTo, planningBucket, scheduledFor, dueAt });
  } else {
    const newTask = {
      id: crypto.randomUUID(), title, projectId, assignedTo, status, priority, scheduledFor, dueAt,
      plannedStart: scheduledFor || dateKey(dueAt) || null,
      plannedEnd: dateKey(dueAt) || scheduledFor || null,
      planningStatus: 'planned', planningBucket, needsPlanning: false, sortOrder: Date.now(),
      sourceType: 'manual', createdAt: new Date().toISOString(), completedAt: status === 'completed' ? new Date().toISOString() : null
    };
    state.tasks.push(newTask);
    V21.recalculateAutomaticProgress(state);
    addActivity({ projectId, taskId:newTask.id, text: `Nouvelle tâche créée : ${title} · ${teamName(assignedTo)}`, internalTag: TAGS.TASK_CREATE });
    if (assignedTo !== state.currentUser.id) {
      upsertNotification({
        recipientId:assignedTo, severity:'info', type:'task_assignment',
        title:'Nouvelle tâche assignée', message:`${title}${projectId ? ` · ${project(projectId)?.name || 'Projet'}` : ''}`,
        actionType:'edit_task', taskId:newTask.id, projectId,
        groupKey:`task-assignment:${newTask.id}:${assignedTo}`, internalTag:TAGS.NOTIF_ASSIGNMENT
      });
    }
    persist(TAGS.TASK_CREATE, 'Tâche créée manuellement', { taskId: newTask.id, projectId, assignedTo, planningBucket, scheduledFor, dueAt });
  }
  taskModalOpen = false;
  taskModalProjectId = null;
  taskEditId = null;
  render();
}

function openProjectModal(editId = null, parentId = null) {
  projectModalOpen = true;
  projectEditId = editId;
  projectModalParentId = editId ? null : (parentId || null);
  taskModalOpen = false;
  taskEditId = null;
  documentModalOpen = false;
  documentModalProjectId = null;
  planningTaskId = null;
  notificationOpen = false;
  trace(
    editId ? TAGS.PROJECT_EDITOR : TAGS.PROJECT_MODAL,
    editId ? 'Ouverture édition projet' : parentId ? 'Ouverture création sous-projet' : 'Ouverture formulaire projet',
    { projectId: editId, parentProjectId: projectModalParentId }
  );
  render();
  requestAnimationFrame(() => document.querySelector('#projectName')?.focus());
}

function closeProjectModal() {
  projectModalOpen = false;
  projectEditId = null;
  projectModalParentId = null;
  render();
}

function createProjectFromForm() {
  const name = document.querySelector('#projectName')?.value.trim();
  if (!name) {
    document.querySelector('#projectName')?.classList.add('field-error');
    document.querySelector('#projectName')?.focus();
    return;
  }

  const owner = document.querySelector('#projectOwner')?.value || state.currentUser.id;
  const priority = document.querySelector('#projectPriority')?.value || 'medium';
  const status = document.querySelector('#projectStatus')?.value || 'in_progress';
  const blocker = document.querySelector('#projectBlocker')?.value.trim() || '';
  const nextAction = document.querySelector('#projectNextAction')?.value.trim() || 'À définir';

  if (projectEditId) {
    const existing = project(projectEditId);
    if (!existing) return;

    const hasChildren = projectHasChildren(existing.id);
    const progress = projectEffectiveProgress(existing);
    const oldOwner = existing.owner;
    const oldMembers = projectMemberIds(existing);
    const members = selectedProjectMembers(owner, oldMembers);
    const oldProgress = Number(existing.progress || 0);
    const requestedCompletion = status === 'completed' && existing.status !== 'completed';
    const savedStatus = requestedCompletion ? existing.status : status;

    Object.assign(existing, {
      name,
      owner,
      priority,
      status:savedStatus,
      progress,
      manualProgress: progress,
      blocker,
      nextAction,
      members,
      updatedAt:new Date().toISOString()
    });

    addActivity({
      projectId: existing.id,
      text: `Projet mis à jour · ${progress} % · ${statusLabels[savedStatus]}`,
      internalTag: TAGS.PROJECT_EDIT
    });

    if (requestedCompletion) {
      const request = queueProjectCompletion(existing.id, {
        sourceType:'manual',
        requestedBy:state.currentUser.name || teamName(state.currentUser.id),
        note:'Demande effectuée depuis la fiche projet'
      });
      if (request) approvalRequestId = request.id;
    }

    if (oldOwner !== owner) {
      addActivity({ projectId: existing.id, text: `Responsable projet : ${teamName(owner)}`, internalTag: TAGS.PROJECT_OWNER });
    }

    if ([...oldMembers].sort().join('|') !== [...members].sort().join('|')) {
      addActivity({ projectId: existing.id, text: `Participants projet : ${members.map(teamName).join(', ')}`, internalTag: TAGS.PROJECT_MEMBERS });
      trace(TAGS.PROJECT_MULTISELECT, 'Participants projet modifiés', { projectId:existing.id, members });
    }

    persist(TAGS.PROJECT_EDIT, 'Projet modifié', {
      projectId: existing.id,
      owner,
      members,
      priority,
      status:existing.status,
      progress:existing.progress,
      automaticProgress:true,
      blocker
    });
  } else {
    const parentId = projectModalParentId || null;
    const parent = project(parentId);

    if (parentId && (!parent || projectDepthLocal(parentId) >= 2)) {
      window.alert('Impossible de créer ce sous-projet : 3 niveaux maximum.');
      return;
    }

    const progress = 0;
    const id = crypto.randomUUID();
    const members = selectedProjectMembers(
      owner,
      parent ? projectMemberIds(parent) : [state.currentUser.id, owner]
    );
    const siblings = projectChildren(parentId);
    const treeSortOrder = Math.max(0, ...siblings.map(x => Number(x.treeSortOrder || 0))) + 1000;

    const newProject = {
      id,
      name,
      owner,
      members,
      status,
      priority,
      progress,
      manualProgress:progress,
      parentProjectId:parentId,
      treeSortOrder,
      blocker,
      nextAction,
      updatedAt:new Date().toISOString()
    };

    state.projects.push(newProject);
    addActivity({
      projectId:id,
      text: parent
        ? `Nouveau sous-projet créé : ${name} · dans ${parent.name}`
        : `Nouveau projet créé : ${name}`,
      internalTag:TAGS.PROJECT_CREATE
    });
    persist(TAGS.PROJECT_CREATE, parent ? 'Sous-projet créé manuellement' : 'Projet créé manuellement', {
      projectId:id,
      parentProjectId:parentId,
      owner,
      members,
      priority,
      status
    });

    selectedProjectId = id;
    projectDetailTab = 'overview';
    currentPage = 'projects';
  }

  projectModalOpen = false;
  projectEditId = null;
  projectModalParentId = null;
  render();
}

function openProjectIdeas(projectId, createNew = false) {
  currentPage = 'ideas';
  selectedProjectId = null;
  projectDetailTab = 'overview';
  render();
  setTimeout(() => {
    if (createNew) window.PILOTAGE_IDEAS_UI?.openNewForProject?.(projectId);
    else window.PILOTAGE_IDEAS_UI?.openForProject?.(projectId);
  }, 100);
}

function openDocumentModal(projectId = null) {
  documentModalOpen = true;
  documentModalProjectId = projectId || null;
  taskModalOpen = false;
  taskEditId = null;
  projectModalOpen = false;
  projectEditId = null;
  projectModalParentId = null;
  planningTaskId = null;
  notificationOpen = false;
  trace(TAGS.DOCUMENT_MODAL, 'Ouverture liaison document Drive', { projectId:documentModalProjectId });
  render();
  requestAnimationFrame(() => document.querySelector('#documentName')?.focus());
}

function closeDocumentModal() {
  documentModalOpen = false;
  documentModalProjectId = null;
  render();
}

function createDocumentFromForm() {
  const nameInput = document.querySelector('#documentName');
  const name = nameInput?.value.trim();
  if (!name) { nameInput?.classList.add('field-error'); nameInput?.focus(); return; }
  const projectId = document.querySelector('#documentProject')?.value || null;
  if (!isAdmin() && !projectId) {
    window.alert('Sélectionne un projet auquel tu as accès pour lier ce document.');
    document.querySelector('#documentProject')?.focus();
    return;
  }
  const type = document.querySelector('#documentType')?.value || 'Document';
  const url = document.querySelector('#documentUrl')?.value.trim() || '';
  const id = crypto.randomUUID();
  state.documents.push({ id, projectId, name, type, source:'Google Drive', url });
  addActivity({ projectId, text:`Document lié : ${name}`, internalTag:TAGS.DOCUMENT_LINK });
  persist(TAGS.DOCUMENT_LINK, 'Référence Drive ajoutée', { documentId:id, projectId, type, hasUrl:Boolean(url) });
  documentModalOpen = false;
  documentModalProjectId = null;
  render();
}

function openAiSimulation() {
  aiSimulationOpen = true;
  taskModalOpen = false;
  taskEditId = null;
  projectModalOpen = false;
  projectEditId = null;
  documentModalOpen = false;
  planningTaskId = null;
  notificationOpen = false;
  trace(TAGS.AI_SIMULATION_MODAL, 'Ouverture simulation IA');
  render();
  requestAnimationFrame(() => document.querySelector('#aiTaskTitle')?.focus());
}

function closeAiSimulation() {
  aiSimulationOpen = false;
  render();
}

function syncAiSimulationFields() {
  const mode = document.querySelector('#aiMode')?.value || 'new_task';
  document.querySelectorAll('[data-ai-section="new-task"]').forEach(el => el.hidden = mode !== 'new_task');
  document.querySelectorAll('[data-ai-section="progress"]').forEach(el => el.hidden = mode !== 'routine_progress');
  const detail = document.querySelector('[data-ai-section="detail"]');
  if (detail) detail.hidden = ['complete_project','routine_progress','duplicate_request'].includes(mode);
  const label = document.querySelector('#aiDetailLabel');
  const input = document.querySelector('#aiTaskTitle');
  const rule = document.querySelector('#aiRuleText');
  if (mode === 'new_task') { if(label) label.textContent='Nouvel élément détecté'; if(input) input.value='Ajouter le contrôle automatique des marges'; if(rule) rule.innerHTML='<strong>Règle :</strong> l’IA suggère une période, mais elle ne décide jamais à ta place.'; }
  if (mode === 'blocker') { if(label) label.textContent='Blocage détecté'; if(input) input.value='Accès fournisseur indisponible'; if(rule) rule.innerHTML='<strong>Règle :</strong> un blocage opérationnel est enregistré automatiquement et remonte dans les alertes.'; }
  if (mode === 'complete_project') { if(rule) rule.innerHTML='<strong>Règle :</strong> l’IA ne peut pas terminer officiellement un projet. Une validation Thibault est obligatoire.'; }
  if (mode === 'technical_error') { if(label) label.textContent='Erreur technique'; if(input) input.value='Échec de synchronisation de la mise à jour'; if(rule) rule.innerHTML='<strong>Anti-spam :</strong> les erreurs identiques sont regroupées dans une seule notification avec un compteur.'; }
  if (mode === 'routine_progress') { if(rule) rule.innerHTML='<strong>Règle :</strong> une progression normale est appliquée automatiquement et ajoutée à l’historique.'; }
  if (mode === 'duplicate_request') { if(rule) rule.innerHTML='<strong>Anti-doublon :</strong> une requête IA déjà reçue est ignorée sans recréer de tâche ni d’action.'; }
}

function simulateAiIncoming() {
  const mode = document.querySelector('#aiMode')?.value || 'new_task';
  const source = document.querySelector('#aiSource')?.value || activeAiAgents()[0]?.id || 'chatgpt_thibault';
  if (mode === 'duplicate_request') {
    ensureRuntimeState();
    const requestId = state.aiRequests.at(-1)?.requestId || 'demo-request-duplicate-001';
    if (!state.aiRequests.some(r => r.requestId === requestId)) state.aiRequests.push({ requestId, source, receivedAt:new Date().toISOString() });
    upsertNotification({ severity:'info', type:'task_update', title:'Mise à jour IA déjà reçue', message:'La requête a été reconnue et ignorée : aucune tâche ni action n’a été créée en double.', actionType:'read', groupKey:`ai-duplicate:${requestId}`, internalTag:TAGS.AI_REQUEST_DEDUP });
    addActivity({ actor:aiSourceActor(source), projectId:null, text:'Requête IA dupliquée ignorée automatiquement', internalTag:TAGS.AI_REQUEST_DEDUP });
    persist(TAGS.AI_REQUEST_DEDUP, 'Doublon IA ignoré', { requestId, source });
    aiSimulationOpen=false; notificationOpen=true; render(); return;
  }
  const projectId = document.querySelector('#aiProject')?.value || null;
  const title = document.querySelector('#aiTaskTitle')?.value.trim() || '';
  const actor = aiSourceActor(source);
  trace(TAGS.AI_REQUEST_RECEIVED, 'Mise à jour IA reçue (simulation)', { mode, source, projectId });
  state.aiRequests.push({ requestId:crypto.randomUUID(), source, mode, receivedAt:new Date().toISOString() });

  if (mode !== 'new_task' && mode !== 'technical_error' && !projectId) {
    document.querySelector('#aiProject')?.classList.add('field-error');
    document.querySelector('#aiProject')?.focus();
    return;
  }

  if (mode === 'new_task') {
    const titleInput = document.querySelector('#aiTaskTitle');
    if (!title) { titleInput?.classList.add('field-error'); titleInput?.focus(); return; }
    const assignedTo = document.querySelector('#aiOwner')?.value || state.currentUser.id;
    const priority = document.querySelector('#aiPriority')?.value || 'medium';
    const suggestedBucket = document.querySelector('#aiSuggestedBucket')?.value || 'this_month';
    const taskId = crypto.randomUUID();
    state.tasks.push({ id:taskId, title, projectId, assignedTo, status:'todo', priority, scheduledFor:null, dueAt:null, planningStatus:'unplanned', planningBucket:'backlog', suggestedBucket, needsPlanning:true, sortOrder:Date.now(), sourceType:aiSourceType(source), sourceAgent:source, createdAt:new Date().toISOString() });
    const notification = upsertNotification({ severity:'action', type:'planning_required', title:'Nouvel élément à planifier', message:title, actionType:'plan', taskId, projectId, groupKey:`planning:${taskId}`, internalTag:TAGS.NOTIF_PLAN });
    state.activity.unshift({ id:crypto.randomUUID(), at:new Date().toISOString(), actor, projectId, text:`Nouvel élément proposé : ${title}`, internalTag:TAGS.AI_REQUEST_RECEIVED });
    trace(TAGS.PLAN_DETECT, 'Nouvel élément IA à planifier', { taskId, suggestedBucket });
    persist(TAGS.AI_REQUEST_PROCESS, 'Mise à jour IA transformée en tâche à planifier', { source, taskId, notificationId:notification.id, suggestedBucket });
    aiSimulationOpen = false; currentPage = 'planning'; planningTaskId = taskId; render(); return;
  }

  if (mode === 'routine_progress') {
    const p = project(projectId); if (!p) return;
    if (projectHasChildren(p.id)) {
      window.alert('La progression de ce projet est automatique car il contient des sous-projets.');
      return;
    }
    const previous = Number(p.progress || 0);
    const next = Math.max(0, Math.min(100, Number(document.querySelector('#aiProgress')?.value || previous)));
    p.progress = next;
    p.manualProgress = next;
    p.updatedAt = new Date().toISOString();
    addActivity({ actor, projectId, text:`Progression : ${previous} % → ${next} %`, internalTag:TAGS.AI_ROUTINE_UPDATE });
    persist(TAGS.AI_ROUTINE_UPDATE, 'Progression IA appliquée automatiquement', { source, projectId, previous, next });
    aiSimulationOpen = false; selectedProjectId = projectId; currentPage = 'projects'; render(); return;
  }

  if (mode === 'blocker') {
    const p = project(projectId); if (!p) return;
    const blocker = title || 'Blocage signalé par l’IA';
    p.blocker = blocker; p.status = 'blocked'; p.updatedAt = new Date().toISOString();
    addActivity({ actor, projectId, text:`Blocage ajouté : ${blocker}`, internalTag:TAGS.AI_BLOCKER_UPDATE });
    upsertNotification({ severity:'warning', type:'blocker', title:'Blocage projet', message:`${p.name} · ${blocker}`, actionType:'open_project', projectId, groupKey:`blocker:${projectId}`, internalTag:TAGS.NOTIF_BLOCKER, reactivate:true });
    persist(TAGS.AI_BLOCKER_UPDATE, 'Blocage IA appliqué automatiquement', { source, projectId, blocker });
    aiSimulationOpen = false; selectedProjectId = projectId; currentPage = 'projects'; render(); return;
  }

  if (mode === 'complete_project') {
    trace(TAGS.AI_COMPLETE_PROPOSAL, 'IA propose la clôture du projet', { source, projectId });
    const request = queueProjectCompletion(projectId, { sourceType:aiSourceType(source), requestedBy:actor, note:'Proposition reçue via agent IA' });
    aiSimulationOpen = false;
    if (request) approvalRequestId = request.id;
    render(); return;
  }

  if (mode === 'technical_error') {
    const message = title || 'Échec technique pendant une mise à jour IA';
    const groupKey = `tech:${source}:${projectId || 'global'}`;
    const n = upsertNotification({ severity:'error', type:'ai_error', title:'Erreur de synchronisation IA', message, actionType:'retry', projectId, groupKey, internalTag:TAGS.NOTIF_TECH_ERROR, increment:true });
    addActivity({ actor, projectId, text:`Erreur technique détectée : ${message}`, internalTag:TAGS.AI_TECH_ERROR });
    persist(TAGS.AI_TECH_ERROR, 'Erreur IA regroupée', { source, projectId, groupKey, count:n.count });
    aiSimulationOpen = false; notificationOpen = true; notificationFilter = 'error'; render();
  }
}

function advanceTaskStatus(taskId) {
  const t = task(taskId);
  if (!t) return;
  const previous = t.status;
  if (t.status === 'completed') t.status = 'todo';
  else if (['todo','paused','blocked'].includes(t.status)) t.status = 'in_progress';
  else t.status = 'completed';
  t.completedAt = t.status === 'completed' ? new Date().toISOString() : null;
  V21.recalculateAutomaticProgress(state);
  addActivity({ projectId:t.projectId, taskId:t.id, text:`${t.title} : ${statusLabels[previous]} → ${statusLabels[t.status]}`, internalTag:TAGS.TASK_STATUS_QUICK });
  persist(TAGS.TASK_STATUS_QUICK, 'Statut tâche modifié rapidement', { taskId, previous, status:t.status });
  render();
}

function openTeamPlanning(userId) {
  teamWorkloadOpen = false;
  planningFilterOwner = userId;
  currentPage = 'planning';
  selectedProjectId = null;
  trace(TAGS.TEAM_SHORTCUT, 'Ouverture planification équipe', { userId });
  render();
}

function markAllNotificationsRead() {
  const now = new Date().toISOString();
  state.notifications.filter(n => V21.notificationInScope(state, n) && canManageNotification(n) && !n.resolved && !n.read).forEach(n => { n.read=true; n.readAt=now; });
  persist(TAGS.NOTIF_BULK_READ, 'Toutes les notifications actives marquées lues', {});
  render();
}

function openQuickAction() {
  quickActionOpen = true;
  notificationOpen = false;
  trace(TAGS.QUICK_ACTION, 'Ouverture actions rapides');
  render();
}
function closeQuickAction() { quickActionOpen=false; render(); }
function runQuickAction(action) {
  const unplanned = state.tasks.find(t => t.needsPlanning && t.planningStatus === 'unplanned');
  const approval = pendingApprovals()[0];
  quickActionOpen = false;
  if (action === 'task') return openTaskModal();
  if (action === 'project') return openProjectModal();
  if (action === 'idea') {
    currentPage = 'ideas';
    selectedProjectId = null;
    render();
    return setTimeout(() => window.PILOTAGE_IDEAS_UI?.openNew?.(), 80);
  }
  if (action === 'document') return openDocumentModal();
  if (action === 'report') return openDailyReportModal();
  if (action === 'assistant') return navigate('assistant');
  if (action === 'planning' && unplanned) return openPlanning(unplanned.id);
  if (action === 'approval' && approval) return openApproval(approval.id);
  if (action === 'notifications') { notificationOpen=true; return render(); }
  render();
}

function exportDemoBackup() {
  const payload = { version:'speedarti-pilotage-demo-v9', exportedAt:new Date().toISOString(), state };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href=url; a.download='speedarti-pilotage-sauvegarde.json'; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  trace(TAGS.DEMO_BACKUP, 'Sauvegarde locale exportée');
}

function importDemoBackup() {
  const input = document.createElement('input'); input.type='file'; input.accept='application/json';
  input.addEventListener('change', async () => {
    const file=input.files?.[0]; if(!file) return;
    try {
      const parsed=JSON.parse(await file.text()); const incoming=parsed.state || parsed;
      if (!Array.isArray(incoming.projects) || !Array.isArray(incoming.tasks)) throw new Error('format');
      state=incoming; ensureRuntimeState(); saveState(state); trace(TAGS.DEMO_RESTORE, 'Sauvegarde locale restaurée'); render();
    } catch { window.alert('Cette sauvegarde n’est pas compatible avec la démo SpeedArti Pilotage.'); }
  });
  input.click();
}

function openArchiveModal(projectId) {
  archiveModalProjectId = projectId;
  trace(TAGS.ARCHIVE_MODAL, 'Ouverture confirmation archivage', { projectId });
  render();
}
function closeArchiveModal() { archiveModalProjectId = null; render(); }
function archiveProject(projectId) {
  const p = project(projectId);
  if (!p) return;
  p.archived = true;
  p.archivedAt = new Date().toISOString();
  state.changeRequests.filter(r => r.projectId === projectId && r.status === 'pending').forEach(r => { r.status='cancelled'; r.decidedAt=new Date().toISOString(); r.decisionBy=state.currentUser.id; });
  state.notifications.filter(n => !n.resolved && n.projectId === projectId).forEach(n => { n.resolved=true; n.resolvedAt=new Date().toISOString(); });
  addActivity({ projectId, text:`Projet archivé : ${p.name}`, internalTag:TAGS.PROJECT_ARCHIVE });
  persist(TAGS.PROJECT_ARCHIVE, 'Projet archivé', { projectId });
  archiveModalProjectId = null;
  projectFilter = 'archived';
  selectedProjectId = null;
  render();
}
function restoreProject(projectId) {
  const p = project(projectId);
  if (!p) return;
  p.archived = false;
  p.archivedAt = null;
  addActivity({ projectId, text:`Projet restauré : ${p.name}`, internalTag:TAGS.PROJECT_RESTORE });
  persist(TAGS.PROJECT_RESTORE, 'Projet restauré', { projectId });
  projectFilter = 'all';
  render();
}
function clearProjectBlocker(projectId) {
  const p = project(projectId);
  if (!p || !p.blocker) return;
  const previous = p.blocker;
  p.blocker = '';
  if (p.status === 'blocked') p.status = 'in_progress';
  addActivity({ projectId, text:`Blocage levé : ${previous}`, internalTag:TAGS.PROJECT_BLOCKER_CLEAR });
  persist(TAGS.PROJECT_BLOCKER_CLEAR, 'Blocage projet levé', { projectId, previous });
  refreshSmartNotifications();
  render();
}
function openDeferModal(taskId) { deferTaskId = taskId; trace(TAGS.TASK_DEFER, 'Ouverture report tâche', { taskId }); render(); }
function closeDeferModal() { deferTaskId = null; render(); }
function deferTask(choice) {
  const t = task(deferTaskId);
  if (!t) return;
  const previousDate = t.scheduledFor;
  const previousBucket = t.planningBucket;
  if (choice === 'tomorrow') { t.scheduledFor=addDaysKey(1); t.planningBucket='this_week'; }
  if (choice === 'next_week') { t.scheduledFor=nextWeekMondayKey(); t.planningBucket='this_week'; }
  if (choice === 'this_month') { t.scheduledFor=null; t.planningBucket='this_month'; }
  if (choice === 'backlog') { t.scheduledFor=null; t.planningBucket='backlog'; }
  t.plannedStart = t.scheduledFor || null;
  t.plannedEnd = t.scheduledFor || null;
  t.planningStatus='planned'; t.needsPlanning=false; t.sortOrder=Date.now();
  addActivity({ projectId:t.projectId, text:`${t.title} reportée vers ${choice === 'tomorrow' ? 'demain' : choice === 'next_week' ? 'la semaine prochaine' : choice === 'this_month' ? 'ce mois' : 'À organiser'}`, internalTag:TAGS.TASK_DEFER });
  persist(TAGS.TASK_DEFER, 'Tâche reportée', { taskId:t.id, choice, previousDate, previousBucket, scheduledFor:t.scheduledFor, planningBucket:t.planningBucket });
  deferTaskId=null;
  render();
}
function openTeamWorkload() { teamWorkloadOpen=true; trace(TAGS.TEAM_WORKLOAD, 'Vue charge équipe ouverte'); render(); }
function closeTeamWorkload() { teamWorkloadOpen=false; render(); }

async function googleRun(label, fn) {
  if (!window.PILOTAGE_GOOGLE) {
    window.alert('Le module Google n’est pas chargé.');
    return null;
  }
  googleBusy = label;
  render();
  try {
    return await fn();
  } catch (error) {
    console.error(error);
    window.alert(error?.message || 'Action Google impossible pour le moment.');
    return null;
  } finally {
    googleBusy = '';
    render();
  }
}

async function connectGoogle() {
  if (!window.PILOTAGE_GOOGLE?.connect) return window.alert('Le module Google n’est pas disponible.');
  googleBusy = 'oauth';
  render();
  try {
    await window.PILOTAGE_GOOGLE.connect();
  } catch (error) {
    googleBusy = '';
    render();
    window.alert(error?.message || 'Connexion Google impossible.');
  }
}

async function openGoogleDrivePicker() {
  googleDrivePickerOpen = true;
  googleDrivePickerBusy = true;
  googleDriveRoots = [];
  googleDriveFolders = [];
  googleDriveCurrent = null;
  googleDriveStack = [];
  render();
  try {
    const result = await window.PILOTAGE_GOOGLE.listDriveRoots();
    googleDriveRoots = result?.roots || [];
  } catch (error) {
    googleDrivePickerOpen = false;
    window.alert(error?.message || 'Impossible de lire Google Drive.');
  } finally {
    googleDrivePickerBusy = false;
    render();
  }
}

function closeGoogleDrivePicker() {
  googleDrivePickerOpen = false;
  googleDrivePickerBusy = false;
  googleDriveRoots = [];
  googleDriveFolders = [];
  googleDriveCurrent = null;
  googleDriveStack = [];
  render();
}

async function browseGoogleDriveFolder(folder) {
  if (!folder?.id) return;
  if (googleDriveCurrent) googleDriveStack.push({ ...googleDriveCurrent });
  googleDriveCurrent = {
    id: folder.id,
    name: folder.name || 'Dossier',
    driveId: folder.driveId || folder.drive_id || null,
    kind: folder.kind || 'folder'
  };
  googleDrivePickerBusy = true;
  render();
  try {
    const result = await window.PILOTAGE_GOOGLE.listDriveFolder(googleDriveCurrent.id, googleDriveCurrent.driveId);
    googleDriveFolders = (result?.folders || []).map(item => ({
      id:item.id,
      name:item.name,
      driveId:item.driveId || googleDriveCurrent.driveId || null,
      kind:'folder'
    }));
  } catch (error) {
    window.alert(error?.message || 'Impossible d’ouvrir ce dossier.');
  } finally {
    googleDrivePickerBusy = false;
    render();
  }
}

async function backGoogleDriveFolder() {
  const previous = googleDriveStack.pop() || null;
  if (!previous) {
    googleDriveCurrent = null;
    googleDriveFolders = [];
    render();
    return;
  }
  googleDriveCurrent = previous;
  googleDrivePickerBusy = true;
  render();
  try {
    const result = await window.PILOTAGE_GOOGLE.listDriveFolder(previous.id, previous.driveId);
    googleDriveFolders = (result?.folders || []).map(item => ({ id:item.id, name:item.name, driveId:item.driveId || previous.driveId || null, kind:'folder' }));
  } catch (error) {
    window.alert(error?.message || 'Impossible de revenir à ce dossier.');
  } finally {
    googleDrivePickerBusy = false;
    render();
  }
}

async function selectGoogleDriveCurrent() {
  if (!googleDriveCurrent) return;
  googleDrivePickerBusy = true;
  render();
  try {
    await window.PILOTAGE_GOOGLE.selectDriveRoot(googleDriveCurrent.id, googleDriveCurrent.driveId);
    googleDrivePickerOpen = false;
    googleDriveFolders = [];
    googleDriveCurrent = null;
    googleDriveStack = [];
    trace(TAGS.GOOGLE_DRIVE_PICKER, 'Dossier racine Google Drive sélectionné');
  } catch (error) {
    window.alert(error?.message || 'Sélection du dossier impossible.');
  } finally {
    googleDrivePickerBusy = false;
    render();
  }
}

async function syncGoogleDrive() {
  if (!window.PILOTAGE_GOOGLE?.syncDrive) return window.alert('Le module Google Drive n’est pas disponible.');
  googleBusy = 'drive-sync';
  googleDriveProgressText = 'Démarrage de la synchronisation…';
  render();
  try {
    const result = await window.PILOTAGE_GOOGLE.syncDrive(progress => {
      googleDriveProgressText = progress.done
        ? 'Synchronisation terminée : ' + progress.total + ' éléments indexés.'
        : 'Synchronisation en cours : ' + progress.total + ' éléments indexés · ' + progress.remainingFolders + ' dossiers restants.';
      const node = document.querySelector('.drive-sync-progress');
      if (node) node.textContent = googleDriveProgressText;
    });
    if (result?.ok) {
      googleDriveProgressText = 'Synchronisation terminée : ' + (result.total || result.count || 0) + ' éléments indexés.';
      trace(TAGS.GOOGLE_DRIVE_SYNC, 'Drive synchronisé', { count:result.total || result.count || 0 });
      if (window.PILOTAGE_REMOTE?.refreshFromSupabase) await window.PILOTAGE_REMOTE.refreshFromSupabase();
    }
  } catch (error) {
    console.error(error);
    googleDriveProgressText = error?.message || 'Synchronisation Drive impossible.';
    window.alert(googleDriveProgressText);
  } finally {
    googleBusy = '';
    render();
  }
}

async function refreshGoogleCalendars() {
  const result = await googleRun('calendar-list', () => window.PILOTAGE_GOOGLE.listCalendars());
  if (result?.ok) trace(TAGS.GOOGLE_CALENDAR_LIST, 'Agendas Google actualisés', { count:result.calendars?.length || 0 });
}

async function saveGoogleCalendarSelection() {
  const sources = (state.calendarSources || []).filter(source => source.ownerId === state.currentUser.id);
  const selections = sources.map(source => {
    const selectedInput = document.querySelector(`[data-google-calendar-selected="${CSS.escape(source.externalCalendarId)}"]`);
    const sharedInput = document.querySelector(`[data-google-calendar-shared="${CSS.escape(source.externalCalendarId)}"]`);
    return {
      external_calendar_id: source.externalCalendarId,
      selected: Boolean(selectedInput?.checked),
      shared_with_team: Boolean(sharedInput?.checked)
    };
  });
  const result = await googleRun('calendar-save', () => window.PILOTAGE_GOOGLE.setCalendarSelection(selections));
  if (result?.ok) trace(TAGS.GOOGLE_CALENDAR_SELECTION, 'Sélection Agenda enregistrée', { count:selections.filter(x => x.selected).length });
}

async function syncGoogleCalendars() {
  const result = await googleRun('calendar-sync', () => window.PILOTAGE_GOOGLE.syncCalendars());
  if (result?.ok) trace(TAGS.GOOGLE_CALENDAR_SYNC, 'Agendas Google synchronisés', { count:result.count || 0 });
}

async function linkDriveItemToProject(itemId, projectClientKey) {
  const result = await googleRun('drive-link', () => window.PILOTAGE_GOOGLE.linkDriveItem(itemId, projectClientKey || null));
  if (result?.ok) trace(TAGS.GOOGLE_DRIVE_PROJECT_LINK, 'Fichier Drive rattaché', { itemId, projectClientKey:projectClientKey || null });
}

function openGoogleCalendarLink(eventId) {
  googleCalendarLinkEventId = eventId;
  render();
}
function closeGoogleCalendarLink() {
  googleCalendarLinkEventId = null;
  render();
}
async function saveGoogleCalendarLink() {
  const event = state.calendarEvents.find(item => item.id === googleCalendarLinkEventId);
  if (!event) return closeGoogleCalendarLink();
  const projectId = document.querySelector('#googleCalendarProject')?.value || null;
  const taskId = document.querySelector('#googleCalendarTask')?.value || null;
  const result = await googleRun('calendar-link', () => window.PILOTAGE_GOOGLE.linkCalendarEvent(event.id, projectId, taskId));
  if (result?.ok) {
    trace(TAGS.GOOGLE_CALENDAR_PROJECT_LINK, 'Événement Agenda rattaché', { eventId:event.id, projectId, taskId });
    googleCalendarLinkEventId = null;
    render();
  }
}

async function updateTaskDatesFromGantt(taskId, startDate, endDate, mode = 'move') {
  const t = task(taskId);
  if (!t) return;

  const allowed = isAdmin()
    || t.assignedTo === state.currentUser.id
    || (t.projectId && projectMemberIds(project(t.projectId)).includes(state.currentUser.id));

  if (!allowed) {
    window.alert('Tu peux consulter cette tâche mais pas modifier sa planification.');
    return;
  }

  const label = mode === 'start' ? 'la date de début' : mode === 'end' ? 'la date de fin' : 'les dates';
  if (!window.confirm('Modifier ' + label + ' de « ' + t.title + ' » ?')) return;

  const previous = {
    plannedStart:t.plannedStart || null,
    plannedEnd:t.plannedEnd || null,
    scheduledFor:t.scheduledFor || null,
    dueAt:t.dueAt || null
  };

  t.plannedStart = startDate;
  t.plannedEnd = endDate;
  t.scheduledFor = startDate;
  t.dueAt = toDueIso(endDate);
  t.planningStatus = 'planned';
  t.needsPlanning = false;
  t.updatedAt = new Date().toISOString();

  V21.recalculateAutomaticProgress(state);
  addActivity({
    projectId:t.projectId,
    taskId:t.id,
    text:'Planification Gantt : ' + t.title + ' · ' + startDate + ' → ' + endDate,
    internalTag:TAGS.TASK_SCHEDULE
  });
  persist(TAGS.TASK_SCHEDULE, 'Dates modifiées depuis le Gantt', {
    taskId:t.id,
    previous,
    plannedStart:startDate,
    plannedEnd:endDate,
    mode
  });
  render();
}

function bindEvents() {
  V21.bindProfileSelector(state, render, ids => {
    if (planningFilterOwner !== 'all' && !ids.includes(planningFilterOwner)) planningFilterOwner = 'all';
    if (dailyReportPersonFilter !== 'all' && !ids.includes(dailyReportPersonFilter)) dailyReportPersonFilter = 'all';
    if (selectedProjectId && !V21.projectInScope(state, project(selectedProjectId))) selectedProjectId = null;
    trace('PILOT-V21-PROFILE', 'Filtre profils modifié', { profiles:ids });
  });
  V21.bindPlanningModeSwitch(render);
  if (currentPage === 'planning' && V21.getPlanningMode() === 'gantt') {
    V21.bindGantt(state, render, updateTaskDatesFromGantt);
  }

  document.querySelector('#assistantSend')?.addEventListener('click', () => sendAssistantMessage());
  document.querySelector('#assistantInput')?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendAssistantMessage();
    }
  });
  document.querySelectorAll('[data-assistant-prompt]').forEach(el => el.addEventListener('click', () => {
    const input = document.querySelector('#assistantInput');
    if (input) {
      input.value = el.dataset.assistantPrompt || '';
      input.focus();
    }
  }));
  document.querySelector('#assistantReloadHistory')?.addEventListener('click', () => loadAssistantHistory(true));
  document.querySelector('#assistantRefreshData')?.addEventListener('click', async () => {
    assistantNeedsRefresh = false;
    trace(TAGS.AI_TOOL_EXECUTION, 'Actualisation Pilotage après action ChatGPT');
    if (window.PILOTAGE_REMOTE?.refreshFromSupabase) await window.PILOTAGE_REMOTE.refreshFromSupabase();
  });

  document.querySelector('#refreshRemoteBtn')?.addEventListener('click', async e => {
    const button = e.currentTarget;
    button.disabled = true;
    button.textContent = '…';
    trace(TAGS.TEAM_REFRESH, 'Actualisation multi-utilisateur demandée');
    try {
      if (window.PILOTAGE_REMOTE?.refreshFromSupabase) {
        await window.PILOTAGE_REMOTE.refreshFromSupabase();
      } else {
        button.disabled = false;
        button.textContent = '↻';
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = '↻';
      window.alert('Actualisation impossible pour le moment.');
    }
  });
  document.querySelector('#quickCreateBtn')?.addEventListener('click', openQuickAction);
  document.querySelector('#closeQuickAction')?.addEventListener('click', closeQuickAction);
  document.querySelector('#quickActionBackdrop')?.addEventListener('click', closeQuickAction);
  document.querySelectorAll('[data-quick-action]').forEach(el => el.addEventListener('click', () => runQuickAction(el.dataset.quickAction)));
  document.querySelectorAll('[data-action="new-report"]').forEach(el => el.addEventListener('click', () => openDailyReportModal()));
  document.querySelector('#reportDateFilter')?.addEventListener('change', e => { dailyReportDate = e.target.value || currentDateKey(); trace(TAGS.REPORT_FILTER, 'Changement journée comptes rendus', { reportDate:dailyReportDate }); render(); });
  document.querySelector('#reportPersonFilter')?.addEventListener('change', e => { dailyReportPersonFilter = e.target.value || 'all'; trace(TAGS.REPORT_FILTER, 'Filtre personne comptes rendus', { personId:dailyReportPersonFilter }); render(); });
  document.querySelectorAll('[data-edit-report]').forEach(el => el.addEventListener('click', () => openDailyReportModal(el.dataset.editReport)));
  document.querySelectorAll('[data-validate-report]').forEach(el => el.addEventListener('click', () => validateDailyReport(el.dataset.validateReport)));
  document.querySelectorAll('[data-report-new-person]').forEach(el => el.addEventListener('click', () => openDailyReportModal(null, el.dataset.reportNewPerson)));
  document.querySelector('#closeDailyReport')?.addEventListener('click', closeDailyReportModal);
  document.querySelector('#cancelDailyReport')?.addEventListener('click', closeDailyReportModal);
  document.querySelector('#dailyReportBackdrop')?.addEventListener('click', closeDailyReportModal);
  document.querySelector('#saveDailyReport')?.addEventListener('click', saveDailyReportFromForm);

  document.querySelectorAll('[data-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.page)));
  document.querySelectorAll('[data-mobile-page]').forEach(el => el.addEventListener('click', () => navigate(el.dataset.mobilePage)));
  document.querySelectorAll('[data-project]').forEach(el => el.addEventListener('click', () => { selectedProjectId = el.dataset.project; projectDetailTab = 'overview'; currentPage = 'projects'; render(); }));
  document.querySelectorAll('[data-project-open]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault();
    e.stopPropagation();
    const id = el.dataset.projectOpen;
    if (!id || !project(id)) return;
    selectedProjectId = id;
    projectDetailTab = 'overview';
    currentPage = 'projects';
    render();
  }));
  document.querySelectorAll('[data-complete]').forEach(el => el.addEventListener('click', () => completeTask(el.dataset.complete)));
  document.querySelectorAll('[data-task-status]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); advanceTaskStatus(el.dataset.taskStatus); }));
  document.querySelectorAll('[data-team-planning]').forEach(el => el.addEventListener('click', () => openTeamPlanning(el.dataset.teamPlanning)));
  document.querySelector('#openTeamWorkload')?.addEventListener('click', openTeamWorkload);
  document.querySelectorAll('[data-plan]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openPlanning(el.dataset.plan); }));
  document.querySelectorAll('[data-edit-task]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openTaskEditor(el.dataset.editTask); }));
  document.querySelectorAll('[data-open-idea-origin]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault();
    const ideaId = el.dataset.openIdeaOrigin;
    taskModalOpen = false;
    taskEditId = null;
    currentPage = 'ideas';
    selectedProjectId = null;
    render();
    setTimeout(() => window.PILOTAGE_IDEAS_UI?.openIdea?.(ideaId), 80);
  }));
  document.querySelectorAll('[data-edit-project]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openProjectModal(el.dataset.editProject); }));
  document.querySelectorAll('[data-team-target]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault();
    const target = el.dataset.teamTarget;
    const input = document.querySelector(`#${target}`);
    if (input) input.value = el.dataset.teamValue;
    document.querySelectorAll(`[data-team-target="${target}"]`).forEach(x => x.classList.toggle('active', x === el));
    if (target === 'projectOwner' && isAdmin()) {
      document.querySelectorAll('[data-project-member]').forEach(memberBtn => {
        if (memberBtn.dataset.projectMember === el.dataset.teamValue) {
          memberBtn.classList.add('active');
          memberBtn.setAttribute('aria-pressed', 'true');
        }
      });
    }
    trace(TAGS.TEAM_PICKER, 'Sélection responsable', { target, userId:el.dataset.teamValue });
  }));
  document.querySelectorAll('[data-project-member]').forEach(el => el.addEventListener('click', e => {
    e.preventDefault();
    const memberId = el.dataset.projectMember;
    const ownerId = document.querySelector('#projectOwner')?.value || state.currentUser.id;
    if (memberId === ownerId && el.classList.contains('active')) {
      trace(TAGS.PROJECT_MULTISELECT, 'Responsable conservé parmi les participants', { memberId });
      return;
    }
    el.classList.toggle('active');
    el.setAttribute('aria-pressed', el.classList.contains('active') ? 'true' : 'false');
    trace(TAGS.PROJECT_MULTISELECT, 'Sélection participant projet', {
      memberId,
      selected:el.classList.contains('active')
    });
  }));
  document.querySelectorAll('[data-resolve]').forEach(el => el.addEventListener('click', () => resolveNotification(el.dataset.resolve)));
  document.querySelectorAll('[data-retry-notif]').forEach(el => el.addEventListener('click', () => retryNotification(el.dataset.retryNotif)));
  document.querySelectorAll('[data-notif-read]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); markNotificationRead(el.dataset.notifRead); }));
  document.querySelectorAll('[data-approval]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openApproval(el.dataset.approval); }));
  document.querySelectorAll('[data-open-project]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); const id=el.dataset.openProject; const notifId=el.dataset.notifRead; if(notifId) markNotificationRead(notifId, false); selectedProjectId=id; projectDetailTab='overview'; currentPage='projects'; notificationOpen=false; render(); }));
  document.querySelectorAll('[data-notif-open-filter]').forEach(el => el.addEventListener('click', () => { notificationFilter=el.dataset.notifOpenFilter || 'all'; notificationOpen=true; render(); }));

  document.querySelectorAll('[data-project-filter]').forEach(el => el.addEventListener('click', () => { projectFilter = el.dataset.projectFilter; render(); }));
  document.querySelectorAll('[data-project-toggle]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); toggleProjectTree(el.dataset.projectToggle); }));
  document.querySelectorAll('[data-project-tab]').forEach(el => el.addEventListener('click', () => { projectDetailTab = el.dataset.projectTab || 'overview'; render(); }));
  document.querySelectorAll('[data-activity-filter]').forEach(el => el.addEventListener('click', () => { activityFilter = el.dataset.activityFilter; render(); }));
  document.querySelector('#activityProjectFilter')?.addEventListener('change', e => { activityProjectFilter=e.target.value; trace(TAGS.ACTIVITY_ADVANCED, 'Filtre activité projet', { projectId:activityProjectFilter }); render(); });
  document.querySelector('#activitySearch')?.addEventListener('input', e => { activitySearch=e.target.value; trace(TAGS.ACTIVITY_ADVANCED, 'Recherche activité', { query:activitySearch }); render(); requestAnimationFrame(() => { const i=document.querySelector('#activitySearch'); if(i){ i.focus(); i.setSelectionRange(i.value.length,i.value.length); } }); });
  document.querySelectorAll('[data-notif-filter]').forEach(el => el.addEventListener('click', () => { notificationFilter = el.dataset.notifFilter; render(); }));
  document.querySelector('#markAllRead')?.addEventListener('click', markAllNotificationsRead);
  document.querySelector('#openFirstApproval')?.addEventListener('click', () => { const r=pendingApprovals()[0]; if(r) openApproval(r.id); });
  document.querySelectorAll('[data-action="quick-add"]').forEach(el => el.addEventListener('click', () => openTaskModal()));
  document.querySelectorAll('[data-action="add-project-task"]').forEach(el => el.addEventListener('click', () => openTaskModal(el.dataset.projectId)));
  document.querySelectorAll('[data-action="new-project"]').forEach(el => el.addEventListener('click', () => openProjectModal()));
  document.querySelectorAll('[data-action="add-subproject"]').forEach(el => el.addEventListener('click', () => openProjectModal(null, el.dataset.projectId)));
  document.querySelectorAll('[data-action="link-document"]').forEach(el => el.addEventListener('click', () => openDocumentModal()));
  document.querySelectorAll('[data-action="link-project-document"]').forEach(el => el.addEventListener('click', () => openDocumentModal(el.dataset.projectId)));
  document.querySelectorAll('[data-action="open-project-ideas"]').forEach(el => el.addEventListener('click', () => openProjectIdeas(el.dataset.projectId, false)));
  document.querySelectorAll('[data-action="add-project-idea"]').forEach(el => el.addEventListener('click', () => openProjectIdeas(el.dataset.projectId, true)));

  document.querySelector('#planningProjectFilter')?.addEventListener('change', e => { planningFilterProject = e.target.value; render(); });
  document.querySelector('#planningOwnerFilter')?.addEventListener('change', e => { planningFilterOwner = e.target.value; render(); });
  document.querySelector('#planningPriorityFilter')?.addEventListener('change', e => { planningFilterPriority = e.target.value; render(); });
  document.querySelectorAll('[data-mobile-bucket]').forEach(el => el.addEventListener('click', () => { mobilePlanningBucket = el.dataset.mobileBucket; trace(TAGS.MOBILE_PLAN_ACTION, 'Période Roadmap mobile', { bucket:mobilePlanningBucket }); render(); }));
  document.querySelectorAll('[data-calendar-view]').forEach(el => el.addEventListener('click', () => { calendarView = el.dataset.calendarView; trace(TAGS.CALENDAR_VIEW, 'Vue agenda', { view:calendarView }); render(); }));
  document.querySelector('#documentSearch')?.addEventListener('input', e => { documentSearch = e.target.value; trace(TAGS.DOCUMENT_FILTER, 'Recherche document', { query:documentSearch }); render(); requestAnimationFrame(() => { const input=document.querySelector('#documentSearch'); if(input){ input.focus(); input.setSelectionRange(input.value.length,input.value.length); } }); });
  document.querySelector('#documentProjectFilter')?.addEventListener('change', e => { documentProjectFilter = e.target.value; trace(TAGS.DOCUMENT_FILTER, 'Filtre document projet', { projectId:documentProjectFilter }); render(); });
  document.querySelectorAll('[data-open-doc]').forEach(el => el.addEventListener('click', () => { const d=allDocumentRefs().find(x=>x.id===el.dataset.openDoc); if(d?.url) window.open(d.url, '_blank', 'noopener'); }));
  document.querySelectorAll('[data-open-url]').forEach(el => el.addEventListener('click', () => { const url=el.dataset.openUrl; if(url) window.open(url, '_blank', 'noopener'); }));
  document.querySelectorAll('[data-drive-project]').forEach(el => el.addEventListener('change', () => linkDriveItemToProject(el.dataset.driveProject, el.value || null)));

  document.querySelector('#googleConnectDrive')?.addEventListener('click', connectGoogle);
  document.querySelector('#googleConnectCalendar')?.addEventListener('click', connectGoogle);
  document.querySelector('#googleDriveChoose')?.addEventListener('click', openGoogleDrivePicker);
  document.querySelector('#googleDriveSync')?.addEventListener('click', syncGoogleDrive);
  document.querySelector('#googleCalendarRefresh')?.addEventListener('click', refreshGoogleCalendars);
  document.querySelector('#googleCalendarSaveSelection')?.addEventListener('click', saveGoogleCalendarSelection);
  document.querySelector('#googleCalendarSync')?.addEventListener('click', syncGoogleCalendars);
  document.querySelectorAll('[data-calendar-link]').forEach(el => el.addEventListener('click', () => openGoogleCalendarLink(el.dataset.calendarLink)));

  document.querySelector('#closeGoogleDrivePicker')?.addEventListener('click', closeGoogleDrivePicker);
  document.querySelector('#cancelGoogleDrivePicker')?.addEventListener('click', closeGoogleDrivePicker);
  document.querySelector('#googleDrivePickerBackdrop')?.addEventListener('click', closeGoogleDrivePicker);
  document.querySelector('#googleDriveBack')?.addEventListener('click', backGoogleDriveFolder);
  document.querySelector('#googleDriveSelectCurrent')?.addEventListener('click', selectGoogleDriveCurrent);
  document.querySelectorAll('[data-drive-browse]').forEach(el => el.addEventListener('click', () => browseGoogleDriveFolder({ id:el.dataset.driveBrowse, name:el.dataset.driveName, driveId:el.dataset.driveId || null, kind:el.dataset.driveId ? 'shared_drive' : 'folder' })));

  document.querySelector('#closeGoogleCalendarLink')?.addEventListener('click', closeGoogleCalendarLink);
  document.querySelector('#cancelGoogleCalendarLink')?.addEventListener('click', closeGoogleCalendarLink);
  document.querySelector('#googleCalendarLinkBackdrop')?.addEventListener('click', closeGoogleCalendarLink);
  document.querySelector('#saveGoogleCalendarLink')?.addEventListener('click', saveGoogleCalendarLink);
  document.querySelector('#googleCalendarProject')?.addEventListener('change', () => {
    const select = document.querySelector('#googleCalendarTask');
    if (!select) return;
    const projectId = document.querySelector('#googleCalendarProject')?.value || null;
    const event = state.calendarEvents.find(item => item.id === googleCalendarLinkEventId);
    const tasks = state.tasks.filter(t => !projectId || t.projectId === projectId);
    select.innerHTML = `<option value="">Aucune tâche</option>${tasks.map(t => `<option value="${t.id}" ${event?.taskId === t.id ? 'selected' : ''}>${esc(t.title)}</option>`).join('')}`;
  });

  document.querySelector('#notificationBtn')?.addEventListener('click', () => { notificationOpen = !notificationOpen; trace(TAGS.NOTIFICATION_DRAWER, 'Drawer notifications', { open: notificationOpen }); render(); });
  document.querySelector('#openNotifFromToday')?.addEventListener('click', () => { notificationOpen = true; notificationFilter='action'; render(); });
  document.querySelector('#openNotifFromTodayBottom')?.addEventListener('click', () => { notificationOpen = true; notificationFilter='action'; render(); });
  document.querySelector('#closeNotif')?.addEventListener('click', () => { notificationOpen = false; render(); });
  document.querySelector('#drawerBackdrop')?.addEventListener('click', () => { notificationOpen = false; render(); });
  document.querySelector('#backProjects')?.addEventListener('click', () => { selectedProjectId = null; projectDetailTab = 'overview'; render(); });

  document.querySelector('#closePlan')?.addEventListener('click', () => { planningTaskId = null; render(); });
  document.querySelector('#cancelPlan')?.addEventListener('click', () => { planningTaskId = null; render(); });
  document.querySelector('#modalBackdrop')?.addEventListener('click', () => { planningTaskId = null; render(); });
  document.querySelector('#confirmPlan')?.addEventListener('click', e => {
    const selected = document.querySelector('input[name="planBucket"]:checked')?.value || 'backlog';
    const id = e.currentTarget.dataset.task;
    const t = task(id);
    if (!t) return;
    const previousOwner = t.assignedTo;
    const assignedTo = document.querySelector('#planOwner')?.value || t.assignedTo;
    const scheduledFor = document.querySelector('#planScheduledFor')?.value || null;
    const dueAt = toDueIso(document.querySelector('#planDueAt')?.value || '');
    moveTask(id, selected);
    t.assignedTo = assignedTo;
    t.scheduledFor = scheduledFor;
    t.dueAt = dueAt;
    t.plannedStart = scheduledFor || dateKey(dueAt) || null;
    t.plannedEnd = dateKey(dueAt) || scheduledFor || null;
    if (previousOwner !== assignedTo) addActivity({ projectId:t.projectId, text:`${t.title} assignée à ${teamName(assignedTo)}`, internalTag:TAGS.TASK_ASSIGN });
    state.notifications.filter(n => n.taskId === id).forEach(n => { n.read = true; n.resolved = true; });
    planningTaskId = null;
    persist(TAGS.PLAN_CONFIRM, 'Planification confirmée', { taskId:id, bucket:selected, assignedTo, scheduledFor, dueAt });
    render();
  });

  document.querySelector('#closeTaskModal')?.addEventListener('click', closeTaskModal);
  document.querySelector('#cancelTaskModal')?.addEventListener('click', closeTaskModal);
  document.querySelector('#taskModalBackdrop')?.addEventListener('click', closeTaskModal);
  document.querySelector('#saveTask')?.addEventListener('click', createTaskFromForm);
  document.querySelector('#taskTitle')?.addEventListener('keydown', e => { if (e.key === 'Enter') createTaskFromForm(); });
  document.querySelector('#taskProject')?.addEventListener('change', e => refreshTaskOwnerAvailability(e.target.value || null));
  if (taskModalOpen) refreshTaskOwnerAvailability(document.querySelector('#taskProject')?.value || null);

  document.querySelector('#closeProjectModal')?.addEventListener('click', closeProjectModal);
  document.querySelector('#cancelProjectModal')?.addEventListener('click', closeProjectModal);
  document.querySelector('#projectModalBackdrop')?.addEventListener('click', closeProjectModal);
  document.querySelector('#saveProject')?.addEventListener('click', createProjectFromForm);
  document.querySelector('#projectName')?.addEventListener('keydown', e => { if (e.key === 'Enter') createProjectFromForm(); });
  document.querySelector('#closeDocumentModal')?.addEventListener('click', closeDocumentModal);
  document.querySelector('#cancelDocumentModal')?.addEventListener('click', closeDocumentModal);
  document.querySelector('#documentModalBackdrop')?.addEventListener('click', closeDocumentModal);
  document.querySelector('#saveDocument')?.addEventListener('click', createDocumentFromForm);

  document.querySelector('#closeApproval')?.addEventListener('click', closeApproval);
  document.querySelector('#approvalBackdrop')?.addEventListener('click', closeApproval);
  document.querySelector('#approveApproval')?.addEventListener('click', e => decideApproval(e.currentTarget.dataset.request, true));
  document.querySelector('#rejectApproval')?.addEventListener('click', e => decideApproval(e.currentTarget.dataset.request, false));

  document.querySelectorAll('[data-archive-project]').forEach(el => el.addEventListener('click', () => openArchiveModal(el.dataset.archiveProject)));
  document.querySelectorAll('[data-restore-project]').forEach(el => el.addEventListener('click', () => restoreProject(el.dataset.restoreProject)));
  document.querySelectorAll('[data-clear-blocker]').forEach(el => el.addEventListener('click', () => clearProjectBlocker(el.dataset.clearBlocker)));
  document.querySelector('#closeArchive')?.addEventListener('click', closeArchiveModal);
  document.querySelector('#cancelArchive')?.addEventListener('click', closeArchiveModal);
  document.querySelector('#archiveBackdrop')?.addEventListener('click', closeArchiveModal);
  document.querySelector('#confirmArchive')?.addEventListener('click', e => archiveProject(e.currentTarget.dataset.project));

  document.querySelectorAll('[data-defer-task]').forEach(el => el.addEventListener('click', e => { e.stopPropagation(); openDeferModal(el.dataset.deferTask); }));
  document.querySelector('#closeDefer')?.addEventListener('click', closeDeferModal);
  document.querySelector('#cancelDefer')?.addEventListener('click', closeDeferModal);
  document.querySelector('#deferBackdrop')?.addEventListener('click', closeDeferModal);
  document.querySelectorAll('[data-defer-choice]').forEach(el => el.addEventListener('click', () => deferTask(el.dataset.deferChoice)));

  document.querySelector('#closeTeamWorkload')?.addEventListener('click', closeTeamWorkload);
  document.querySelector('#cancelTeamWorkload')?.addEventListener('click', closeTeamWorkload);
  document.querySelector('#teamWorkloadBackdrop')?.addEventListener('click', closeTeamWorkload);


  document.querySelector('#searchBtn')?.addEventListener('click', () => {
    document.body.insertAdjacentHTML('beforeend', renderSearchOverlay());
    trace(TAGS.SEARCH, 'Recherche ouverte');
    const input = document.querySelector('#globalSearchInput');
    input?.focus();
    input?.addEventListener('input', () => updateSearch(input.value));
    document.querySelector('#searchBackdrop')?.addEventListener('click', closeSearch);
  });

  bindDragAndDrop();
}

function bindDragAndDrop() {
  let draggedTask = null;

  // Roadmap : glisser-déposer des tâches (comportement existant conservé).
  document.querySelectorAll('.planning-card').forEach(card => {
    card.addEventListener('dragstart', () => {
      draggedTask = card.dataset.task;
      card.classList.add('dragging');
    });
    card.addEventListener('dragend', () => card.classList.remove('dragging'));
  });

  document.querySelectorAll('[data-dropzone]').forEach(zone => {
    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      if (draggedTask) {
        moveTask(draggedTask, zone.dataset.dropzone);
        render();
      }
    });
  });

  const clearProjectTargets = () => {
    document.querySelectorAll('.project-tree-row.drag-target, .project-drop-before.drag-target, .project-root-drop.drag-target')
      .forEach(el => el.classList.remove('drag-target'));
  };

  // Projets : le déplacement réel passe par une RPC Supabase qui contrôle
  // les boucles, les droits et la limite de 3 niveaux.
  document.querySelectorAll('[data-project-tree-row][draggable="true"]').forEach(row => {
    row.addEventListener('dragstart', e => {
      draggedProjectId = row.dataset.projectTreeRow;
      row.classList.add('dragging-project');
      try {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', draggedProjectId || '');
      } catch {}
    });

    row.addEventListener('dragend', () => {
      row.classList.remove('dragging-project');
      draggedProjectId = null;
      clearProjectTargets();
    });
  });

  document.querySelectorAll('[data-project-nest]').forEach(target => {
    target.addEventListener('dragover', e => {
      if (!draggedProjectId) return;
      const targetId = target.dataset.projectNest;
      if (!targetId || targetId === draggedProjectId) return;
      e.preventDefault();
      e.stopPropagation();
      target.classList.add('drag-target');
      try { e.dataTransfer.dropEffect = 'move'; } catch {}
    });

    target.addEventListener('dragleave', e => {
      if (!target.contains(e.relatedTarget)) target.classList.remove('drag-target');
    });

    target.addEventListener('drop', e => {
      if (!draggedProjectId) return;
      e.preventDefault();
      e.stopPropagation();
      const movingId = draggedProjectId;
      const parentId = target.dataset.projectNest;
      clearProjectTargets();
      draggedProjectId = null;
      if (movingId && parentId && movingId !== parentId) {
        void moveProjectInTree(movingId, { parentId });
      }
    });
  });

  document.querySelectorAll('[data-project-before]').forEach(zone => {
    zone.addEventListener('dragover', e => {
      if (!draggedProjectId) return;
      const beforeId = zone.dataset.projectBefore;
      if (!beforeId || beforeId === draggedProjectId) return;
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add('drag-target');
      try { e.dataTransfer.dropEffect = 'move'; } catch {}
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-target'));
    zone.addEventListener('drop', e => {
      if (!draggedProjectId) return;
      e.preventDefault();
      e.stopPropagation();
      const movingId = draggedProjectId;
      const beforeId = zone.dataset.projectBefore;
      clearProjectTargets();
      draggedProjectId = null;
      if (movingId && beforeId && movingId !== beforeId) {
        void moveProjectInTree(movingId, { beforeId });
      }
    });
  });

  const rootDrop = document.querySelector('[data-project-root-drop]');
  rootDrop?.addEventListener('dragover', e => {
    if (!draggedProjectId) return;
    e.preventDefault();
    rootDrop.classList.add('drag-target');
  });
  rootDrop?.addEventListener('dragleave', () => rootDrop.classList.remove('drag-target'));
  rootDrop?.addEventListener('drop', e => {
    if (!draggedProjectId) return;
    e.preventDefault();
    const movingId = draggedProjectId;
    clearProjectTargets();
    draggedProjectId = null;
    void moveProjectInTree(movingId, { parentId:null });
  });
}

function updateSearch(query) {
  const q = query.trim().toLowerCase();
  const target = document.querySelector('#searchResults');
  if (!target) return;
  if (!q) { target.innerHTML = '<p class="search-hint">Projet, tâche, document, compte rendu ou activité.</p>'; return; }
  const results = [
    ...state.projects.filter(x => x.name.toLowerCase().includes(q)).map(x => ({ type:'Projet', title:x.name, action:`project:${x.id}` })),
    ...state.tasks.filter(x => x.title.toLowerCase().includes(q)).map(x => ({ type:'Tâche', title:x.title, action:`task:${x.id}` })),
    ...state.documents.filter(x => x.name.toLowerCase().includes(q)).map(x => ({ type:'Document', title:x.name, action:'documents' })),
    ...state.activity.filter(x => `${x.actor || ''} ${x.text || ''}`.toLowerCase().includes(q)).map(x => ({ type:'Activité', title:x.text, action:'activity' })),
    ...state.dailyReports.filter(x => `${teamName(x.personId)} ${x.summary || ''} ${(x.achievements || []).join(' ')} ${(x.blockers || []).join(' ')}`.toLowerCase().includes(q)).map(x => ({ type:'Compte rendu', title:`${teamName(x.personId)} · ${formatDate(x.reportDate)} · ${x.summary}`, action:'reports' }))
  ].slice(0,12);
  target.innerHTML = results.length ? results.map(r => `<button class="search-result" data-search-action="${r.action}"><small>${r.type}</small><strong>${esc(r.title)}</strong></button>`).join('') : '<p class="search-hint">Aucun résultat.</p>';
  target.querySelectorAll('[data-search-action]').forEach(btn => btn.addEventListener('click', () => {
    const action = btn.dataset.searchAction;
    closeSearch();
    if (action.startsWith('project:')) { selectedProjectId = action.split(':')[1]; currentPage = 'projects'; render(); }
    else if (action.startsWith('task:')) { openTaskEditor(action.split(':')[1]); }
    else navigate(action);
  }));
}

function closeSearch() {
  document.querySelector('#searchBackdrop')?.remove();
  document.querySelector('.search-modal')?.remove();
}

render();
