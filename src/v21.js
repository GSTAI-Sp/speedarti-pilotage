const PROFILE_KEY_PREFIX = 'speedarti-pilotage-v21-profiles';
const GANTT_KEY = 'speedarti-pilotage-v21-gantt';

let profileMenuOpen = false;
let planningMode = 'roadmap';
let ganttScale = 'month';
let ganttProject = 'all';
let ganttStatus = 'all';
let ganttPriority = 'all';
let ganttSearch = '';
let ganttAnchor = new Date();

try {
  const saved = JSON.parse(localStorage.getItem(GANTT_KEY) || '{}');
  if (saved.planningMode === 'gantt' || saved.planningMode === 'roadmap') planningMode = saved.planningMode;
  if (['week','month','year','n1','n2','n3'].includes(saved.ganttScale)) ganttScale = saved.ganttScale;
  if (typeof saved.ganttProject === 'string') ganttProject = saved.ganttProject;
  if (typeof saved.ganttStatus === 'string') ganttStatus = saved.ganttStatus;
  if (typeof saved.ganttPriority === 'string') ganttPriority = saved.ganttPriority;
  if (typeof saved.ganttSearch === 'string') ganttSearch = saved.ganttSearch;
  if (saved.ganttAnchor && !Number.isNaN(new Date(saved.ganttAnchor).getTime())) ganttAnchor = new Date(saved.ganttAnchor);
} catch {}

function esc(value = '') {
  return String(value).replace(/[&<>'"]/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
  }[c]));
}

function persistGantt() {
  localStorage.setItem(GANTT_KEY, JSON.stringify({
    planningMode, ganttScale, ganttProject, ganttStatus, ganttPriority, ganttSearch,
    ganttAnchor:ganttAnchor.toISOString()
  }));
}

function profileKey(state) {
  return `${PROFILE_KEY_PREFIX}:${state?.currentUser?.id || 'anonymous'}`;
}

function orderedMembers(state) {
  const preferred = ['u-thibault','u-guillaume','u-anne'];
  return [...(state?.team || [])].sort((a,b) => {
    const ai = preferred.indexOf(a.id);
    const bi = preferred.indexOf(b.id);
    const ar = ai === -1 ? 999 : ai;
    const br = bi === -1 ? 999 : bi;
    return ar - br || String(a.name || '').localeCompare(String(b.name || ''), 'fr');
  });
}

function teamIds(state) {
  return new Set(orderedMembers(state).map(member => member.id).filter(Boolean));
}

export function ensureProfileScope(state) {
  const valid = teamIds(state);
  let selected = [];
  try {
    const raw = JSON.parse(localStorage.getItem(profileKey(state)) || '[]');
    if (Array.isArray(raw)) selected = raw.filter(id => valid.has(id));
  } catch {}
  if (!selected.length && state?.currentUser?.id && valid.has(state.currentUser.id)) {
    selected = [state.currentUser.id];
  }
  if (!selected.length) selected = [...valid].slice(0,1);
  localStorage.setItem(profileKey(state), JSON.stringify(selected));
  return new Set(selected);
}

export function getSelectedProfileIds(state) {
  return ensureProfileScope(state);
}

export function getSelectedMembers(state) {
  const selected = getSelectedProfileIds(state);
  return orderedMembers(state).filter(member => selected.has(member.id));
}

export function getProfileScopeLabel(state) {
  const members = getSelectedMembers(state);
  if (!members.length) return 'Aucun profil';
  if (members.length === 1) return members[0].name;
  if (members.length === (state?.team || []).length) return 'Tous les profils';
  return `${members.length} profils`;
}

