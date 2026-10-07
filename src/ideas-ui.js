(() => {
  'use strict';

  const STATUS = Object.freeze({
    new: 'Nouvelle',
    under_review: 'À étudier',
    validated: 'Validée',
    planned: 'Planifiée',
    in_development: 'En développement',
    realized: 'Réalisée',
    rejected: 'Refusée',
    abandoned: 'Abandonnée'
  });
  const ORIGIN = Object.freeze({
    internal: 'Interne',
    client: 'Client',
    partner: 'Partenaire',
    user: 'Utilisateur',
    issue: 'Problème constaté'
  });
  const LEVEL = Object.freeze({ low:'Faible', medium:'Moyen', high:'Élevé' });
  const PLANNING = Object.freeze({
    backlog:'À organiser',
    this_week:'Cette semaine',
    this_month:'Ce mois',
    next_3_months:'1 à 3 mois',
    later:'Plus tard'
  });

  const ui = {
    loaded: false,
    loading: false,
    detailLoading: false,
    items: [],
    detail: null,
    detailId: null,
    error: '',
    view: 'all',
    project: 'all',
    module: 'all',
    origin: 'all',
    author: 'all',
    search: '',
    modal: null,
    editId: null,
    toast: null,
    prefillProjectKey: null,
    realtime: null,
    refreshTimer: null
  };

  let root = null;
  let ctx = null;

  function api() {
    if (!window.PILOTAGE_IDEAS) throw new Error('Module Idées indisponible.');
    return window.PILOTAGE_IDEAS;
  }

  function esc(value = '') {
    return String(value).replace(/[&<>'"]/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
    }[c]));
  }

  function safeUrl(value = '') {
    try {
      const url = new URL(String(value || ''), window.location.origin);
      return ['http:','https:'].includes(url.protocol) ? url.toString() : '';
    } catch {
      return '';
    }
  }

  function formatDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString('fr-FR', {
      day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit'
    });
  }

  function dateKey(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    const pad = n => String(n).padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  }

  function dueIso(value) {
    if (!value) return null;
    const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 18, 0, 0, 0).toISOString();
  }

  function showToast(title, message) {
    ui.toast = { title, message };
    render();
    setTimeout(() => {
      if (ui.toast?.title === title && ui.toast?.message === message) {
        ui.toast = null;
        render();
      }
    }, 5000);
  }

  function currentClientKey() {
    return ctx?.currentUser?.id || window.PILOTAGE_AUTH?.member?.client_key || '';
  }

  function canEdit(item) {
    return Boolean(ctx?.isAdmin || item?.author_client_key === currentClientKey());
  }

  function effectiveProjectKey(item) {
    return item?.project_client_key || item?.task_project_client_key || null;
  }

  function associationLabel(item) {
    if (item.association_type === 'project') {
      return item.project_name ? `Projet · ${item.project_name}` : 'Projet associé';
    }
    if (item.association_type === 'task') {
      const base = item.task_title ? `Tâche · ${item.task_title}` : 'Tâche associée';
      return item.task_project_name ? `${base} · ${item.task_project_name}` : `${base} · sans projet`;
    }
    return 'Idée indépendante';
  }

  function filteredItems() {
    let rows = [...ui.items];
    const profileIds = Array.isArray(ctx?.profileIds) ? new Set(ctx.profileIds.filter(Boolean)) : null;
    if (profileIds?.size) rows = rows.filter(item => profileIds.has(item.author_client_key));

    if (ui.view === 'top') {
      rows.sort((a,b) =>
        Number(b.like_count || 0) - Number(a.like_count || 0)
        || Number(a.dislike_count || 0) - Number(b.dislike_count || 0)
        || new Date(b.updated_at) - new Date(a.updated_at)
      );
    } else if (ui.view === 'review') {
      rows = rows.filter(x => x.status === 'under_review');
    } else if (ui.view === 'validated') {
      rows = rows.filter(x => ['validated','planned','in_development','realized'].includes(x.status));
    }

    if (ui.project !== 'all') {
      rows = rows.filter(item => {
        const key = effectiveProjectKey(item);
        return ui.project === 'none' ? !key : key === ui.project;
      });
    }
    if (ui.module !== 'all') rows = rows.filter(x => (x.module || '') === ui.module);
    if (ui.origin !== 'all') rows = rows.filter(x => x.origin === ui.origin);
    if (ui.author !== 'all') rows = rows.filter(x => x.author_client_key === ui.author);

    const q = ui.search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(x =>
        [x.title,x.description,x.module,x.project_name,x.task_title,x.author_display_name]
          .filter(Boolean)
          .some(value => String(value).toLowerCase().includes(q))
      );
    }

    return rows;
  }

  function profileScopedItems() {
    const profileIds = Array.isArray(ctx?.profileIds) ? new Set(ctx.profileIds.filter(Boolean)) : null;
    return profileIds?.size ? ui.items.filter(item => profileIds.has(item.author_client_key)) : [...ui.items];
  }

  function modules() {
    return [...new Set(profileScopedItems().map(x => x.module).filter(Boolean))]
      .sort((a,b) => a.localeCompare(b,'fr'));
  }

  function summary() {
    const scoped = profileScopedItems();
    const all = scoped.length;
    const review = scoped.filter(x => x.status === 'under_review').length;
    const validated = scoped.filter(x => ['validated','planned','in_development'].includes(x.status)).length;
    const realized = scoped.filter(x => x.status === 'realized').length;
    return { all, review, validated, realized };
  }

  function renderToast() {
    if (!ui.toast) return '';
    return `<div class="ideas-toast"><strong>${esc(ui.toast.title)}</strong><span>${esc(ui.toast.message)}</span></div>`;
  }

  function renderSummary() {
    const s = summary();
    return `
      <div class="ideas-summary">
        <article><span>💡</span><div><strong>${s.all}</strong><small>Idées</small></div></article>
        <article><span>🗳</span><div><strong>${s.review}</strong><small>À étudier</small></div></article>
        <article><span>✓</span><div><strong>${s.validated}</strong><small>Validées / actives</small></div></article>
        <article><span>🚀</span><div><strong>${s.realized}</strong><small>Réalisées</small></div></article>
      </div>`;
  }

  function renderFilters() {
    const projectOptions = (ctx?.state?.projects || [])
      .filter(p => !p.archived)
      .sort((a,b) => a.name.localeCompare(b.name,'fr'))
      .map(p => `<option value="${esc(p.id)}" ${ui.project === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
    const selectedProfiles = new Set(Array.isArray(ctx?.profileIds) ? ctx.profileIds : []);
    const authorOptions = (ctx?.state?.team || [])
      .filter(m => !selectedProfiles.size || selectedProfiles.has(m.id))
      .map(m => `<option value="${esc(m.id)}" ${ui.author === m.id ? 'selected' : ''}>${esc(m.name)}</option>`)
      .join('');
    const moduleOptions = modules()
      .map(m => `<option value="${esc(m)}" ${ui.module === m ? 'selected' : ''}>${esc(m)}</option>`)
      .join('');

    return `
      <div class="ideas-tabs">
        ${[
          ['all','Toutes'],
          ['top','Les plus soutenues'],
          ['review','À étudier'],
          ['validated','Validées']
        ].map(([id,label]) => `<button class="${ui.view === id ? 'active' : ''}" data-idea-view="${id}">${label}</button>`).join('')}
      </div>
      <div class="ideas-filters">
        <input id="ideasSearch" value="${esc(ui.search)}" placeholder="Rechercher une idée…" />
        <select id="ideasProjectFilter">
          <option value="all">Tous les projets</option>
          <option value="none" ${ui.project === 'none' ? 'selected' : ''}>Sans projet</option>
          ${projectOptions}
        </select>
        <select id="ideasModuleFilter">
          <option value="all">Tous les modules</option>
          ${moduleOptions}
        </select>
        <select id="ideasOriginFilter">
          <option value="all">Toutes les origines</option>
          ${Object.entries(ORIGIN).map(([id,label]) => `<option value="${id}" ${ui.origin === id ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
        <select id="ideasAuthorFilter">
          <option value="all">Tous les auteurs</option>
          ${authorOptions}
        </select>
      </div>`;
  }

  function levelChip(label, value, kind) {
    if (!value) return '';
    return `<span class="idea-level ${kind}-${esc(value)}">${esc(label)} : ${esc(LEVEL[value] || value)}</span>`;
  }

  function renderCard(item) {
    const likeCount = Number(item.like_count || 0);
    const dislikeCount = Number(item.dislike_count || 0);
    const neutralCount = Number(item.neutral_count || 0);
    const threshold = Number(item.vote_threshold || 1);
    const progress = Math.min(100, Math.round((likeCount / Math.max(1, threshold)) * 100));
    return `
      <article class="idea-card status-${esc(item.status)}">
        <header>
          <div>
            <div class="idea-card-kicker">
              <span class="idea-status status-${esc(item.status)}">${esc(STATUS[item.status] || item.status)}</span>
              ${item.module ? `<span class="idea-module">${esc(item.module)}</span>` : ''}
            </div>
            <button class="idea-title" data-idea-open="${esc(item.idea_id)}">${esc(item.title)}</button>
            <small>Par ${esc(item.author_display_name || 'Équipe')} · ${esc(formatDate(item.created_at))}</small>
          </div>
        </header>

        ${item.description ? `<p class="idea-description">${esc(item.description)}</p>` : ''}

        <div class="idea-association">
          <span>↳</span>
          <strong>${esc(associationLabel(item))}</strong>
        </div>

        <div class="idea-levels">
          ${levelChip('Impact', item.impact_level, 'impact')}
          ${levelChip('Effort', item.effort_level, 'effort')}
          <span class="idea-origin">${esc(ORIGIN[item.origin] || item.origin)}</span>
        </div>

        <div class="idea-vote-choices compact">
          <button class="${item.current_vote === 'like' ? 'active like' : 'like'}" data-idea-vote-choice="like" data-idea-id="${esc(item.idea_id)}" title="J’aime">
            👍 <b>${likeCount}</b>
          </button>
          <button class="${item.current_vote === 'dislike' ? 'active dislike' : 'dislike'}" data-idea-vote-choice="dislike" data-idea-id="${esc(item.idea_id)}" title="J’aime pas">
            👎 <b>${dislikeCount}</b>
          </button>
          <button class="${item.current_vote === 'neutral' ? 'active neutral' : 'neutral'}" data-idea-vote-choice="neutral" data-idea-id="${esc(item.idea_id)}" title="Je ne me prononce pas">
            ➖ <b>${neutralCount}</b>
          </button>
        </div>

        <div class="idea-vote-progress" title="Seuil automatique : ${threshold} J’aime">
          <i style="width:${progress}%"></i>
        </div>

        <footer>
          <span>👍 ${likeCount}/${threshold} pour étudier</span>
          <span>💬 ${Number(item.comment_count || 0)}</span>
          <span>🔗 ${Number(item.resource_count || 0)}</span>
          <button class="idea-open-btn" data-idea-open="${esc(item.idea_id)}">Ouvrir →</button>
        </footer>
      </article>`;
  }

  function renderList() {
    if (ui.loading && !ui.loaded) return '<div class="ideas-empty">Chargement des idées…</div>';
    if (ui.error) return `<div class="ideas-error"><strong>Module Idées indisponible</strong><p>${esc(ui.error)}</p><button class="secondary-btn" data-ideas-retry>Réessayer</button></div>`;

    const rows = filteredItems();
    return rows.length
      ? `<div class="ideas-grid">${rows.map(renderCard).join('')}</div>`
      : '<div class="ideas-empty"><span>💡</span><strong>Aucune idée dans cette vue.</strong><small>Crée une idée ou modifie les filtres.</small></div>';
  }

  function renderPage() {
    return `
      ${renderToast()}
      <div class="page-header ideas-header">
        <div>
          <h1>Idées</h1>
          <p>Centraliser, voter, étudier puis transformer les idées d’évolution en actions concrètes.</p>
        </div>
        <button class="primary-btn" data-idea-new>+ Nouvelle idée</button>
      </div>
      ${renderSummary()}
      ${renderFilters()}
      <div class="ideas-pilot-signal">
        <span>✦</span>
        <div><strong>Signal PILOTE</strong><small>${summary().review} idée${summary().review > 1 ? 's' : ''} à étudier · ${summary().validated} idée${summary().validated > 1 ? 's' : ''} validée${summary().validated > 1 ? 's' : ''} ou en cours.</small></div>
      </div>
      ${renderList()}
      ${ui.modal === 'form' ? renderIdeaForm() : ''}
      ${ui.modal === 'detail' ? renderDetail() : ''}
      ${ui.modal === 'convert' ? renderConvert() : ''}
    `;
  }

  function projectOptions(selected = '') {
    return (ctx?.state?.projects || [])
      .filter(p => !p.archived)
      .sort((a,b) => a.name.localeCompare(b.name,'fr'))
      .map(p => `<option value="${esc(p.id)}" ${selected === p.id ? 'selected' : ''}>${esc(p.name)}</option>`)
      .join('');
  }

  function taskOptions(selected = '') {
    return (ctx?.state?.tasks || [])
      .filter(t => t.status !== 'completed')
      .sort((a,b) => a.title.localeCompare(b.title,'fr'))
      .map(t => {
        const p = t.projectId ? ctx.state.projects.find(x => x.id === t.projectId) : null;
        const suffix = p ? ` · ${p.name}` : ' · sans projet';
        return `<option value="${esc(t.id)}" ${selected === t.id ? 'selected' : ''}>${esc(t.title + suffix)}</option>`;
      })
      .join('');
  }

  function renderIdeaForm() {
    const item = ui.editId ? ui.items.find(x => x.idea_id === ui.editId) : null;
    const association = item?.association_type || (ui.prefillProjectKey ? 'project' : 'none');
    const projectKey = item?.project_client_key || ui.prefillProjectKey || '';
    const taskKey = item?.task_client_key || '';

    return `
      <div class="modal-backdrop" data-idea-close></div>
      <section class="modal-card idea-modal" role="dialog" aria-modal="true">
        <header>
          <div><small>💡 IDÉE</small><h2>${item ? 'Modifier l’idée' : 'Nouvelle idée'}</h2></div>
          <button class="icon-btn" data-idea-close>×</button>
        </header>
        <div class="idea-form-body">
          <label class="form-field">
            <span>Titre *</span>
            <input id="ideaTitle" maxlength="240" value="${esc(item?.title || '')}" placeholder="Ex. Relance automatique des devis" />
          </label>
          <label class="form-field">
            <span>Description</span>
            <textarea id="ideaDescription" rows="5" maxlength="12000" placeholder="Décris le besoin, le problème ou l’amélioration…">${esc(item?.description || '')}</textarea>
          </label>

          <div class="idea-form-section">
            <strong>Associer à</strong>
            <div class="idea-association-picker">
              ${[['none','Aucune association'],['project','Projet'],['task','Tâche']].map(([id,label]) => `
                <label><input type="radio" name="ideaAssociation" value="${id}" ${association === id ? 'checked' : ''} /> <span>${label}</span></label>
              `).join('')}
            </div>
            <label class="form-field" data-idea-association-project ${association === 'project' ? '' : 'hidden'}>
              <span>Projet</span>
              <select id="ideaProject"><option value="">Choisir…</option>${projectOptions(projectKey)}</select>
            </label>
            <label class="form-field" data-idea-association-task ${association === 'task' ? '' : 'hidden'}>
              <span>Tâche existante</span>
              <select id="ideaTask"><option value="">Choisir…</option>${taskOptions(taskKey)}</select>
            </label>
          </div>

          <div class="idea-form-grid">
            <label class="form-field">
              <span>Module concerné</span>
              <input id="ideaModule" maxlength="120" value="${esc(item?.module || '')}" placeholder="Ex. Chiffrage, Agenda, Ángel…" />
            </label>
            <label class="form-field">
              <span>Origine</span>
              <select id="ideaOrigin">
                ${Object.entries(ORIGIN).map(([id,label]) => `<option value="${id}" ${item?.origin === id || (!item && id === 'internal') ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
            <label class="form-field">
              <span>Impact estimé</span>
              <select id="ideaImpact">
                <option value="">Non estimé</option>
                ${Object.entries(LEVEL).map(([id,label]) => `<option value="${id}" ${item?.impact_level === id ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
            <label class="form-field">
              <span>Effort estimé</span>
              <select id="ideaEffort">
                <option value="">Non estimé</option>
                ${Object.entries(LEVEL).map(([id,label]) => `<option value="${id}" ${item?.effort_level === id ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
        <footer>
          <button class="secondary-btn" data-idea-close>Annuler</button>
          <button class="primary-btn" data-idea-save>${item ? 'Enregistrer' : 'Créer l’idée'}</button>
        </footer>
      </section>`;
  }

  function detailIdea() {
    return ui.detail?.idea || null;
  }

  function renderStatusActions(idea) {
    if (!ctx?.isAdmin) return '';
    const buttons = [];
    if (idea.status === 'new') buttons.push(['under_review','Passer à étudier','secondary-btn']);
    if (idea.status === 'under_review') {
      buttons.push(['validated','Valider','primary-btn']);
      buttons.push(['rejected','Refuser','danger-btn']);
      buttons.push(['abandoned','Abandonner','secondary-btn']);
    }
    if (idea.status === 'validated') {
      if (!idea.converted_task_id) buttons.push(['convert','Créer une tâche','primary-btn']);
      buttons.push(['abandoned','Abandonner','secondary-btn']);
    }
    if (idea.status === 'planned') {
      buttons.push(['in_development','Passer en développement','primary-btn']);
      buttons.push(['abandoned','Abandonner','secondary-btn']);
    }
    if (idea.status === 'in_development') buttons.push(['realized','Marquer réalisée','primary-btn']);
    if (['rejected','abandoned'].includes(idea.status)) buttons.push(['under_review','Réouvrir à étudier','secondary-btn']);

    return buttons.length ? `
      <div class="idea-direction-actions">
        <strong>Direction</strong>
        <div>
          ${buttons.map(([status,label,cls]) =>
            status === 'convert'
              ? `<button class="${cls}" data-idea-convert>${label}</button>`
              : `<button class="${cls}" data-idea-status="${status}">${label}</button>`
          ).join('')}
        </div>
      </div>` : '';
  }

  function renderDetail() {
    if (ui.detailLoading || !ui.detail) {
      return `<div class="modal-backdrop" data-idea-close></div><section class="modal-card idea-detail-modal"><div class="ideas-empty">Chargement de l’idée…</div></section>`;
    }

    const idea = detailIdea();
    if (!idea) return '';
    const votes = Array.isArray(ui.detail.votes) ? ui.detail.votes : [];
    const comments = Array.isArray(ui.detail.comments) ? ui.detail.comments : [];
    const resources = Array.isArray(ui.detail.resources) ? ui.detail.resources : [];
    const current = currentClientKey();
    const canEditIdea = canEdit(idea);

    return `
      <div class="modal-backdrop" data-idea-close></div>
      <section class="modal-card idea-detail-modal" role="dialog" aria-modal="true">
        <header class="idea-detail-head">
          <div>
            <div class="idea-card-kicker">
              <span class="idea-status status-${esc(idea.status)}">${esc(STATUS[idea.status] || idea.status)}</span>
              ${idea.module ? `<span class="idea-module">${esc(idea.module)}</span>` : ''}
            </div>
            <h2>${esc(idea.title)}</h2>
            <small>Proposée par ${esc(idea.author_display_name || 'Équipe')} · ${esc(formatDate(idea.created_at))}</small>
          </div>
          <button class="icon-btn" data-idea-close>×</button>
        </header>

        <div class="idea-detail-body">
          <section class="idea-detail-main">
            <div class="idea-detail-description">
              <h3>Description</h3>
              <p>${idea.description ? esc(idea.description) : 'Aucune description.'}</p>
              ${canEditIdea ? `<button class="text-button" data-idea-edit="${esc(idea.idea_id)}">Modifier l’idée</button>` : ''}
            </div>

            <div class="idea-detail-meta">
              <button class="idea-association detail-link" data-idea-open-association>
                <span>↳</span><strong>${esc(associationLabel(idea))}</strong>
              </button>
              <div class="idea-levels">
                ${levelChip('Impact', idea.impact_level, 'impact')}
                ${levelChip('Effort', idea.effort_level, 'effort')}
                <span class="idea-origin">${esc(ORIGIN[idea.origin] || idea.origin)}</span>
              </div>
              ${idea.validated_at ? `<small>Validée par ${esc(idea.validated_by_display_name || 'Direction')} le ${esc(formatDate(idea.validated_at))}</small>` : ''}
              ${idea.converted_task_client_key ? `
                <button class="idea-converted-task" data-idea-open-converted-task="${esc(idea.converted_task_client_key)}">
                  ✓ Tâche créée : ${esc(idea.converted_task_title || idea.converted_task_client_key)} →
                </button>` : ''}
            </div>

            ${renderStatusActions(idea)}

            <section class="idea-section">
              <div class="idea-section-title">
                <div>
                  <h3>Votes</h3>
                  <small>Seuls les 👍 J’aime comptent pour le seuil automatique : ${Number(idea.like_count || 0)}/${Number(idea.vote_threshold || 1)}</small>
                </div>
              </div>

              <div class="idea-vote-choices detail">
                <button class="${idea.current_vote === 'like' ? 'active like' : 'like'}" data-idea-vote-choice="like" data-idea-id="${esc(idea.idea_id)}">
                  <span>👍</span><strong>J’aime</strong><b>${Number(idea.like_count || 0)}</b>
                </button>
                <button class="${idea.current_vote === 'dislike' ? 'active dislike' : 'dislike'}" data-idea-vote-choice="dislike" data-idea-id="${esc(idea.idea_id)}">
                  <span>👎</span><strong>J’aime pas</strong><b>${Number(idea.dislike_count || 0)}</b>
                </button>
                <button class="${idea.current_vote === 'neutral' ? 'active neutral' : 'neutral'}" data-idea-vote-choice="neutral" data-idea-id="${esc(idea.idea_id)}">
                  <span>➖</span><strong>Je ne me prononce pas</strong><b>${Number(idea.neutral_count || 0)}</b>
                </button>
              </div>

              <div class="idea-voters">
                ${votes.length ? votes.map(v => {
                  const icon = v.vote_value === 'like' ? '👍' : v.vote_value === 'dislike' ? '👎' : '➖';
                  const label = v.vote_value === 'like' ? 'J’aime' : v.vote_value === 'dislike' ? 'J’aime pas' : 'Neutre';
                  return `<span class="vote-${esc(v.vote_value || 'neutral')}"><b>${esc(v.initials || '')}</b>${esc(v.display_name || 'Membre')} · ${icon} ${label}</span>`;
                }).join('') : '<small>Aucune position pour le moment.</small>'}
              </div>
            </section>

            <section class="idea-section">
              <div class="idea-section-title"><div><h3>Commentaires</h3><small>${comments.length} échange${comments.length > 1 ? 's' : ''}</small></div></div>
              <div class="idea-comments">
                ${comments.length ? comments.map(c => `
                  <article>
                    <div><strong>${esc(c.author_display_name || 'Équipe')}</strong><time>${esc(formatDate(c.created_at))}</time></div>
                    <p>${esc(c.body)}</p>
                    ${ctx?.isAdmin || c.author_client_key === current ? `<button class="text-button danger-text" data-idea-delete-comment="${esc(c.comment_id)}">Supprimer</button>` : ''}
                  </article>
                `).join('') : '<div class="idea-empty-inline">Aucun commentaire.</div>'}
              </div>
              <form id="ideaCommentForm" class="idea-comment-form">
                <textarea id="ideaCommentBody" rows="2" maxlength="5000" placeholder="Ajouter un commentaire…" required></textarea>
                <button class="primary-btn" type="submit">Envoyer</button>
              </form>
            </section>

            <section class="idea-section">
              <div class="idea-section-title"><div><h3>Ressources</h3><small>Liens, documents ou Drive</small></div></div>
              <div class="idea-resources">
                ${resources.length ? resources.map(r => `
                  <article>
                    <span>${r.resource_type === 'drive' ? '▤' : r.resource_type === 'document' ? '📄' : '🔗'}</span>
                    <div><strong>${esc(r.label)}</strong><small>${esc(r.created_by_display_name || '')}</small></div>
                    ${safeUrl(r.url) ? `<a href="${esc(safeUrl(r.url))}" target="_blank" rel="noopener">Ouvrir</a>` : `<em>${esc(r.reference || '')}</em>`}
                    ${ctx?.isAdmin || r.created_by_client_key === current ? `<button class="icon-btn idea-delete-resource" data-idea-delete-resource="${esc(r.resource_id)}">×</button>` : ''}
                  </article>
                `).join('') : '<div class="idea-empty-inline">Aucune ressource.</div>'}
              </div>
              <form id="ideaResourceForm" class="idea-resource-form">
                <select id="ideaResourceType">
                  <option value="link">Lien</option>
                  <option value="document">Document / référence</option>
                  <option value="drive">Google Drive synchronisé</option>
                </select>
                <input id="ideaResourceLabel" maxlength="240" placeholder="Libellé" />
                <input id="ideaResourceValue" placeholder="https://… ou référence" />
                <select id="ideaResourceDrive" hidden>
                  <option value="">Choisir un fichier Drive…</option>
                  ${(ctx?.state?.driveItems || []).filter(d => !d.isFolder && !d.trashed).map(d =>
                    `<option value="${esc(d.id)}">${esc(d.name)}${d.relativePath ? ' · ' + esc(d.relativePath) : ''}</option>`
                  ).join('')}
                </select>
                <button class="secondary-btn" type="submit">+ Ajouter</button>
              </form>
            </section>
          </section>

          <aside class="idea-detail-side">
            <strong>Suivi</strong>
            <dl>
              <div><dt>Statut</dt><dd>${esc(STATUS[idea.status] || idea.status)}</dd></div>
              <div><dt>Auteur</dt><dd>${esc(idea.author_display_name || 'Équipe')}</dd></div>
              <div><dt>Origine</dt><dd>${esc(ORIGIN[idea.origin] || idea.origin)}</dd></div>
              <div><dt>Soutiens</dt><dd>👍 ${Number(idea.like_count || 0)} / ${Number(idea.vote_threshold || 1)}</dd></div>
              <div><dt>Oppositions</dt><dd>👎 ${Number(idea.dislike_count || 0)}</dd></div>
              <div><dt>Neutres</dt><dd>➖ ${Number(idea.neutral_count || 0)}</dd></div>
              <div><dt>Commentaires</dt><dd>${Number(idea.comment_count || 0)}</dd></div>
              <div><dt>Mise à jour</dt><dd>${esc(formatDate(idea.updated_at))}</dd></div>
            </dl>
          </aside>
        </div>
      </section>`;
  }

  function eligibleAssignees(projectKey) {
    const team = ctx?.state?.team || [];
    if (!projectKey) return team;
    const p = (ctx?.state?.projects || []).find(x => x.id === projectKey);
    if (!p) return team;
    const allowed = new Set([p.owner, ...(Array.isArray(p.members) ? p.members : [])].filter(Boolean));
    return team.filter(m => allowed.has(m.id));
  }

  function renderConvert() {
    const idea = detailIdea() || ui.items.find(x => x.idea_id === ui.detailId);
    if (!idea) return '';
    const defaultProject = idea.project_client_key || idea.task_project_client_key || '';
    const assignees = eligibleAssignees(defaultProject);

    return `
      <div class="modal-backdrop" data-idea-convert-close></div>
      <section class="modal-card idea-convert-modal" role="dialog" aria-modal="true">
        <header><div><small>💡 → TÂCHE</small><h2>Transformer l’idée en tâche</h2></div><button class="icon-btn" data-idea-convert-close>×</button></header>
        <div class="idea-form-body">
          <div class="idea-convert-source"><strong>${esc(idea.title)}</strong><small>La tâche gardera un lien permanent vers cette idée.</small></div>
          <label class="form-field">
            <span>Projet cible</span>
            <select id="ideaConvertProject"><option value="">Tâche seule, sans projet</option>${projectOptions(defaultProject)}</select>
          </label>
          <label class="form-field">
            <span>Responsable</span>
            <select id="ideaConvertAssignee">
              ${assignees.map(m => `<option value="${esc(m.id)}" ${m.id === currentClientKey() ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}
            </select>
          </label>
          <div class="idea-form-grid">
            <label class="form-field"><span>Priorité</span><select id="ideaConvertPriority"><option value="medium">Moyenne</option><option value="high">Haute</option><option value="urgent">Urgente</option><option value="low">Faible</option></select></label>
            <label class="form-field"><span>Roadmap</span><select id="ideaConvertPlanning"><option value="">À planifier</option>${Object.entries(PLANNING).map(([id,label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
            <label class="form-field"><span>Jour prévu</span><input id="ideaConvertScheduled" type="date" /></label>
            <label class="form-field"><span>Échéance</span><input id="ideaConvertDue" type="date" /></label>
          </div>
        </div>
        <footer><button class="secondary-btn" data-idea-convert-close>Annuler</button><button class="primary-btn" data-idea-convert-save>Créer la tâche</button></footer>
      </section>`;
  }

  function render() {
    if (!root?.isConnected) return;
    root.innerHTML = renderPage();
    bind();
  }

  async function loadList(background = false) {
    if (ui.loading) return;
    ui.loading = true;
    if (!background) render();
    try {
      ui.items = await api().list();
      ui.loaded = true;
      ui.error = '';
    } catch (error) {
      ui.error = error?.message || 'Impossible de charger les idées.';
    } finally {
      ui.loading = false;
      render();
    }
  }

  async function loadDetail(ideaId, background = false) {
    ui.detailId = ideaId;
    if (!background) ui.detailLoading = true;
    render();
    try {
      ui.detail = await api().detail(ideaId);
      ui.error = '';
    } catch (error) {
      ui.error = error?.message || 'Impossible de charger cette idée.';
      showToast('Erreur', ui.error);
    } finally {
      ui.detailLoading = false;
      render();
    }
  }

  async function refreshCurrent() {
    await loadList(true);
    if (ui.detailId && ['detail','convert'].includes(ui.modal)) {
      await loadDetail(ui.detailId, true);
    }
  }

  function scheduleRealtimeRefresh() {
    clearTimeout(ui.refreshTimer);
    ui.refreshTimer = setTimeout(() => refreshCurrent(), 120);
  }

  function ensureRealtime() {
    if (ui.realtime) return;
    try {
      ui.realtime = api().subscribe(() => scheduleRealtimeRefresh());
    } catch (error) {
      console.warn('Realtime Idées indisponible', error);
    }
  }

  function openForm(ideaId = null) {
    ui.editId = ideaId;
    ui.modal = 'form';
    render();
    requestAnimationFrame(() => document.querySelector('#ideaTitle')?.focus());
  }

  async function openDetail(ideaId) {
    ui.detailId = ideaId;
    ui.detail = null;
    ui.modal = 'detail';
    await loadDetail(ideaId);
  }

  function closeModal() {
    ui.modal = null;
    ui.editId = null;
    ui.detail = null;
    ui.detailId = null;
    ui.prefillProjectKey = null;
    render();
  }

  async function saveIdea() {
    const title = document.querySelector('#ideaTitle')?.value?.trim() || '';
    if (!title) {
      document.querySelector('#ideaTitle')?.focus();
      return;
    }
    const associationType = document.querySelector('input[name="ideaAssociation"]:checked')?.value || 'none';
    const payload = {
      title,
      description: document.querySelector('#ideaDescription')?.value || '',
      association_type: associationType,
      project_client_key: associationType === 'project' ? document.querySelector('#ideaProject')?.value || null : null,
      task_client_key: associationType === 'task' ? document.querySelector('#ideaTask')?.value || null : null,
      module: document.querySelector('#ideaModule')?.value || '',
      origin: document.querySelector('#ideaOrigin')?.value || 'internal',
      impact_level: document.querySelector('#ideaImpact')?.value || null,
      effort_level: document.querySelector('#ideaEffort')?.value || null
    };

    if (associationType === 'project' && !payload.project_client_key) return showToast('Projet requis', 'Choisis le projet à associer.');
    if (associationType === 'task' && !payload.task_client_key) return showToast('Tâche requise', 'Choisis la tâche à associer.');

    try {
      if (ui.editId) await api().update(ui.editId, payload);
      else await api().create(payload);
      const edited = ui.editId;
      ui.modal = null;
      ui.editId = null;
      ui.prefillProjectKey = null;
      await loadList(true);
      showToast(edited ? 'Idée mise à jour' : 'Idée créée', 'Les informations sont enregistrées dans Pilotage.');
    } catch (error) {
      showToast('Enregistrement impossible', error?.message || 'Erreur du module Idées.');
    }
  }

  async function setVote(ideaId, vote) {
    try {
      await api().setVote(ideaId, vote);
      await loadList(true);
      if (ui.detailId === ideaId) await loadDetail(ideaId, true);
    } catch (error) {
      showToast('Vote impossible', error?.message || 'Réessaie.');
    }
  }

  async function addComment(event) {
    event.preventDefault();
    const body = document.querySelector('#ideaCommentBody')?.value?.trim() || '';
    if (!body || !ui.detailId) return;
    try {
      await api().addComment(ui.detailId, body);
      await loadDetail(ui.detailId, true);
      await loadList(true);
    } catch (error) {
      showToast('Commentaire non envoyé', error?.message || 'Réessaie.');
    }
  }

  async function deleteComment(id) {
    try {
      await api().deleteComment(id);
      await refreshCurrent();
    } catch (error) {
      showToast('Suppression impossible', error?.message || 'Réessaie.');
    }
  }

  async function addResource(event) {
    event.preventDefault();
    if (!ui.detailId) return;

    const type = document.querySelector('#ideaResourceType')?.value || 'link';
    let label = document.querySelector('#ideaResourceLabel')?.value?.trim() || '';
    let url = null;
    let reference = null;

    if (type === 'drive') {
      const driveId = document.querySelector('#ideaResourceDrive')?.value || '';
      const item = (ctx?.state?.driveItems || []).find(d => d.id === driveId);
      if (!item) return showToast('Fichier requis', 'Choisis un fichier Google Drive synchronisé.');
      label = label || item.name;
      url = item.url || null;
      reference = item.externalFileId || item.id;
    } else {
      const value = document.querySelector('#ideaResourceValue')?.value?.trim() || '';
      if (!label || !value) return showToast('Ressource incomplète', 'Renseigne le libellé et le lien ou la référence.');
      if (type === 'link') {
        url = safeUrl(value);
        if (!url) return showToast('Lien invalide', 'Utilise une adresse http:// ou https://.');
      } else {
        reference = value;
      }
    }

    try {
      await api().addResource(ui.detailId, {
        resource_type: type,
        label,
        url,
        reference
      });
      await loadDetail(ui.detailId, true);
      await loadList(true);
    } catch (error) {
      showToast('Ressource non ajoutée', error?.message || 'Réessaie.');
    }
  }

  async function deleteResource(id) {
    try {
      await api().deleteResource(id);
      await refreshCurrent();
    } catch (error) {
      showToast('Suppression impossible', error?.message || 'Réessaie.');
    }
  }

  async function setStatus(status) {
    if (!ui.detailId) return;
    try {
      await api().setStatus(ui.detailId, status);
      await refreshCurrent();
      showToast('Statut mis à jour', STATUS[status] || status);
    } catch (error) {
      showToast('Décision impossible', error?.message || 'Réessaie.');
    }
  }

  function openConvert() {
    ui.modal = 'convert';
    render();
  }

  function closeConvert() {
    ui.modal = 'detail';
    render();
  }

  function repopulateAssignees(projectKey) {
    const select = document.querySelector('#ideaConvertAssignee');
    if (!select) return;
    const current = select.value || currentClientKey();
    const people = eligibleAssignees(projectKey);
    select.innerHTML = people.map(m =>
      `<option value="${esc(m.id)}" ${m.id === current ? 'selected' : ''}>${esc(m.name)}</option>`
    ).join('');
    if (!select.value && people[0]) select.value = people[0].id;
  }

  async function convertToTask() {
    if (!ui.detailId) return;
    const projectKey = document.querySelector('#ideaConvertProject')?.value || null;
    const assignee = document.querySelector('#ideaConvertAssignee')?.value || currentClientKey();
    try {
      const result = await api().convertToTask(ui.detailId, {
        project_client_key: projectKey,
        assignee_client_key: assignee,
        priority: document.querySelector('#ideaConvertPriority')?.value || 'medium',
        planning_bucket: document.querySelector('#ideaConvertPlanning')?.value || null,
        scheduled_for: document.querySelector('#ideaConvertScheduled')?.value || null,
        due_at: dueIso(document.querySelector('#ideaConvertDue')?.value || '')
      });
      showToast('Tâche créée', `« ${result?.title || 'Tâche'} » est liée à l’idée.`);
      await refreshCurrent();
      ui.modal = 'detail';
      render();
      if (ctx?.refreshRemote) {
        setTimeout(() => ctx.refreshRemote(), 900);
      }
    } catch (error) {
      showToast('Conversion impossible', error?.message || 'Réessaie.');
    }
  }

  function openAssociation(idea) {
    if (!idea) return;
    if (idea.association_type === 'project' && idea.project_client_key) {
      ctx?.openProject?.(idea.project_client_key);
    } else if (idea.association_type === 'task' && idea.task_client_key) {
      ctx?.openTask?.(idea.task_client_key);
    }
  }

  function bind() {
    root.querySelector('[data-idea-new]')?.addEventListener('click', () => openForm());
    root.querySelectorAll('[data-idea-open]').forEach(el => el.addEventListener('click', () => openDetail(el.dataset.ideaOpen)));
    root.querySelectorAll('[data-idea-vote-choice]').forEach(el => el.addEventListener('click', () => setVote(el.dataset.ideaId, el.dataset.ideaVoteChoice)));
    root.querySelectorAll('[data-idea-view]').forEach(el => el.addEventListener('click', () => { ui.view = el.dataset.ideaView; render(); }));
    root.querySelector('[data-ideas-retry]')?.addEventListener('click', () => loadList());

    root.querySelector('#ideasSearch')?.addEventListener('input', e => {
      ui.search = e.target.value;
      render();
      requestAnimationFrame(() => {
        const input = root.querySelector('#ideasSearch');
        if (input) {
          input.focus();
          input.setSelectionRange(input.value.length,input.value.length);
        }
      });
    });
    root.querySelector('#ideasProjectFilter')?.addEventListener('change', e => { ui.project = e.target.value; render(); });
    root.querySelector('#ideasModuleFilter')?.addEventListener('change', e => { ui.module = e.target.value; render(); });
    root.querySelector('#ideasOriginFilter')?.addEventListener('change', e => { ui.origin = e.target.value; render(); });
    root.querySelector('#ideasAuthorFilter')?.addEventListener('change', e => { ui.author = e.target.value; render(); });

    root.querySelectorAll('[data-idea-close]').forEach(el => el.addEventListener('click', closeModal));
    root.querySelector('[data-idea-save]')?.addEventListener('click', saveIdea);
    root.querySelector('[data-idea-edit]')?.addEventListener('click', () => openForm(root.querySelector('[data-idea-edit]')?.dataset.ideaEdit));

    root.querySelectorAll('input[name="ideaAssociation"]').forEach(input => input.addEventListener('change', () => {
      const value = root.querySelector('input[name="ideaAssociation"]:checked')?.value || 'none';
      const p = root.querySelector('[data-idea-association-project]');
      const t = root.querySelector('[data-idea-association-task]');
      if (p) p.hidden = value !== 'project';
      if (t) t.hidden = value !== 'task';
    }));

    root.querySelector('#ideaCommentForm')?.addEventListener('submit', addComment);
    root.querySelectorAll('[data-idea-delete-comment]').forEach(el => el.addEventListener('click', () => deleteComment(el.dataset.ideaDeleteComment)));
    root.querySelector('#ideaResourceForm')?.addEventListener('submit', addResource);
    root.querySelectorAll('[data-idea-delete-resource]').forEach(el => el.addEventListener('click', () => deleteResource(el.dataset.ideaDeleteResource)));
    root.querySelector('#ideaResourceType')?.addEventListener('change', e => {
      const drive = e.target.value === 'drive';
      const manual = root.querySelector('#ideaResourceValue');
      const driveSelect = root.querySelector('#ideaResourceDrive');
      if (manual) manual.hidden = drive;
      if (driveSelect) driveSelect.hidden = !drive;
    });

    root.querySelectorAll('[data-idea-status]').forEach(el => el.addEventListener('click', () => setStatus(el.dataset.ideaStatus)));
    root.querySelector('[data-idea-convert]')?.addEventListener('click', openConvert);
    root.querySelectorAll('[data-idea-convert-close]').forEach(el => el.addEventListener('click', closeConvert));
    root.querySelector('[data-idea-convert-save]')?.addEventListener('click', convertToTask);
    root.querySelector('#ideaConvertProject')?.addEventListener('change', e => repopulateAssignees(e.target.value || null));

    root.querySelector('[data-idea-open-association]')?.addEventListener('click', () => openAssociation(detailIdea()));
    root.querySelector('[data-idea-open-converted-task]')?.addEventListener('click', e => ctx?.openTask?.(e.currentTarget.dataset.ideaOpenConvertedTask));
  }

  async function mount(context) {
    ctx = context || {};
    root = document.querySelector('#ideasPageMount');
    if (!root) return;
    render();
    ensureRealtime();
    if (!ui.loaded) await loadList();
    else render();
  }

  async function openIdea(ideaId) {
    if (!ideaId) return;
    if (!document.querySelector('#ideasPageMount')) {
      ctx?.navigateIdeas?.();
      setTimeout(() => openIdea(ideaId), 80);
      return;
    }
    await openDetail(ideaId);
  }

  window.PILOTAGE_IDEAS_UI = Object.freeze({
    mount,
    openIdea,
    openNew: () => {
      ui.prefillProjectKey = null;
      openForm();
    },
    openNewForProject: projectClientKey => {
      ui.prefillProjectKey = projectClientKey || null;
      ui.project = projectClientKey || 'all';
      openForm();
    },
    openForProject: projectClientKey => {
      ui.project = projectClientKey || 'all';
      ui.modal = null;
      ui.detail = null;
      ui.detailId = null;
      render();
    },
    refresh: () => loadList(true)
  });
})();
