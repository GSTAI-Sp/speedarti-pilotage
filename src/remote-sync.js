(() => {
  'use strict';

  const TAGS = Object.freeze({
    HYDRATE: 'PILOT-SUPA-001',
    DIFF_SYNC: 'PILOT-SUPA-002',
    PROJECT_SYNC: 'PILOT-SUPA-003',
    TASK_SYNC: 'PILOT-SUPA-004',
    ACTIVITY_SYNC: 'PILOT-SUPA-005',
    NOTIF_SYNC: 'PILOT-SUPA-006',
    REPORT_SYNC: 'PILOT-SUPA-007',
    DOCUMENT_SYNC: 'PILOT-SUPA-008',
    AI_SYNC: 'PILOT-SUPA-009',
    RECOVERY: 'PILOT-SUPA-010',
    TEAM_DIRECTORY: 'PILOT-TEAM-001',
    AI_EVENT_LOAD: 'PILOT-SUPA-013'
  });

  const STORAGE_KEY = 'speedarti-pilotage-demo-v1';
  const PENDING_PREFIX = 'speedarti-pilotage-remote-pending:';

  let client = null;
  let auth = null;
  let currentMember = null;
  let baselineState = null;
  let pendingState = null;
  let syncTimer = null;
  let syncing = false;
  let stateWatcherTimer = null;
  let lastObservedRaw = '';
  let retryTimer = null;
  let lastError = null;
  let lastSyncedAt = null;

  const STATE_WATCH_INTERVAL_MS = 600;
  const SYNC_RETRY_MS = 8000;
  const REMOTE_LOAD_TIMEOUT_MS = 10000;

  const maps = {
    membersByClient: new Map(),
    membersByUuid: new Map(),
    projectsByClient: new Map(),
    projectsByUuid: new Map(),
    tasksByClient: new Map(),
    tasksByUuid: new Map(),
    agentsByClient: new Map(),
    agentsByUuid: new Map(),
    changesByClient: new Map(),
    changesByUuid: new Map(),
    reportsByClient: new Map(),
    reportsByUuid: new Map()
  };

  function trace(tag, message, details = {}) {
    console.debug(`[${tag}] ${message}`, details);
  }

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function safeParse(raw, fallback = {}) {
    try { return raw ? JSON.parse(raw) : fallback; }
    catch { return fallback; }
  }

  function withTimeout(promise, ms, label) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} a dépassé ${Math.round(ms / 1000)} s.`)), ms);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  function array(value) {
    return Array.isArray(value) ? value : [];
  }

  function normalize(value = '') {
    return String(value).trim().toLowerCase();
  }

  function jsonEqual(a, b) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }

  function changedItems(before, after, key = 'id') {
    const oldMap = new Map(array(before).map(item => [item?.[key], item]));
    return array(after).filter(item => {
      const id = item?.[key];
      return id && !jsonEqual(oldMap.get(id), item);
    });
  }

  function keyFor(row, prefix) {
    return row?.client_key || `${prefix}-${row?.id}`;
  }

  function remember(mapClient, mapUuid, rows) {
    rows.forEach(row => {
      if (!row?.id) return;
      if (row.client_key) mapClient.set(row.client_key, row.id);
      mapUuid.set(row.id, row.client_key || row.id);
    });
  }

  function memberUuid(clientKey) {
    return clientKey ? maps.membersByClient.get(clientKey) || null : null;
  }

  function memberClient(uuid) {
    return uuid ? maps.membersByUuid.get(uuid) || null : null;
  }

  function projectUuid(clientKey) {
    return clientKey ? maps.projectsByClient.get(clientKey) || null : null;
  }

  function projectClient(uuid) {
    return uuid ? maps.projectsByUuid.get(uuid) || null : null;
  }

  function taskUuid(clientKey) {
    return clientKey ? maps.tasksByClient.get(clientKey) || null : null;
  }

  function taskClient(uuid) {
    return uuid ? maps.tasksByUuid.get(uuid) || null : null;
  }

  function agentUuid(clientKey) {
    return clientKey ? maps.agentsByClient.get(clientKey) || null : null;
  }

  function agentClient(uuid) {
    return uuid ? maps.agentsByUuid.get(uuid) || null : null;
  }

  function changeUuid(clientKey) {
    return clientKey ? maps.changesByClient.get(clientKey) || null : null;
  }

  function changeClient(uuid) {
    return uuid ? maps.changesByUuid.get(uuid) || null : null;
  }

  function reportUuid(clientKey) {
    return clientKey ? maps.reportsByClient.get(clientKey) || null : null;
  }

  function reportClient(uuid) {
    return uuid ? maps.reportsByUuid.get(uuid) || null : null;
  }

  function memberFromLabel(value) {
    if (!value) return currentMember?.client_key || null;
    if (maps.membersByClient.has(value)) return value;

    const text = normalize(value);
    const candidates = [...maps.membersByClient.keys()];
    for (const clientKey of candidates) {
      const member = maps.membersByUuid.get(maps.membersByClient.get(clientKey));
      if (!member) continue;
    }

    const known = [
      ['thibault', 'u-thibault'],
      ['anne-sophie', 'u-anne'],
      ['anne sophie', 'u-anne'],
      ['guillaume', 'u-guillaume']
    ];
    for (const [needle, clientKey] of known) {
      if (text.includes(needle)) {
        // Les anciennes fonctions V10 attribuent parfois "Thibault" par défaut.
        // Hors session Thibault, une nouvelle action manuelle doit être attribuée
        // au membre réellement connecté.
        if (needle === 'thibault' && currentMember?.client_key !== 'u-thibault' && text === 'thibault') {
          return currentMember?.client_key || clientKey;
        }
        return clientKey;
      }
    }
    return currentMember?.client_key || null;
  }

  async function selectAll(table, columns = '*') {
    const { data, error } = await client.from(table).select(columns);
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  }

  async function selectRecentAiEvents() {
    const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await client
      .from('ai_events')
      .select('*')
      .gte('happened_at', since)
      .order('happened_at', { ascending:false })
      .limit(500);
    if (error) throw new Error(`ai_events: ${error.message}`);
    trace(TAGS.AI_EVENT_LOAD, 'Remontées IA chargées', { count:(data || []).length });
    return data || [];
  }

  async function loadRemoteState() {
    trace(TAGS.HYDRATE, 'Chargement des données Supabase');

    const [
      members, projects, projectMembers, agents, tasks, changes,
      notifications, activity, documents, aiRequests, aiEvents, reports, reportProjects,
      integrations, driveItems, calendarSources, calendarEvents
    ] = await Promise.all([
      selectAll('team_members'),
      selectAll('projects'),
      selectAll('project_members'),
      selectAll('ai_agents'),
      selectAll('tasks'),
      selectAll('change_requests'),
      selectAll('notifications'),
      selectAll('activity_log'),
      selectAll('project_documents'),
      selectAll('ai_requests'),
      selectRecentAiEvents(),
      selectAll('daily_reports'),
      selectAll('daily_report_projects'),
      selectAll('integrations'),
      selectAll('drive_sync_items'),
      selectAll('calendar_sources'),
      selectAll('calendar_events')
    ]);

    Object.values(maps).forEach(map => map.clear());

    members.forEach(row => {
      maps.membersByClient.set(row.client_key, row.id);
      maps.membersByUuid.set(row.id, row.client_key);
    });
    remember(maps.projectsByClient, maps.projectsByUuid, projects);
    remember(maps.tasksByClient, maps.tasksByUuid, tasks);
    remember(maps.agentsByClient, maps.agentsByUuid, agents);
    remember(maps.changesByClient, maps.changesByUuid, changes);
    remember(maps.reportsByClient, maps.reportsByUuid, reports);

    const memberships = new Map();
    projectMembers.forEach(row => {
      const pKey = projectClient(row.project_id);
      const mKey = memberClient(row.member_id);
      if (!pKey || !mKey) return;
      if (!memberships.has(pKey)) memberships.set(pKey, []);
      memberships.get(pKey).push(mKey);
    });

    const reportLinks = new Map();
    reportProjects.forEach(row => {
      const rKey = reportClient(row.report_id);
      const pKey = projectClient(row.project_id);
      if (!rKey || !pKey) return;
      if (!reportLinks.has(rKey)) reportLinks.set(rKey, []);
      reportLinks.get(rKey).push(pKey);
    });

    const localBase = safeParse(localStorage.getItem(STORAGE_KEY), {});

    const team = members
      .filter(row => row.active !== false)
      .map(row => ({
        id: row.client_key,
        authUserId: row.profile_id || null,
        name: row.display_name,
        initials: row.initials || '',
        role: row.team_role || '',
        accessRole: row.role || 'member'
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));

    const localProjects = projects.map(row => ({
      id: keyFor(row, 'project'),
      name: row.name,
      owner: memberClient(row.owner_id),
      members: memberships.get(keyFor(row, 'project')) || [memberClient(row.owner_id)].filter(Boolean),
      status: row.status,
      priority: row.priority,
      progress: Number(row.progress || 0),
      manualProgress: Number(row.manual_progress ?? row.progress ?? 0),
      parentProjectId: projectClient(row.parent_project_id),
      treeSortOrder: Number(row.tree_sort_order || 0),
      blocker: row.blocker || '',
      nextAction: row.next_action || '',
      archived: Boolean(row.archived_at),
      archivedAt: row.archived_at,
      completedAt: row.completed_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const localAgents = agents.map(row => ({
      id: keyFor(row, 'agent'),
      name: row.name,
      provider: row.provider,
      personId: memberClient(row.member_id),
      category: row.purpose || '',
      active: row.active !== false,
      externalAgentRef: row.external_agent_ref || null,
      lastSeenAt: row.last_seen_at || null
    }));

    const localTasks = tasks.map(row => ({
      id: keyFor(row, 'task'),
      title: row.title,
      projectId: projectClient(row.project_id),
      assignedTo: memberClient(row.assigned_to_member_id),
      status: row.status,
      priority: row.priority,
      progress: Number(row.progress || (row.status === 'completed' ? 100 : 0)),
      scheduledFor: row.scheduled_for,
      dueAt: row.due_at,
      planningStatus: row.planning_status,
      planningBucket: row.planning_bucket,
      suggestedBucket: row.suggested_bucket,
      needsPlanning: Boolean(row.needs_planning),
      plannedStart: row.planned_start,
      plannedEnd: row.planned_end,
      sortOrder: Number(row.sort_order || 0),
      completedAt: row.completed_at,
      sourceType: row.source_type,
      sourceAgent: agentClient(row.source_agent_id),
      sourceIdeaId: row.source_idea_id || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const localChanges = changes.map(row => ({
      id: keyFor(row, 'change'),
      type: row.request_type,
      projectId: projectClient(row.project_id),
      taskId: taskClient(row.task_id),
      requestedBy: memberClient(row.requested_by_member_id) || row.source_type || 'Pilotage',
      sourceAgent: agentClient(row.source_agent_id),
      sourceType: row.source_type,
      status: row.status,
      proposed: row.proposed || {},
      note: row.note || '',
      decidedBy: memberClient(row.decided_by_member_id),
      requestedAt: row.requested_at,
      decidedAt: row.decided_at
    }));

    const localNotifications = notifications.map(row => ({
      id: keyFor(row, 'notification'),
      recipientId: memberClient(row.recipient_member_id),
      severity: row.severity,
      type: row.type,
      title: row.title,
      message: row.message,
      actionType: row.action_type,
      taskId: taskClient(row.task_id),
      projectId: projectClient(row.project_id),
      changeRequestId: changeClient(row.change_request_id),
      groupKey: row.group_key,
      internalTag: row.internal_tag,
      count: Number(row.count || 1),
      read: Boolean(row.read_at),
      resolved: Boolean(row.resolved_at),
      readAt: row.read_at,
      resolvedAt: row.resolved_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));

    const localActivity = activity
      .map(row => ({
        id: keyFor(row, 'activity'),
        at: row.created_at,
        actor: row.actor_label || memberClient(row.actor_member_id) || 'Pilotage',
        actorMemberId: memberClient(row.actor_member_id),
        projectId: projectClient(row.project_id),
        taskId: taskClient(row.task_id),
        actionType: row.action_type,
        text: row.text,
        oldValue: row.old_value,
        newValue: row.new_value,
        metadata: row.metadata || {},
        internalTag: row.internal_tag
      }))
      .sort((a, b) => new Date(b.at) - new Date(a.at));

    const localDocuments = documents.map(row => ({
      id: keyFor(row, 'document'),
      projectId: projectClient(row.project_id),
      name: row.name,
      type: row.document_type || 'Document',
      source: row.source || 'Google Drive',
      externalFileId: row.external_file_id || null,
      url: row.web_url || '',
      mimeType: row.mime_type || null,
      lastSyncedAt: row.last_synced_at || null
    }));

    const localAiRequests = aiRequests.map(row => ({
      id: row.id,
      requestId: row.request_id,
      source: agentClient(row.agent_id),
      projectId: projectClient(row.project_id),
      taskId: taskClient(row.task_id),
      mode: row.action,
      status: row.status,
      payload: row.payload || {},
      result: row.result,
      errorMessage: row.error_message,
      internalTag: row.internal_tag,
      receivedAt: row.received_at,
      processedAt: row.processed_at
    }));

    const localAiEvents = aiEvents.map(row => ({
      id: row.event_id || row.id,
      eventId: row.event_id,
      sourceAgent: agentClient(row.agent_id),
      personId: memberClient(row.member_id),
      projectId: projectClient(row.project_id),
      taskId: taskClient(row.task_id),
      eventType: row.event_type,
      summary: row.summary,
      payload: row.payload || {},
      happenedAt: row.happened_at,
      receivedAt: row.received_at,
      processedAt: row.processed_at,
      processingStatus: row.processing_status,
      internalTag: row.internal_tag
    }));

    const localReports = reports.map(row => ({
      id: keyFor(row, 'report'),
      reportDate: row.report_date,
      personId: memberClient(row.member_id),
      source: row.source_type === 'manual' ? 'manual' : 'ai',
      sourceAgent: agentClient(row.ai_agent_id),
      status: row.status,
      summary: row.summary || row.done_summary || '',
      achievements: array(row.achievements),
      blockers: array(row.blockers_items),
      nextSteps: array(row.next_steps_items),
      projectIds: reportLinks.get(keyFor(row, 'report')) || [],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      validatedAt: row.validated_at,
      validatedBy: memberClient(row.validated_by_member_id)
    }));

    const integrationOwner = new Map(integrations.map(row => [row.id, memberClient(row.owner_member_id)]));

    const localIntegrations = integrations.map(row => ({
      id: row.id,
      ownerId: memberClient(row.owner_member_id),
      provider: row.provider,
      status: row.status,
      configuration: row.configuration || {},
      lastSyncedAt: row.last_synced_at || null,
      lastError: row.last_error || null
    }));

    const localDriveItems = driveItems.map(row => ({
      id: row.id,
      integrationId: row.integration_id,
      ownerId: memberClient(row.owner_member_id) || integrationOwner.get(row.integration_id) || null,
      projectId: projectClient(row.project_id),
      externalFileId: row.external_file_id,
      parentExternalFileId: row.parent_external_file_id || null,
      name: row.name,
      mimeType: row.mime_type || null,
      url: row.web_url || '',
      relativePath: row.relative_path || '',
      isFolder: Boolean(row.is_folder),
      trashed: Boolean(row.trashed),
      modifiedTime: row.modified_time || null,
      sizeBytes: row.size_bytes == null ? null : Number(row.size_bytes),
      lastSyncedAt: row.last_synced_at || null
    }));

    const sourceByUuid = new Map(calendarSources.map(row => [row.id, row]));
    const localCalendarSources = calendarSources.map(row => ({
      id: row.id,
      integrationId: row.integration_id,
      ownerId: memberClient(row.owner_member_id) || integrationOwner.get(row.integration_id) || null,
      externalCalendarId: row.external_calendar_id,
      name: row.name,
      description: row.description || '',
      timezone: row.timezone || null,
      accessRole: row.access_role || null,
      primary: Boolean(row.is_primary),
      selected: Boolean(row.selected),
      syncMode: row.sync_mode || 'read_only',
      sharedWithTeam: Boolean(row.shared_with_team),
      lastSyncedAt: row.last_synced_at || null
    }));

    const localCalendarEvents = calendarEvents.map(row => {
      const source = sourceByUuid.get(row.calendar_source_id);
      const at = row.start_at || (row.start_date ? `${row.start_date}T00:00:00` : null);
      return {
        id: row.id,
        externalEventId: row.external_event_id,
        calendarSourceId: row.calendar_source_id,
        calendarName: source?.name || 'Google Calendar',
        ownerId: source ? (memberClient(source.owner_member_id) || integrationOwner.get(source.integration_id) || null) : null,
        projectId: projectClient(row.project_id),
        taskId: taskClient(row.task_id),
        title: row.summary || '(Sans titre)',
        description: row.description || '',
        location: row.location || '',
        at,
        endAt: row.end_at || null,
        allDay: Boolean(row.all_day),
        url: row.html_link || '',
        status: row.status || null,
        organizerEmail: row.organizer_email || null,
        meetUrl: row.meet_url || null,
        conferenceId: row.conference_id || null,
        attendees: Array.isArray(row.attendees) ? row.attendees : [],
        lastSyncedAt: row.last_synced_at || null
      };
    });

    const liveState = {
      ...localBase,
      currentUser: {
        id: currentMember.client_key,
        authUserId: auth.userId,
        name: currentMember.display_name,
        initials: currentMember.initials || '',
        role: currentMember.role,
        teamRole: currentMember.team_role || ''
      },
      team,
      projects: localProjects,
      tasks: localTasks,
      changeRequests: localChanges,
      notifications: localNotifications,
      activity: localActivity,
      documents: localDocuments,
      aiAgents: localAgents,
      aiRequests: localAiRequests,
      aiEvents: localAiEvents,
      dailyReports: localReports,
      integrations: localIntegrations,
      driveItems: localDriveItems,
      calendarSources: localCalendarSources,
      calendarEvents: localCalendarEvents,
      remoteMode: true,
      remoteHydratedAt: new Date().toISOString()
    };

    trace(TAGS.TEAM_DIRECTORY, 'Répertoire équipe chargé', {
      members: team.length,
      connected: members.filter(x => x.profile_id).length
    });

    return liveState;
  }

  function writeLocalState(state) {
    const raw = JSON.stringify(state);
    localStorage.setItem(STORAGE_KEY, raw);
    lastObservedRaw = raw;
  }

  function pendingKey() {
    return `${PENDING_PREFIX}${auth.userId}`;
  }

  function storePending(state) {
    localStorage.setItem(pendingKey(), JSON.stringify(state));
  }

  function clearPending() {
    localStorage.removeItem(pendingKey());
  }

  async function upsertReturning(table, rows, conflict = 'client_key') {
    if (!rows.length) return [];
    const { data, error } = await client
      .from(table)
      .upsert(rows, { onConflict: conflict })
      .select();
    if (error) throw new Error(`${table}: ${error.message}`);
    return data || [];
  }

  function actorClientKey(actor) {
    const direct = memberFromLabel(actor);
    return direct || currentMember.client_key;
  }

  async function syncProjects(items) {
    if (!items.length) return;
    const rows = items.map(p => ({
      client_key: p.id,
      name: p.name,
      owner_id: memberUuid(p.owner) || memberUuid(currentMember.client_key),
      status: p.status || 'todo',
      priority: p.priority || 'medium',
      progress: Number(p.progress || 0),
      manual_progress: Number(p.manualProgress ?? p.progress ?? 0),
      parent_project_id: projectUuid(p.parentProjectId),
      tree_sort_order: Number(p.treeSortOrder || 0),
      blocker: p.blocker || '',
      next_action: p.nextAction || '',
      archived_at: p.archived ? (p.archivedAt || new Date().toISOString()) : null,
      completed_at: p.completedAt || (p.status === 'completed' ? new Date().toISOString() : null)
    }));
    const saved = await upsertReturning('projects', rows);
    remember(maps.projectsByClient, maps.projectsByUuid, saved);

    for (const project of items) {
      const pUuid = projectUuid(project.id);
      if (!pUuid) continue;
      const members = [...new Set([...(project.members || []), project.owner].filter(Boolean))]
        .map(memberUuid)
        .filter(Boolean);
      const { error: delError } = await client.from('project_members').delete().eq('project_id', pUuid);
      if (delError) throw new Error(`project_members(delete): ${delError.message}`);
      if (members.length) {
        const { error } = await client.from('project_members').insert(
          members.map(member_id => ({
            project_id: pUuid,
            member_id,
            project_role: member_id === memberUuid(project.owner) ? 'owner' : 'member'
          }))
        );
        if (error) throw new Error(`project_members(insert): ${error.message}`);
      }
    }
    trace(TAGS.PROJECT_SYNC, 'Projets synchronisés', { count: items.length });
  }

  async function syncAgents(items) {
    if (!items.length) return;
    const rows = items.map(agent => ({
      client_key: agent.id,
      member_id: memberUuid(agent.personId) || memberUuid(currentMember.client_key),
      name: agent.name,
      provider: agent.provider || 'Autre',
      purpose: agent.category || agent.purpose || '',
      external_agent_ref: agent.externalAgentRef || null,
      active: agent.active !== false,
      last_seen_at: agent.lastSeenAt || null
    }));
    const saved = await upsertReturning('ai_agents', rows);
    remember(maps.agentsByClient, maps.agentsByUuid, saved);
    trace(TAGS.AI_SYNC, 'Registre IA synchronisé', { count: items.length });
  }

  async function syncTasks(items) {
    if (!items.length) return;
    const rows = items.map(t => ({
      client_key: t.id,
      title: t.title,
      project_id: projectUuid(t.projectId),
      assigned_to_member_id: memberUuid(t.assignedTo),
      source_type: t.sourceType || 'manual',
      source_agent_id: agentUuid(t.sourceAgent),
      status: t.status || 'todo',
      priority: t.priority || 'medium',
      progress: t.status === 'completed' ? 100 : 0,
      scheduled_for: t.scheduledFor || null,
      due_at: t.dueAt || null,
      planning_status: t.planningStatus || 'unplanned',
      planning_bucket: t.planningBucket || null,
      suggested_bucket: t.suggestedBucket || null,
      needs_planning: Boolean(t.needsPlanning),
      planned_start: t.plannedStart || null,
      planned_end: t.plannedEnd || null,
      sort_order: Number(t.sortOrder || 0),
      completed_at: t.completedAt || null
    }));
    const saved = await upsertReturning('tasks', rows);
    remember(maps.tasksByClient, maps.tasksByUuid, saved);
    trace(TAGS.TASK_SYNC, 'Tâches synchronisées', { count: items.length });
  }

  async function syncChanges(items) {
    if (!items.length) return;
    const rows = items.map(r => ({
      client_key: r.id,
      request_type: r.type || 'change',
      project_id: projectUuid(r.projectId),
      task_id: taskUuid(r.taskId),
      requested_by_member_id: memberUuid(memberFromLabel(r.requestedBy)),
      source_agent_id: agentUuid(r.sourceAgent),
      source_type: r.sourceType || 'manual',
      status: r.status || 'pending',
      proposed: r.proposed || {},
      note: r.note || null,
      decided_by_member_id: memberUuid(r.decidedBy),
      requested_at: r.requestedAt || new Date().toISOString(),
      decided_at: r.decidedAt || null
    }));
    const saved = await upsertReturning('change_requests', rows);
    remember(maps.changesByClient, maps.changesByUuid, saved);
  }

  async function syncNotifications(items) {
    if (!items.length) return;
    const rows = items.map(n => ({
      client_key: n.id,
      recipient_member_id: memberUuid(n.recipientId) || memberUuid(currentMember.client_key),
      severity: n.severity || 'info',
      type: n.type || 'task_update',
      title: n.title || 'Information',
      message: n.message || '',
      action_type: n.actionType || 'read',
      task_id: taskUuid(n.taskId),
      project_id: projectUuid(n.projectId),
      change_request_id: changeUuid(n.changeRequestId),
      group_key: n.groupKey || null,
      internal_tag: n.internalTag || null,
      count: Number(n.count || 1),
      read_at: n.readAt || (n.read ? new Date().toISOString() : null),
      resolved_at: n.resolvedAt || (n.resolved ? new Date().toISOString() : null)
    }));

    const currentMemberUuid = memberUuid(currentMember.client_key);
    const canUpdateForeign = currentMember.role === 'admin';
    const writable = rows.filter(row => canUpdateForeign || row.recipient_member_id === currentMemberUuid);
    const foreignInsertOnly = rows.filter(row => !canUpdateForeign && row.recipient_member_id !== currentMemberUuid);

    if (writable.length) {
      const { error } = await client
        .from('notifications')
        .upsert(writable, { onConflict: 'client_key' });
      if (error) throw new Error(`notifications: ${error.message}`);
    }

    if (foreignInsertOnly.length) {
      const { error } = await client
        .from('notifications')
        .upsert(foreignInsertOnly, { onConflict: 'client_key', ignoreDuplicates: true });
      if (error) throw new Error(`notifications(cross-user): ${error.message}`);
    }

    trace(TAGS.NOTIF_SYNC, 'Notifications synchronisées', {
      count: items.length,
      crossUser: foreignInsertOnly.length
    });
  }

  async function syncActivity(items) {
    if (!items.length) return;
    const rows = items.map(a => {
      const actorKey = a.actorMemberId || actorClientKey(a.actor);
      const actorLabel = (
        normalize(a.actor) === 'thibault' &&
        currentMember.client_key !== 'u-thibault'
      ) ? currentMember.display_name : (a.actor || currentMember.display_name);

      return {
        client_key: a.id,
        actor_member_id: memberUuid(actorKey),
        actor_label: actorLabel,
        project_id: projectUuid(a.projectId),
        task_id: taskUuid(a.taskId),
        action_type: a.actionType || null,
        text: a.text || '',
        old_value: a.oldValue ?? null,
        new_value: a.newValue ?? null,
        metadata: a.metadata || {},
        internal_tag: a.internalTag || null,
        created_at: a.at || new Date().toISOString()
      };
    });
    const { error } = await client
      .from('activity_log')
      .upsert(rows, { onConflict: 'client_key', ignoreDuplicates: true });
    if (error) throw new Error(`activity_log: ${error.message}`);
    trace(TAGS.ACTIVITY_SYNC, 'Activité synchronisée', { count: items.length });
  }

  async function syncDocuments(items) {
    if (!items.length) return;
    const rows = items.map(d => ({
      client_key: d.id,
      project_id: projectUuid(d.projectId),
      name: d.name,
      document_type: d.type || 'Document',
      source: d.source || 'Google Drive',
      external_file_id: d.externalFileId || null,
      web_url: d.url || null,
      mime_type: d.mimeType || null,
      last_synced_at: d.lastSyncedAt || null
    }));
    await upsertReturning('project_documents', rows);
    trace(TAGS.DOCUMENT_SYNC, 'Documents synchronisés', { count: items.length });
  }

  async function syncAiRequests(items) {
    if (!items.length) return;
    const rows = items
      .filter(r => r.requestId && agentUuid(r.source))
      .map(r => ({
        request_id: r.requestId,
        agent_id: agentUuid(r.source),
        project_id: projectUuid(r.projectId),
        task_id: taskUuid(r.taskId),
        action: r.mode || r.action || 'update',
        status: r.status || 'completed',
        payload: r.payload || {},
        result: r.result ?? null,
        error_message: r.errorMessage || null,
        internal_tag: r.internalTag || null,
        received_at: r.receivedAt || new Date().toISOString(),
        processed_at: r.processedAt || null
      }));
    if (!rows.length) return;
    const { error } = await client.from('ai_requests').upsert(rows, { onConflict: 'request_id' });
    if (error) throw new Error(`ai_requests: ${error.message}`);
    trace(TAGS.AI_SYNC, 'Requêtes IA synchronisées', { count: rows.length });
  }

  async function syncReports(items) {
    if (!items.length) return;
    const rows = items.map(r => ({
      client_key: r.id,
      member_id: memberUuid(r.personId) || memberUuid(currentMember.client_key),
      report_date: r.reportDate,
      kind: 'source',
      source_type: r.source === 'ai' ? 'ai' : 'manual',
      ai_agent_id: agentUuid(r.sourceAgent),
      summary: r.summary || '',
      done_summary: r.summary || '',
      achievements: array(r.achievements),
      blockers_items: array(r.blockers),
      next_steps_items: array(r.nextSteps),
      blockers: array(r.blockers).join('\n'),
      next_steps: array(r.nextSteps).join('\n'),
      status: r.validatedAt ? 'validated' : (r.status || 'draft'),
      validated_by_member_id: memberUuid(r.validatedBy),
      validated_at: r.validatedAt || null
    }));
    const saved = await upsertReturning('daily_reports', rows);
    remember(maps.reportsByClient, maps.reportsByUuid, saved);

    for (const report of items) {
      const rUuid = reportUuid(report.id);
      if (!rUuid) continue;
      const { error: delError } = await client.from('daily_report_projects').delete().eq('report_id', rUuid);
      if (delError) throw new Error(`daily_report_projects(delete): ${delError.message}`);
      const projects = [...new Set(array(report.projectIds).map(projectUuid).filter(Boolean))];
      if (projects.length) {
        const { error } = await client.from('daily_report_projects').insert(
          projects.map(project_id => ({ report_id: rUuid, project_id }))
        );
        if (error) throw new Error(`daily_report_projects(insert): ${error.message}`);
      }
    }
    trace(TAGS.REPORT_SYNC, 'Comptes rendus synchronisés', { count: items.length });
  }

  async function syncDiff(before, after) {
    const projectChanges = changedItems(before?.projects, after?.projects);
    const agentChanges = changedItems(before?.aiAgents, after?.aiAgents);
    const taskChanges = changedItems(before?.tasks, after?.tasks);
    const changeChanges = changedItems(before?.changeRequests, after?.changeRequests);
    const notifChanges = changedItems(before?.notifications, after?.notifications);
    const activityChanges = changedItems(before?.activity, after?.activity);
    const documentChanges = changedItems(before?.documents, after?.documents);
    const aiRequestChanges = changedItems(before?.aiRequests, after?.aiRequests, 'requestId');
    const reportChanges = changedItems(before?.dailyReports, after?.dailyReports);

    trace(TAGS.DIFF_SYNC, 'Diff local détecté', {
      projects: projectChanges.length,
      agents: agentChanges.length,
      tasks: taskChanges.length,
      changes: changeChanges.length,
      notifications: notifChanges.length,
      activity: activityChanges.length,
      documents: documentChanges.length,
      aiRequests: aiRequestChanges.length,
      reports: reportChanges.length
    });

    // Ordre volontaire : les tables parentes sont enregistrées avant leurs références.
    await syncProjects(projectChanges);
    await syncAgents(agentChanges);
    await syncTasks(taskChanges);
    await syncChanges(changeChanges);
    await syncNotifications(notifChanges);
    await syncActivity(activityChanges);
    await syncDocuments(documentChanges);
    await syncAiRequests(aiRequestChanges);
    await syncReports(reportChanges);

    lastSyncedAt = new Date().toISOString();
    lastError = null;
  }

  async function flushLoop() {
    if (syncing || !pendingState) return;
    syncing = true;

    try {
      while (pendingState) {
        const target = pendingState;
        pendingState = null;

        await syncDiff(baselineState || {}, target);

        baselineState = clone(target);
        clearPending();
        lastError = null;
      }
    } catch (error) {
      console.error(`[${TAGS.DIFF_SYNC}]`, error);
      lastError = error.message || String(error);

      // On conserve la dernière version locale et on réessaie plus tard,
      // sans bloquer l'interface ni le prochain rechargement.
      if (!pendingState) {
        pendingState = safeParse(localStorage.getItem(pendingKey()), null);
      }

      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        if (pendingState) flushLoop();
      }, SYNC_RETRY_MS);
    } finally {
      syncing = false;
    }
  }

  function scheduleSync(state) {
    pendingState = clone(state);
    storePending(state);
    clearTimeout(syncTimer);
    syncTimer = setTimeout(flushLoop, 250);
  }

  function installStateWatcher() {
    if (stateWatcherTimer) clearInterval(stateWatcherTimer);

    lastObservedRaw = localStorage.getItem(STORAGE_KEY) || '';

    // V12.2 : on n'écrase plus Storage.prototype.setItem.
    // On observe le cache local à intervalle court et on ne synchronise
    // que lorsqu'il a réellement changé.
    stateWatcherTimer = setInterval(() => {
      const raw = localStorage.getItem(STORAGE_KEY) || '';
      if (!raw || raw === lastObservedRaw) return;

      lastObservedRaw = raw;
      const nextState = safeParse(raw, null);
      if (nextState) scheduleSync(nextState);
    }, STATE_WATCH_INTERVAL_MS);
  }

  function restorePendingWithoutBlocking(remoteState) {
    const raw = localStorage.getItem(pendingKey());
    if (!raw) return remoteState;

    const pending = safeParse(raw, null);
    if (!pending || !Array.isArray(pending.projects) || !Array.isArray(pending.tasks)) {
      clearPending();
      return remoteState;
    }

    trace(TAGS.RECOVERY, 'Synchronisation interrompue retrouvée — reprise en arrière-plan');

    pendingState = clone(pending);
    return pending;
  }

  async function prepareSession({ supabaseClient, userId, profile, member }) {
    client = supabaseClient;
    auth = { userId, profile };
    currentMember = member;

    let remoteState;

    try {
      remoteState = await withTimeout(
        loadRemoteState(),
        REMOTE_LOAD_TIMEOUT_MS,
        'Chargement Supabase'
      );
    } catch (error) {
      // Mode de secours : l'application reste accessible avec le dernier cache local.
      // On ne laisse plus l'utilisateur bloqué sur l'écran de chargement.
      console.error(`[${TAGS.HYDRATE}]`, error);
      lastError = error.message || String(error);

      const cached = safeParse(localStorage.getItem(STORAGE_KEY), null);
      if (!cached || !Array.isArray(cached.projects) || !Array.isArray(cached.tasks)) {
        throw error;
      }

      baselineState = clone(cached);
      writeLocalState(cached);
      installStateWatcher();

      trace(TAGS.HYDRATE, 'Mode cache local temporaire activé', {
        reason: lastError
      });

      return cached;
    }

    baselineState = clone(remoteState);

    // Une ancienne synchro inachevée ne bloque plus le démarrage :
    // on réaffiche son état immédiatement et on la rejoue ensuite en arrière-plan.
    const bootState = restorePendingWithoutBlocking(remoteState);

    writeLocalState(bootState);
    installStateWatcher();

    if (pendingState) {
      setTimeout(flushLoop, 100);
    }

    window.PILOTAGE_REMOTE_STATUS = {
      mode: 'supabase',
      get lastSyncedAt() { return lastSyncedAt; },
      get lastError() { return lastError; }
    };

    trace(TAGS.HYDRATE, 'Pilotage hydraté depuis Supabase', {
      projects: bootState.projects.length,
      tasks: bootState.tasks.length,
      reports: array(bootState.dailyReports).length,
      recoveryPending: Boolean(pendingState)
    });

    return bootState;
  }

  async function refreshFromSupabase(options = {}) {
    if (!client || !auth) return null;
    const reload = options?.reload !== false;

    if (pendingState) {
      await withTimeout(flushLoop(), 6000, 'Synchronisation en cours').catch(error => {
        lastError = error.message || String(error);
      });
    }

    // Ne jamais écraser un changement local encore non synchronisé.
    if (pendingState) return null;

    try {
      const remoteState = await withTimeout(
        loadRemoteState(),
        REMOTE_LOAD_TIMEOUT_MS,
        'Actualisation Supabase'
      );
      baselineState = clone(remoteState);
      writeLocalState(remoteState);

      if (reload) {
        window.location.reload();
      }

      return remoteState;
    } catch (error) {
      lastError = error.message || String(error);
      console.error(`[${TAGS.HYDRATE}]`, error);
      throw error;
    }
  }

  async function flush() {
    if (!pendingState) return;
    await withTimeout(flushLoop(), 5000, 'Synchronisation finale').catch(error => {
      lastError = error.message || String(error);
    });
  }

  window.PILOTAGE_REMOTE = Object.freeze({
    prepareSession,
    refreshFromSupabase,
    flush,
    getStatus: () => ({
      mode: 'supabase',
      lastSyncedAt,
      lastError,
      syncing,
      hasPending: Boolean(pendingState || (auth?.userId && localStorage.getItem(pendingKey()))),
      transport: 'polling-safe-v12.2'
    })
  });
})();