export function renderProfileSelector(state) {
  const selected = getSelectedProfileIds(state);
  const members = orderedMembers(state);
  return `
    <div class="v21-profile-scope ${profileMenuOpen ? 'is-open' : ''}">
      <button class="v21-profile-trigger" id="v21ProfileTrigger" type="button" aria-expanded="${profileMenuOpen ? 'true' : 'false'}">
        <span class="v21-profile-stack">${getSelectedMembers(state).slice(0,3).map(m => `<i>${esc(m.initials || m.name?.slice(0,2) || '?')}</i>`).join('')}</span>
        <span><small>Profils affichés</small><strong>${esc(getProfileScopeLabel(state))}</strong></span>
        <b>⌄</b>
      </button>
      ${profileMenuOpen ? `
        <div class="v21-profile-menu">
          <div class="v21-profile-shortcuts">
            <button type="button" data-v21-profile-self>Moi uniquement</button>
            <button type="button" data-v21-profile-all>Tout afficher</button>
          </div>
          <div class="v21-profile-list">
            ${members.map(member => `
              <button type="button" class="${selected.has(member.id) ? 'active' : ''}" data-v21-profile="${esc(member.id)}" aria-pressed="${selected.has(member.id) ? 'true' : 'false'}">
                <span>${esc(member.initials || member.name?.slice(0,2) || '?')}</span>
                <div><strong>${esc(member.name)}</strong><small>${esc(member.role || member.teamRole || '')}</small></div>
                <b>${selected.has(member.id) ? '✓' : ''}</b>
              </button>`).join('')}
          </div>
          <small class="v21-profile-help">Le filtre reste actif quand tu changes de page. Au moins un profil reste toujours sélectionné.</small>
        </div>` : ''}
    </div>`;
}

export function bindProfileSelector(state, rerender, onChange = null) {
  document.querySelector('#v21ProfileTrigger')?.addEventListener('click', event => {
    event.stopPropagation();
    profileMenuOpen = !profileMenuOpen;
    rerender();
  });

  document.querySelector('[data-v21-profile-self]')?.addEventListener('click', () => {
    const id = state?.currentUser?.id;
    if (!id) return;
    localStorage.setItem(profileKey(state), JSON.stringify([id]));
    profileMenuOpen = false;
    onChange?.([id]);
    rerender();
  });

  document.querySelector('[data-v21-profile-all]')?.addEventListener('click', () => {
    const ids = orderedMembers(state).map(member => member.id).filter(Boolean);
    if (!ids.length) return;
    localStorage.setItem(profileKey(state), JSON.stringify(ids));
    profileMenuOpen = false;
    onChange?.(ids);
    rerender();
  });

  document.querySelectorAll('[data-v21-profile]').forEach(button => button.addEventListener('click', () => {
    const id = button.dataset.v21Profile;
    const selected = getSelectedProfileIds(state);
    if (selected.has(id)) {
      if (selected.size === 1) return;
      selected.delete(id);
    } else {
      selected.add(id);
    }
    const ids = [...selected];
    localStorage.setItem(profileKey(state), JSON.stringify(ids));
    onChange?.(ids);
    rerender();
  }));
}

export function closeProfileMenu() {
  profileMenuOpen = false;
}

export function taskInScope(state, task) {
  if (!task) return false;
  return getSelectedProfileIds(state).has(task.assignedTo);
}

export function projectInScope(state, project) {
  if (!project) return false;
  const selected = getSelectedProfileIds(state);
  if (selected.has(project.owner)) return true;
  return (Array.isArray(project.members) ? project.members : []).some(id => selected.has(id));
}

export function eventInScope(state, event) {
  if (!event) return false;
  const selected = getSelectedProfileIds(state);
  if (event.ownerId) return selected.has(event.ownerId);
  if (event.taskId) {
    const t = (state?.tasks || []).find(item => item.id === event.taskId);
    if (t) return selected.has(t.assignedTo);
  }
  if (event.projectId) {
    const p = (state?.projects || []).find(item => item.id === event.projectId);
    if (p) return projectInScope(state, p);
  }
  return selected.has(state?.currentUser?.id);
}

export function reportInScope(state, report) {
  return Boolean(report) && getSelectedProfileIds(state).has(report.personId);
}

