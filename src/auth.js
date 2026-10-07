(() => {
  'use strict';

  const TAGS = Object.freeze({
    AUTH_GATE: 'PILOT-AUTH-001',
    AUTH_SIGNIN: 'PILOT-AUTH-002',
    AUTH_SIGNUP: 'PILOT-AUTH-003',
    AUTH_SESSION: 'PILOT-AUTH-004',
    AUTH_SIGNOUT: 'PILOT-AUTH-005',
    AUTH_PROFILE: 'PILOT-AUTH-006',
    PUBLIC_CONFIG: 'PILOT-SEC-001',
    LIVE_UI: 'PILOT-UI-039',
    PWNED_PASSWORD: 'PILOT-AUTH-007'
  });

  const authRoot = document.querySelector('#auth-root');
  const appRoot = document.querySelector('#app');

  let client = null;
  let activeSession = null;
  let activeProfile = null;
  let activeMember = null;
  let appLoaded = false;
  let uiObserver = null;
  let uiPatchScheduled = false;

  // PILOT-MCP-OAUTH-001 — demande OAuth transmise par Supabase Auth pour ChatGPT.
  const oauthAuthorizationId = new URLSearchParams(window.location.search).get('authorization_id');

  function trace(tag, message, details = {}) {
    console.debug(`[${tag}] ${message}`, details);
  }

  function normalizeEmail(value = '') {
    return String(value).trim().toLowerCase();
  }

  function htmlEscape(value = '') {
    return String(value).replace(/[&<>'"]/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
    }[c]));
  }


  async function sha1Hex(value) {
    const data = new TextEncoder().encode(value);
    const digest = await crypto.subtle.digest('SHA-1', data);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  }

  // PILOT-AUTH-007 — contrôle gratuit HIBP Pwned Passwords par k-anonymity.
  // Le mot de passe et son hash complet ne quittent jamais le navigateur.
  async function assertPasswordNotCompromised(password) {
    trace(TAGS.PWNED_PASSWORD, 'Vérification Pwned Passwords demandée');
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      method: 'GET',
      mode: 'cors',
      cache: 'no-store',
      headers: { 'Add-Padding': 'true' }
    });

    if (!response.ok) {
      throw new Error('La vérification de sécurité du mot de passe est momentanément indisponible. Réessaie dans quelques instants.');
    }

    const body = await response.text();
    const match = body.split(/\r?\n/).find(line => line.startsWith(`${suffix}:`));
    if (!match) return;

    const count = Number(match.split(':')[1] || 0);
    if (count > 0) {
      throw new Error('Ce mot de passe apparaît dans une fuite de données connue. Choisis un mot de passe différent et unique.');
    }
  }

  function renderLoading(message = 'Connexion sécurisée…') {
    authRoot.hidden = false;
    authRoot.innerHTML = `
      <main class="auth-shell">
        <section class="auth-card auth-loading-card">
          <div class="auth-brand"><span>S</span><div><strong>SpeedArti</strong><small>Pilotage</small></div></div>
          <div class="auth-loader"></div>
          <h1>${htmlEscape(message)}</h1>
          <p>Connexion au socle Supabase.</p>
        </section>
      </main>`;
  }

  function renderAuth(message = '', mode = 'login') {
    const signup = mode === 'signup';
    authRoot.hidden = false;
    appRoot.hidden = true;
    authRoot.innerHTML = `
      <main class="auth-shell">
        <section class="auth-card">
          <div class="auth-brand"><span>S</span><div><strong>SpeedArti</strong><small>Pilotage d’entreprise</small></div></div>
          <div class="auth-heading">
            <span class="auth-kicker">ACCÈS ÉQUIPE</span>
            <h1>${signup ? 'Créer mon accès' : 'Se connecter'}</h1>
            <p>${signup
              ? 'Utilise l’adresse e-mail qui a été autorisée pour ton compte Pilotage.'
              : 'Accès sécurisé par Supabase.'}</p>
          </div>

          ${message ? `<div class="auth-message" role="status">${htmlEscape(message)}</div>` : ''}

          <form id="pilotageAuthForm" class="auth-form" novalidate>
            <label>
              <span>Adresse e-mail</span>
              <input id="authEmail" type="email" autocomplete="email" placeholder="nom@exemple.com" required />
            </label>
            <label>
              <span>Mot de passe</span>
              <input id="authPassword" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" placeholder="8 caractères minimum" minlength="8" required />
            </label>
            <button class="auth-primary" type="submit">${signup ? 'Créer mon accès' : 'Se connecter'}</button>
          </form>

          <button id="switchAuthMode" class="auth-secondary" type="button">
            ${signup ? 'J’ai déjà un compte' : 'Première connexion ? Créer mon accès'}
          </button>

          <div class="auth-security">
            <span>✓</span>
            <p>Les droits sont contrôlés côté Supabase. Les données Pilotage sont maintenant synchronisées avec la base centrale.</p>
          </div>
        </section>
      </main>`;

    const form = document.querySelector('#pilotageAuthForm');
    const email = document.querySelector('#authEmail');
    const password = document.querySelector('#authPassword');

    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const emailValue = normalizeEmail(email?.value);
      const passwordValue = password?.value || '';

      if (!emailValue) return showError('Renseigne ton adresse e-mail.');
      if (passwordValue.length < 8) return showError('Le mot de passe doit contenir au moins 8 caractères.');

      setBusy(true);
      try {
        if (signup) await signUp(emailValue, passwordValue);
        else await signIn(emailValue, passwordValue);
      } finally {
        if (!activeSession) setBusy(false);
      }
    });

    document.querySelector('#switchAuthMode')?.addEventListener('click', () => {
      renderAuth('', signup ? 'login' : 'signup');
    });

    email?.focus();
  }

  async function renderOAuthConsent() {
    if (!oauthAuthorizationId) return false;

    renderLoading('Préparation de l’autorisation ChatGPT…');

    const oauthApi = client?.auth?.oauth;
    if (!oauthApi?.getAuthorizationDetails || !oauthApi?.approveAuthorization || !oauthApi?.denyAuthorization) {
      throw new Error('Le module OAuth Supabase requis pour ChatGPT n’est pas disponible.');
    }

    const { data: details, error } = await oauthApi.getAuthorizationDetails(oauthAuthorizationId);
    if (error) throw error;
    if (!details) throw new Error('Demande d’autorisation ChatGPT introuvable ou expirée.');

    // Supabase peut renvoyer directement une URL si ce consentement a déjà été accordé.
    if (!('authorization_id' in details) && details.redirect_url) {
      window.location.assign(details.redirect_url);
      return true;
    }

    const authorizationId = details.authorization_id || oauthAuthorizationId;
    const clientName = details?.client?.name || details?.client_name || 'ChatGPT';
    const scopes = String(details?.scope || '')
      .split(/\s+/)
      .map(value => value.trim())
      .filter(Boolean);

    authRoot.hidden = false;
    appRoot.hidden = true;
    authRoot.innerHTML = `
      <main class="auth-shell">
        <section class="auth-card">
          <div class="auth-brand"><span>S</span><div><strong>SpeedArti</strong><small>Pilotage d’entreprise</small></div></div>
          <div class="auth-heading">
            <span class="auth-kicker">CONNEXION CHATGPT</span>
            <h1>Autoriser ${htmlEscape(clientName)}</h1>
            <p>Compte Pilotage : <strong>${htmlEscape(activeMember?.display_name || '')}</strong></p>
          </div>
          <div class="auth-security">
            <span>✓</span>
            <p>Cette première connexion autorise uniquement la lecture du profil, des projets et des tâches auxquels ce compte Pilotage a déjà accès.</p>
          </div>
          ${scopes.length ? `<div class="auth-account-local">Autorisation demandée : ${scopes.map(htmlEscape).join(', ')}</div>` : ''}
          <div class="auth-form">
            <button id="pilotageOauthApprove" class="auth-primary" type="button">Autoriser ChatGPT</button>
            <button id="pilotageOauthDeny" class="auth-secondary" type="button">Refuser</button>
          </div>
        </section>
      </main>`;

    const approve = document.querySelector('#pilotageOauthApprove');
    const deny = document.querySelector('#pilotageOauthDeny');

    approve?.addEventListener('click', async () => {
      approve.disabled = true;
      if (deny) deny.disabled = true;
      try {
        const { data, error: approveError } = await oauthApi.approveAuthorization(authorizationId);
        if (approveError) throw approveError;
        if (!data?.redirect_url) throw new Error('URL de retour ChatGPT absente.');
        window.location.assign(data.redirect_url);
      } catch (approveError) {
        showError(approveError.message || 'Autorisation impossible.');
        approve.disabled = false;
        if (deny) deny.disabled = false;
      }
    });

    deny?.addEventListener('click', async () => {
      approve.disabled = true;
      if (deny) deny.disabled = true;
      try {
        const { data, error: denyError } = await oauthApi.denyAuthorization(authorizationId);
        if (denyError) throw denyError;
        if (!data?.redirect_url) throw new Error('URL de retour ChatGPT absente.');
        window.location.assign(data.redirect_url);
      } catch (denyError) {
        showError(denyError.message || 'Refus impossible.');
        approve.disabled = false;
        if (deny) deny.disabled = false;
      }
    });

    trace(TAGS.AUTH_SESSION, 'Consentement OAuth ChatGPT affiché', {
      member: activeMember?.client_key || null
    });
    return true;
  }

  function showError(message) {
    let box = document.querySelector('.auth-message');
    if (!box) {
      box = document.createElement('div');
      box.className = 'auth-message auth-error';
      document.querySelector('.auth-heading')?.after(box);
    }
    box.classList.add('auth-error');
    box.textContent = message;
  }

  function setBusy(busy) {
    document.querySelectorAll('#pilotageAuthForm input, #pilotageAuthForm button, #switchAuthMode')
      .forEach(el => { el.disabled = busy; });
  }

  async function signIn(email, password) {
    trace(TAGS.AUTH_SIGNIN, 'Connexion demandée', { email });
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      showError(/invalid login credentials/i.test(error.message)
        ? 'E-mail ou mot de passe incorrect.'
        : error.message);
      return;
    }
    if (data?.session) await activateSession(data.session);
  }

  async function signUp(email, password) {
    trace(TAGS.AUTH_SIGNUP, 'Création accès demandée', { email });

    try {
      await assertPasswordNotCompromised(password);
    } catch (securityError) {
      trace(TAGS.PWNED_PASSWORD, 'Mot de passe refusé ou vérification indisponible', { message: securityError.message });
      showError(securityError.message);
      return;
    }

    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}${window.location.pathname}`,
        data: { pilotage_access: true }
      }
    });

    if (error) {
      showError(/database|not authorized|not allowed|saving new user/i.test(error.message)
        ? 'Cette adresse n’est pas autorisée pour Pilotage.'
        : error.message);
      return;
    }

    if (data?.session) return activateSession(data.session);

    renderAuth('Compte créé. Confirme l’e-mail Supabase si demandé puis reconnecte-toi.', 'login');
  }

  async function fetchIdentity(userId) {
    const [{ data: profile, error: profileError }, { data: member, error: memberError }] = await Promise.all([
      client.from('profiles')
        .select('id, display_name, initials, team_role, role, active')
        .eq('id', userId)
        .maybeSingle(),
      client.from('team_members')
        .select('id, client_key, profile_id, display_name, initials, team_role, role, active')
        .eq('profile_id', userId)
        .maybeSingle()
    ]);

    if (profileError) throw profileError;
    if (memberError) throw memberError;
    if (!profile || !member) throw new Error('Profil Pilotage introuvable.');
    if (!profile.active || !member.active) throw new Error('Cet accès Pilotage a été désactivé.');

    return { profile, member };
  }

  async function activateSession(session) {
    if (activeSession?.user?.id === session.user.id && appLoaded) return;

    renderLoading('Chargement des données Pilotage…');

    try {
      const { profile, member } = await fetchIdentity(session.user.id);

      activeSession = session;
      activeProfile = profile;
      activeMember = member;

      window.PILOTAGE_AUTH = Object.freeze({
        userId: session.user.id,
        email: normalizeEmail(session.user.email),
        profile: { ...profile },
        member: { ...member }
      });
      window.PILOTAGE_SUPABASE_CLIENT = client;

      if (oauthAuthorizationId) {
        await renderOAuthConsent();
        return;
      }

      trace(TAGS.AUTH_PROFILE, 'Identité Pilotage chargée', {
        member: member.client_key,
        role: member.role
      });

      if (!window.PILOTAGE_REMOTE?.prepareSession) {
        throw new Error('Module de synchronisation Supabase absent.');
      }

      await window.PILOTAGE_REMOTE.prepareSession({
        supabaseClient: client,
        userId: session.user.id,
        profile,
        member
      });

      trace(TAGS.AUTH_SESSION, 'Session Supabase active', {
        userId: session.user.id,
        member: member.client_key
      });

      authRoot.innerHTML = '';
      authRoot.hidden = true;
      appRoot.hidden = false;

      await loadPilotageApp();
      installLiveUi();
    } catch (error) {
      console.error(error);
      renderAuth(`Connexion impossible : ${error.message || 'erreur inconnue'}`);
    }
  }

  function loadPilotageApp() {
    if (appLoaded || window.__PILOTAGE_APP_LOADED__) {
      appLoaded = true;
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = './src/app.js?v=20261007-3';
      script.type = 'module';
      script.dataset.pilotageApp = 'true';

      script.addEventListener('load', () => {
        // L'événement load peut être émis même si le bundle rencontre une
        // erreur d'exécution. On vérifie donc que l'application a réellement
        // rendu du contenu avant de considérer le chargement comme réussi.
        setTimeout(() => {
          if (!appRoot.innerHTML.trim()) {
            reject(new Error('L’interface Pilotage ne s’est pas initialisée.'));
            return;
          }
          appLoaded = true;
          window.__PILOTAGE_APP_LOADED__ = true;
          resolve();
        }, 0);
      });

      script.addEventListener('error', () => {
        reject(new Error('Impossible de charger l’application Pilotage.'));
      });

      document.body.appendChild(script);
    });
  }

  function installLiveUi() {
    patchLiveUi();

    if (uiObserver) uiObserver.disconnect();

    // HOTFIX V12.1 :
    // La V12 rappelait patchLiveUi à chaque mutation du DOM. Or patchLiveUi
    // réécrivait lui-même le textContent de l'avatar et du titre, ce qui
    // déclenchait une nouvelle mutation puis une boucle sans fin.
    // On regroupe maintenant les mutations et patchLiveUi est idempotente.
    uiObserver = new MutationObserver(() => {
      if (uiPatchScheduled) return;
      uiPatchScheduled = true;

      queueMicrotask(() => {
        uiPatchScheduled = false;
        patchLiveUi();
      });
    });

    uiObserver.observe(appRoot, { childList: true, subtree: true });

    trace(TAGS.LIVE_UI, 'Corrections UI session active');
  }

  function patchLiveUi() {
    if (!activeMember) return;

    const greeting = [...document.querySelectorAll('.page-header h1')]
      .find(el => el.textContent?.trim() === 'Bonjour Thibault');

    const desiredGreeting = `Bonjour ${activeMember.display_name}`;
    if (greeting && greeting.textContent?.trim() !== desiredGreeting) {
      greeting.textContent = desiredGreeting;
    }

    const avatar = document.querySelector('.avatar');
    if (!avatar) return;

    const desiredInitials = activeMember.initials || '';
    if (avatar.textContent !== desiredInitials) {
      avatar.textContent = desiredInitials;
    }

    if (avatar.dataset.authBound !== 'true') {
      avatar.dataset.authBound = 'true';
      avatar.setAttribute('role', 'button');
      avatar.setAttribute('tabindex', '0');
      avatar.setAttribute('aria-label', 'Ouvrir le menu du compte');
      avatar.title = `${activeMember.display_name} — Supabase`;
    }

    if (avatar.dataset.accountListener !== 'true') {
      avatar.dataset.accountListener = 'true';

      avatar.addEventListener('click', () => toggleAccountMenu(avatar));
      avatar.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          toggleAccountMenu(avatar);
        }
      });
    }
  }

  function toggleAccountMenu(anchor) {
    const old = document.querySelector('#pilotageAccountMenu');
    if (old) return old.remove();

    const status = window.PILOTAGE_REMOTE?.getStatus?.() || {};
    const menu = document.createElement('aside');
    menu.id = 'pilotageAccountMenu';
    menu.className = 'auth-account-menu';
    menu.innerHTML = `
      <div class="auth-account-head">
        <span>${htmlEscape(activeMember?.initials || 'SA')}</span>
        <div>
          <strong>${htmlEscape(activeMember?.display_name || '')}</strong>
          <small>${htmlEscape(activeMember?.team_role || '')}</small>
        </div>
      </div>
      <div class="auth-account-email">${htmlEscape(normalizeEmail(activeSession?.user?.email))}</div>
      <div class="auth-account-status"><i></i> Supabase connecté</div>
      <div class="auth-account-local" style="background:${status.lastError ? '#fef2f2' : '#f0fdf4'};color:${status.lastError ? '#b91c1c' : '#166534'}">
        ${status.lastError
          ? `Erreur de synchro : ${htmlEscape(status.lastError)}`
          : status.hasPending
            ? 'Synchronisation en cours…'
            : 'Données métier centralisées dans Supabase.'}
      </div>
      <button id="pilotageRefreshRemote" type="button">Actualiser depuis Supabase</button>
      <button id="pilotageSignOut" type="button">Se déconnecter</button>
    `;

    document.body.appendChild(menu);

    const rect = anchor.getBoundingClientRect();
    menu.style.top = `${Math.min(window.innerHeight - menu.offsetHeight - 12, rect.bottom + 8)}px`;
    menu.style.right = `${Math.max(12, window.innerWidth - rect.right)}px`;

    menu.querySelector('#pilotageRefreshRemote')?.addEventListener('click', async () => {
      menu.remove();
      await window.PILOTAGE_REMOTE?.refreshFromSupabase?.();
    });
    menu.querySelector('#pilotageSignOut')?.addEventListener('click', signOut);
  }

  async function signOut() {
    try { await window.PILOTAGE_REMOTE?.flush?.(); }
    catch {}

    document.querySelector('#pilotageAccountMenu')?.remove();
    trace(TAGS.AUTH_SIGNOUT, 'Déconnexion');

    await client.auth.signOut();
    window.location.reload();
  }

  async function boot() {
    trace(TAGS.AUTH_GATE, 'Initialisation Auth V12.1');
    renderLoading();

    const config = window.PILOTAGE_SUPABASE;
    if (!config?.url || !config?.publishableKey) {
      return renderAuth('Configuration Supabase manquante.');
    }

    if (!window.supabase?.createClient) {
      return renderAuth('Le module Supabase n’a pas pu être chargé.');
    }

    trace(TAGS.PUBLIC_CONFIG, 'Configuration publique chargée', { url: config.url });

    client = window.supabase.createClient(config.url, config.publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    });

    window.PILOTAGE_SUPABASE_CLIENT = client;

    client.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || !session) {
        if (!appLoaded) renderAuth();
        return;
      }

      if (event === 'SIGNED_IN' && !appLoaded) {
        setTimeout(() => activateSession(session), 0);
      }
    });

    const { data, error } = await client.auth.getSession();
    if (error) {
      return renderAuth('Impossible de vérifier la session Supabase.');
    }

    if (data?.session) await activateSession(data.session);
    else renderAuth();
  }

  boot().catch(error => {
    console.error(error);
    renderAuth(`Erreur d’initialisation : ${error.message || 'inconnue'}`);
  });
})();
