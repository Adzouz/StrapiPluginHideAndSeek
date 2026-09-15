import { getFetchClient } from '@strapi/strapi/admin';
import { io } from 'socket.io-client';

import { PLUGIN_ID, ROLE, STATUS } from '../pluginId';
import { getState, pushToast, setState } from '../store';
import { sounds } from './sound';

/**
 * Positions arrive 20 times a second. They are deliberately kept out of React
 * state — the ghost layer reads this ref from its own animation frame.
 */
export const peersRef = { current: [] };

/** Server-minus-client clock offset, so every countdown agrees on the deadline. */
let clockSkew = 0;

export const serverNow = () => Date.now() + clockSkew;

const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30000;
const CURSOR_INTERVAL_MS = 40;

let socket = null;
let connecting = false;
let retryDelay = RETRY_MIN_MS;
let retryTimer = null;
let lastReportedPath = null;
let lastCursorSentAt = 0;
let adminPath = '/admin';
let lastStatus = null;
let lockedUntil = 0;
let unlockTimer = null;

const backendURL = () => window.strapi?.backendURL || window.location.origin;

const isAuthRoute = () => /\/auth(\/|$)/.test(window.location.pathname);

const me = () => {
  const { game, playerId } = getState();

  return game?.players.find((player) => player.id === playerId) ?? null;
};

export const myRole = () => me()?.role ?? null;

export const send = (event, payload, ack) => {
  socket?.emit(event, payload, ack);
};

/* ------------------------------------------------------------------ *
 * Location tracking — a "page" is simply the admin route you are on.
 * ------------------------------------------------------------------ */

const NAVIGATION_EVENT = 'hide-and-seek:navigation';

const patchHistory = () => {
  ['pushState', 'replaceState'].forEach((method) => {
    const original = window.history[method];

    window.history[method] = function patched(...args) {
      const result = original.apply(this, args);

      window.dispatchEvent(new Event(NAVIGATION_EVENT));

      return result;
    };
  });
};

const reportPage = () => {
  const path = window.location.pathname;

  if (!socket || path === lastReportedPath) {
    return;
  }

  lastReportedPath = path;
  send('page', { path });
};

/**
 * Logging in is a client-side navigation, not a reload, so this is where we
 * find out the session exists. Don't make the player sit through the backoff
 * that built up while they were on the login screen.
 */
const onNavigate = () => {
  if (!socket && !isAuthRoute()) {
    connectNow();
    return;
  }

  reportPage();
};

/* ------------------------------------------------------------------ *
 * Cursor tracking
 * ------------------------------------------------------------------ */

const onMouseMove = (event) => {
  const { game } = getState();

  if (!socket || game?.status !== STATUS.HUNTING) {
    return;
  }

  const role = myRole();

  if (role !== ROLE.SEEKER && role !== ROLE.HIDER) {
    return;
  }

  const now = performance.now();

  if (now - lastCursorSentAt < CURSOR_INTERVAL_MS) {
    return;
  }

  lastCursorSentAt = now;

  send('cursor', {
    x: event.clientX / window.innerWidth,
    y: event.clientY / window.innerHeight,
  });
};

/**
 * Swallows clicks on anything that would navigate while the lockdown is on.
 * Capture phase, so it runs before the admin's router ever sees the click.
 */
const blockNavigation = (event) => {
  if (!isLocked() || !(event.target instanceof Element)) {
    return;
  }

  const link = event.target.closest('a[href], [role="link"], [role="menuitem"]');

  if (!link) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  pushToast('bad', 'Locked in — you cannot leave yet!');
};

/* ------------------------------------------------------------------ *
 * Socket wiring
 * ------------------------------------------------------------------ */

const handleEvent = (event) => {
  const { playerId } = getState();

  if (event.type === 'catch') {
    if (event.hiderId === playerId) {
      sounds.caught();
      pushToast('bad', `${event.seekerName} found you!`);
    } else if (event.seekerId === playerId) {
      sounds.found();
      pushToast('good', `You found ${event.hiderName}!`);
    } else {
      pushToast('neutral', `${event.seekerName} found ${event.hiderName}`);
    }
  }

  if (event.type === 'forfeit') {
    pushToast('neutral', `${event.hiderName} left the game`);
  }

  if (event.type === 'phase' && event.status === STATUS.HIDING) {
    sounds.reveal();
  }
};

export const isLocked = () => lockedUntil > serverNow();