export function notificationInScope(state, notification) {
  return Boolean(notification) && getSelectedProfileIds(state).has(notification.recipientId);
}

export function activityInScope(state, activity) {
  if (!activity) return false;
  const selected = getSelectedProfileIds(state);
  if (activity.actorMemberId) return selected.has(activity.actorMemberId);
  if (activity.projectId) {
    const p = (state?.projects || []).find(item => item.id === activity.projectId);
    if (p && projectInScope(state, p)) return true;
  }
  const actor = String(activity.actor || '').toLowerCase();
  for (const member of state?.team || []) {
    if (!selected.has(member.id)) continue;
    const fragments = [member.name, member.id, member.initials]
      .filter(Boolean)
      .map(value => String(value).toLowerCase());
    if (fragments.some(fragment => fragment && actor.includes(fragment))) return true;
  }
  return /^(pilotage|système|systeme)$/i.test(String(activity.actor || ''));
}

export function documentInScope(state, document) {
  if (!document) return false;
  const selected = getSelectedProfileIds(state);
  if (document.ownerId) return selected.has(document.ownerId);
  if (document.projectId) {
    const p = (state?.projects || []).find(item => item.id === document.projectId);
    return p ? projectInScope(state, p) : false;
  }
  return selected.has(state?.currentUser?.id);
}

export function taskProgress(task) {
  return task?.status === 'completed' ? 100 : 0;
}

function projectChildren(state, projectId) {
  return (state?.projects || []).filter(p => p.parentProjectId === projectId);
}

function descendantIds(state, projectId) {
  const ids = [];
  const walk = id => {
    projectChildren(state, id).forEach(child => {
      ids.push(child.id);
      walk(child.id);
    });
  };
  walk(projectId);
  return ids;
}

export function projectProgress(state, project) {
  if (!project) return 0;
  const ids = new Set([project.id, ...descendantIds(state, project.id)]);
  const tasks = (state?.tasks || []).filter(t => ids.has(t.projectId));
  if (!tasks.length) return project.status === 'completed' ? 100 : 0;
  const total = tasks.reduce((sum, task) => sum + taskProgress(task), 0);
  return Math.max(0, Math.min(100, Math.round(total / tasks.length)));
}

export function recalculateAutomaticProgress(state) {
  (state?.tasks || []).forEach(task => {
    task.progress = taskProgress(task);
  });
  (state?.projects || []).forEach(project => {
    const progress = projectProgress(state, project);
    project.progress = progress;
    project.manualProgress = progress;
  });
  return state;
}

export function renderTaskProgress(task, compact = true) {
  const progress = taskProgress(task);
  return `<div class="v21-task-progress ${compact ? 'compact' : ''}"><span>${progress}%</span><div><i style="width:${progress}%"></i></div></div>`;
}

export function getPlanningMode() {
  return planningMode;
}

export function renderPlanningModeSwitch() {
  return `<div class="v21-planning-mode">
    <button type="button" class="${planningMode === 'roadmap' ? 'active' : ''}" data-v21-planning-mode="roadmap">Roadmap</button>
    <button type="button" class="${planningMode === 'gantt' ? 'active' : ''}" data-v21-planning-mode="gantt">Gantt</button>
  </div>`;
}

export function bindPlanningModeSwitch(rerender) {
  document.querySelectorAll('[data-v21-planning-mode]').forEach(button => button.addEventListener('click', () => {
    planningMode = button.dataset.v21PlanningMode === 'gantt' ? 'gantt' : 'roadmap';
    persistGantt();
    rerender();
  }));
}

function dateKey(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return String(value);
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const y = date.getFullYear();
  const m = String(date.getMonth()+1).padStart(2,'0');
  const d = String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

function parseDate(value) {
  const key = dateKey(value);
  if (!key) return null;
  const [y,m,d] = key.split('-').map(Number);
  return new Date(y, m-1, d, 12, 0, 0, 0);
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateDiffDays(a, b) {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function taskInterval(task) {
  let start = parseDate(task?.plannedStart || task?.scheduledFor || task?.dueAt);
  let end = parseDate(task?.plannedEnd || task?.dueAt || task?.scheduledFor);
  if (!start && !end) return null;
  if (!start) start = new Date(end);
  if (!end) end = new Date(start);
  if (end < start) [start,end] = [end,start];
  return { start, end };
}

function startOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay() || 7;
  d.setHours(12,0,0,0);
  d.setDate(d.getDate() - day + 1);
  return d;
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1, 12);
}

function endOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth()+1, 0, 12);
}

function rangeForScale() {
  if (ganttScale === 'week') {
    const start = startOfWeek(ganttAnchor);
    return { start, end:addDays(start,6), unit:'day' };
  }
  if (ganttScale === 'month') {
    return { start:startOfMonth(ganttAnchor), end:endOfMonth(ganttAnchor), unit:'day' };
  }
  const offset = ganttScale === 'n1' ? 1 : ganttScale === 'n2' ? 2 : ganttScale === 'n3' ? 3 : 0;
  const year = ganttAnchor.getFullYear() + offset;
  return {
    start:new Date(year,0,1,12),
    end:new Date(year,11,31,12),
    unit:'month',
    year
  };
}

function formatDay(date) {
  return new Intl.DateTimeFormat('fr-FR',{weekday:'short',day:'2-digit'}).format(date).replace('.','');
}

function formatMonth(date) {
  return new Intl.DateTimeFormat('fr-FR',{month:'short'}).format(date).replace('.','');
}

function ganttTicks(range) {
  const ticks = [];
  if (range.unit === 'day') {
    for (let d=new Date(range.start); d<=range.end; d=addDays(d,1)) {
      ticks.push({ key:dateKey(d), label:formatDay(d), at:new Date(d) });
    }
  } else {
    for (let month=0; month<12; month += 1) {
      const d = new Date(range.year,month,1,12);
      ticks.push({ key:`${range.year}-${String(month+1).padStart(2,'0')}`, label:formatMonth(d), at:d });
    }
  }
  return ticks;
}

function barStyle(interval, range) {
  if (!interval) return null;
  const rangeStart = range.start.getTime();
  const rangeEnd = addDays(range.end,1).getTime();
  const start = Math.max(interval.start.getTime(), rangeStart);
  const end = Math.min(addDays(interval.end,1).getTime(), rangeEnd);
  if (end <= rangeStart || start >= rangeEnd || end <= start) return null;
  const total = rangeEnd - rangeStart;
  const left = ((start - rangeStart) / total) * 100;
  const width = ((end - start) / total) * 100;
  return { left, width };
}

function projectInterval(state, projectId) {
  const ids = new Set([projectId, ...descendantIds(state, projectId)]);
  const intervals = (state?.tasks || [])
    .filter(task => ids.has(task.projectId))
    .map(taskInterval)
    .filter(Boolean);
  if (!intervals.length) return null;
  return {
    start:new Date(Math.min(...intervals.map(item => item.start.getTime()))),
    end:new Date(Math.max(...intervals.map(item => item.end.getTime())))
  };
}

function projectAllowedByFilter(state, project) {
  if (ganttProject === 'all') return true;
  if (project.id === ganttProject) return true;
  if (descendantIds(state, ganttProject).includes(project.id)) return true;
  return descendantIds(state, project.id).includes(ganttProject);
}

function taskMatchesGantt(state, task) {
  if (!taskInScope(state, task)) return false;
  if (task.projectId) {
    const p = (state?.projects || []).find(item => item.id === task.projectId);
    if (p?.archived) return false;
  }
  if (ganttProject !== 'all' && task.projectId !== ganttProject && !descendantIds(state, ganttProject).includes(task.projectId)) return false;
  if (ganttStatus !== 'all' && task.status !== ganttStatus) return false;
  if (ganttPriority !== 'all' && task.priority !== ganttPriority) return false;
  const q = ganttSearch.trim().toLowerCase();
  if (q) {
    const projectName = (state?.projects || []).find(p => p.id === task.projectId)?.name || '';
    if (!`${task.title || ''} ${projectName}`.toLowerCase().includes(q)) return false;
  }
  return true;
}