const setLockedUntil = (next = 0) => {
  if (next === lockedUntil) {
    return;
  }

  lockedUntil = next;
  setState({ lockedUntil: next });
  window.clearTimeout(unlockTimer);

  if (next <= serverNow()) {
    return;
  }

  // The server pinned us to the room we were in, so the browser may have drifted
  // (back button, reload). Re-announce wherever we actually are once it lifts.
  unlockTimer = window.setTimeout(
    () => {
      lastReportedPath = null;
      reportPage();
    },
    next - serverNow() + 100
  );
};

const handlePeers = ({ peers, you } = {}) => {
  peersRef.current = Array.isArray(peers) ? peers : [];
  setLockedUntil(you?.lockedUntil ?? 0);

  const danger =
    myRole() === ROLE.HIDER && peersRef.current.some((peer) => peer.role === ROLE.SEEKER);

  if (danger !== getState().danger) {
    if (danger) {
      sounds.alarm();
    }

    setState({ danger });
  }
};

/**
 * The lobby lives in the homepage widget, so ending a round has to put everyone
 * back on the homepage — wherever they were hiding. A full navigation rather
 * than `pushState`, because the admin's router owns its own history.
 */
const goHomeOnReset = (status) => {
  const previous = lastStatus;

  lastStatus = status;

  if (status !== STATUS.LOBBY || previous === null || previous === STATUS.LOBBY) {
    return;
  }

  const home = adminPath.replace(/\/$/, '') || '/admin';

  if (window.location.pathname.replace(/\/$/, '') !== home) {
    window.location.assign(home);
  }
};

const teardownSocket = () => {
  socket = null;
  peersRef.current = [];
  lastReportedPath = null;
  setLockedUntil(0);
  setState({ connected: false, danger: false });
};

const scheduleRetry = () => {
  window.clearTimeout(retryTimer);
  retryTimer = window.setTimeout(() => connect(), retryDelay);
  retryDelay = Math.min(retryDelay * 2, RETRY_MAX_MS);
};

/** Something happened that makes a connection likely to succeed right now. */
const connectNow = () => {
  if (socket || connecting) {
    return;
  }

  window.clearTimeout(retryTimer);
  retryDelay = RETRY_MIN_MS;
  connect();
};

const wire = (instance) => {
  instance.on('hello', ({ playerId, state }) => {
    retryDelay = RETRY_MIN_MS;
    clockSkew = state.serverTime - Date.now();
    lastStatus = state.status;
    setState({ connected: true, playerId, game: state });
    lastReportedPath = null;
    reportPage();
  });

  instance.on('state', (state) => {
    clockSkew = state.serverTime - Date.now();
    setState({ game: state });
    goHomeOnReset(state.status);
  });

  instance.on('peers', handlePeers);
  instance.on('event', handleEvent);

  instance.on('disconnect', () => {
    teardownSocket();
    scheduleRetry();
  });

  instance.on('connect_error', () => {
    instance.close();
    teardownSocket();
    scheduleRetry();
  });
};

export async function connect() {
  if (socket || connecting) {
    return;
  }

  // The admin bootstraps on the login screen, long before there is a session to
  // authenticate with. Keep checking back instead of giving up for good.
  if (isAuthRoute()) {
    scheduleRetry();
    return;
  }

  connecting = true;

  try {
    const { get } = getFetchClient();
    const { data } = await get(`/${PLUGIN_ID}/ticket`);

    adminPath = data.adminPath || adminPath;
    const base = new URL(backendURL(), window.location.origin);
    const path = `${base.pathname.replace(/\/$/, '')}${data.socketPath}`;

    const instance = io(base.origin, {
      path,
      auth: { ticket: data.ticket },
      transports: ['websocket', 'polling'],
      // Tickets are single-use, so every reconnect has to fetch a fresh one.
      reconnection: false,
      withCredentials: true,
    });

    socket = instance;
    wire(instance);
  } catch {
    scheduleRetry();
  } finally {
    connecting = false;
  }
}

let started = false;

export function startClient() {
  if (started) {
    return;
  }

  started = true;
  patchHistory();

  window.addEventListener(NAVIGATION_EVENT, onNavigate);
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('click', blockNavigation, true);

  // Safety net for navigations that bypass the history API. Page reports only:
  // routing a reconnect through here would sidestep the backoff and poll the
  // ticket endpoint once a second whenever the server is down.
  window.setInterval(reportPage, 1000);

  window.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      connectNow();
    }
  });

  connect();
}