function renderBar(label, interval, range, progress, type, id = '') {
  const style = barStyle(interval, range);
  if (!style) return '<div class="v21-gantt-offrange">—</div>';
  if (type === 'task') {
    return `<div class="v21-gantt-bar task" data-gantt-task-bar="${esc(id)}" style="left:${style.left}%;width:${Math.max(style.width,1.2)}%" title="${esc(label)} · ${progress}%">
      <span class="v21-gantt-fill" style="width:${progress}%"></span>
      <i data-gantt-resize="start"></i>
      <strong>${esc(label)}</strong>
      <i data-gantt-resize="end"></i>
    </div>`;
  }
  return `<div class="v21-gantt-bar project" style="left:${style.left}%;width:${Math.max(style.width,1.2)}%" title="${esc(label)} · ${progress}%"><span class="v21-gantt-fill" style="width:${progress}%"></span><strong>${progress}%</strong></div>`;
}

function renderProjectRows(state, project, range, depth = 0) {
  if (!projectInScope(state, project) || !projectAllowedByFilter(state, project)) return '';
  const tasks = (state?.tasks || []).filter(task => task.projectId === project.id && taskMatchesGantt(state, task));
  const children = projectChildren(state, project.id)
    .filter(child => !child.archived)
    .map(child => renderProjectRows(state, child, range, depth + 1))
    .filter(Boolean);

  const q = ganttSearch.trim().toLowerCase();
  const projectNameMatches = !q || String(project.name || '').toLowerCase().includes(q);
  const taskConstraint = ganttStatus !== 'all' || ganttPriority !== 'all';
  if (taskConstraint && !tasks.length && !children.length) return '';
  if (q && !projectNameMatches && !tasks.length && !children.length) return '';

  const pProgress = projectProgress(state, project);
  const pInterval = projectInterval(state, project.id);
  let html = `<div class="v21-gantt-row project-row">
    <div class="v21-gantt-label" style="--gantt-depth:${depth}">
      <span class="v21-gantt-folder">▣</span>
      <div><strong>${esc(project.name)}</strong><small>${esc((state.team || []).find(m => m.id === project.owner)?.name || 'Non attribué')} · ${pProgress}%</small></div>
    </div>
    <div class="v21-gantt-timeline-cell">${renderBar(project.name,pInterval,range,pProgress,'project')}</div>
  </div>`;

  html += tasks.map(task => {
    const progress = taskProgress(task);
    const interval = taskInterval(task);
    return `<div class="v21-gantt-row task-row-gantt">
      <div class="v21-gantt-label" style="--gantt-depth:${depth + 1}">
        <span class="v21-gantt-task-dot">✓</span>
        <div><strong>${esc(task.title)}</strong><small>${esc((state.team || []).find(m => m.id === task.assignedTo)?.name || 'Non attribué')} · ${progress}%</small></div>
      </div>
      <div class="v21-gantt-timeline-cell">${renderBar(task.title,interval,range,progress,'task',task.id)}</div>
    </div>`;
  }).join('');

  html += children.join('');
  return html;
}

export function renderGantt(state, labels = {}) {
  const range = rangeForScale();
  const ticks = ganttTicks(range);
  const roots = (state?.projects || [])
    .filter(project => !project.archived && !project.parentProjectId)
    .sort((a,b) => Number(a.treeSortOrder || 0) - Number(b.treeSortOrder || 0));
  const rows = roots.map(project => renderProjectRows(state, project, range, 0)).filter(Boolean).join('');
  const unassigned = (state?.tasks || []).filter(task => !task.projectId && taskMatchesGantt(state, task));
  const unassignedRows = unassigned.map(task => {
    const progress = taskProgress(task);
    return `<div class="v21-gantt-row task-row-gantt">
      <div class="v21-gantt-label"><span class="v21-gantt-task-dot">✓</span><div><strong>${esc(task.title)}</strong><small>Sans projet · ${esc((state.team || []).find(m => m.id === task.assignedTo)?.name || 'Non attribué')} · ${progress}%</small></div></div>
      <div class="v21-gantt-timeline-cell">${renderBar(task.title,taskInterval(task),range,progress,'task',task.id)}</div>
    </div>`;
  }).join('');

  const totalDays = dateDiffDays(range.start, addDays(range.end,1));
  const minWidth = range.unit === 'day'
    ? Math.max(720, ticks.length * 48)
    : 900;

  const projectOptions = (state?.projects || [])
    .filter(p => !p.archived && projectInScope(state,p))
    .sort((a,b) => String(a.name || '').localeCompare(String(b.name || ''),'fr'))
    .map(p => `<option value="${esc(p.id)}" ${ganttProject === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)
    .join('');

  return `
    <section class="v21-gantt-shell">
      <div class="v21-gantt-toolbar">
        <div class="v21-gantt-filters">
          <select id="v21GanttProject"><option value="all">Tous les projets</option>${projectOptions}</select>
          <input id="v21GanttSearch" value="${esc(ganttSearch)}" placeholder="Filtrer une tâche…" />
          <select id="v21GanttStatus">
            <option value="all">Tous les statuts</option>
            ${Object.entries(labels.statusLabels || {}).map(([value,label]) => `<option value="${esc(value)}" ${ganttStatus === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
          <select id="v21GanttPriority">
            <option value="all">Toutes les priorités</option>
            ${Object.entries(labels.priorityLabels || {}).map(([value,label]) => `<option value="${esc(value)}" ${ganttPriority === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}
          </select>
        </div>
        <div class="v21-gantt-scale">
          ${[['week','Semaine'],['month','Mois'],['year','Année'],['n1','N+1'],['n2','N+2'],['n3','N+3']].map(([value,label]) => `<button type="button" data-v21-gantt-scale="${value}" class="${ganttScale === value ? 'active' : ''}">${label}</button>`).join('')}
        </div>
        <div class="v21-gantt-nav">
          <button type="button" data-v21-gantt-nav="-1">←</button>
          <button type="button" data-v21-gantt-today>Aujourd’hui</button>
          <button type="button" data-v21-gantt-nav="1">→</button>
          <strong>${range.unit === 'day'
            ? `${dateKey(range.start)} → ${dateKey(range.end)}`
            : `Année ${range.year}`}</strong>
        </div>
      </div>

      <div class="v21-gantt-scroll">
        <div class="v21-gantt-board" style="--gantt-min-width:${minWidth}px">
          <div class="v21-gantt-header-row">
            <div class="v21-gantt-label"><strong>Projet / tâche</strong><small>Progression automatique</small></div>
            <div class="v21-gantt-timeline-cell v21-gantt-ticks">
              ${ticks.map(tick => `<span>${esc(tick.label)}</span>`).join('')}
            </div>
          </div>
          <div class="v21-gantt-body" data-v21-gantt-timeline data-range-start="${dateKey(range.start)}" data-range-end="${dateKey(range.end)}" data-total-days="${totalDays}">
            ${rows}${unassignedRows}
            ${!rows && !unassignedRows ? '<div class="v21-gantt-empty">Aucun élément pour ces filtres.</div>' : ''}
          </div>
        </div>
      </div>
      <div class="v21-gantt-help">Glisse une barre de tâche pour la déplacer. Tire ses poignées gauche/droite pour modifier les dates. Les barres projet sont calculées automatiquement.</div>
    </section>`;
}

function shiftAnchor(direction) {
  if (ganttScale === 'week') ganttAnchor = addDays(ganttAnchor, 7 * direction);
  else if (ganttScale === 'month') ganttAnchor = new Date(ganttAnchor.getFullYear(), ganttAnchor.getMonth() + direction, 1, 12);
  else ganttAnchor = new Date(ganttAnchor.getFullYear() + direction, ganttAnchor.getMonth(), 1, 12);
}

export function bindGantt(state, rerender, onTaskDates) {
  document.querySelector('#v21GanttProject')?.addEventListener('change', e => { ganttProject=e.target.value; persistGantt(); rerender(); });
  document.querySelector('#v21GanttStatus')?.addEventListener('change', e => { ganttStatus=e.target.value; persistGantt(); rerender(); });
  document.querySelector('#v21GanttPriority')?.addEventListener('change', e => { ganttPriority=e.target.value; persistGantt(); rerender(); });
  document.querySelector('#v21GanttSearch')?.addEventListener('input', e => {
    ganttSearch=e.target.value;
    persistGantt();
    rerender();
    requestAnimationFrame(() => {
      const input=document.querySelector('#v21GanttSearch');
      if(input){ input.focus(); input.setSelectionRange(input.value.length,input.value.length); }
    });
  });
  document.querySelectorAll('[data-v21-gantt-scale]').forEach(button => button.addEventListener('click', () => {
    ganttScale=button.dataset.v21GanttScale;
    persistGantt();
    rerender();
  }));
  document.querySelectorAll('[data-v21-gantt-nav]').forEach(button => button.addEventListener('click', () => {
    shiftAnchor(Number(button.dataset.v21GanttNav || 0));
    persistGantt();
    rerender();
  }));
  document.querySelector('[data-v21-gantt-today]')?.addEventListener('click', () => {
    ganttAnchor=new Date();
    persistGantt();
    rerender();
  });

  document.querySelectorAll('[data-gantt-task-bar]').forEach(bar => {
    bar.addEventListener('pointerdown', event => {
      if (event.button != null && event.button !== 0) return;
      const taskId = bar.dataset.ganttTaskBar;
      const task = (state?.tasks || []).find(item => item.id === taskId);
      const interval = taskInterval(task);
      const body = bar.closest('.v21-gantt-body') || document.querySelector('[data-v21-gantt-timeline]');
      const timeline = bar.closest('.v21-gantt-timeline-cell');
      if (!task || !interval || !body || !timeline) return;

      const handle = event.target.closest('[data-gantt-resize]');
      const mode = handle?.dataset.ganttResize || 'move';
      const startX = event.clientX;
      const timelineWidth = timeline.getBoundingClientRect().width || 1;
      const totalDays = Math.max(1, Number(body.dataset.totalDays || 1));
      let deltaDays = 0;

      event.preventDefault();
      bar.classList.add('is-dragging');
      bar.setPointerCapture?.(event.pointerId);

      const move = moveEvent => {
        const dx = moveEvent.clientX - startX;
        deltaDays = Math.round((dx / timelineWidth) * totalDays);
        const pxPerDay = timelineWidth / totalDays;
        bar.style.transform = `translateX(${deltaDays * pxPerDay}px)`;
      };

      const finish = async () => {
        bar.removeEventListener('pointermove', move);
        bar.removeEventListener('pointerup', finish);
        bar.removeEventListener('pointercancel', finish);
        bar.classList.remove('is-dragging');
        bar.style.transform = '';
        if (!deltaDays) return;

        let start = new Date(interval.start);
        let end = new Date(interval.end);
        if (mode === 'start') start = addDays(start, deltaDays);
        else if (mode === 'end') end = addDays(end, deltaDays);
        else {
          start = addDays(start, deltaDays);
          end = addDays(end, deltaDays);
        }
        if (start > end) {
          if (mode === 'start') start = new Date(end);
          else end = new Date(start);
        }
        await onTaskDates?.(taskId, dateKey(start), dateKey(end), mode);
      };

      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', finish, { once:true });
      bar.addEventListener('pointercancel', finish, { once:true });
    });
  });
}
