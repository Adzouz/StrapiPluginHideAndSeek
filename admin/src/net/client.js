import { getFetchClient } from '@strapi/strapi/admin';
import { io } from 'socket.io-client';

import { refreshLocale, t } from '../i18n';
import { isExternal } from '../overlay/external';
import { PLUGIN_ID, ROLE, STATUS } from '../pluginId';
import { getState, pushToast, setState } from '../store';
import { sounds } from './sound';

/**
 * Positions arrive 20 times a second. They are deliberately kept out of React
 * state — the ghost layer reads this ref from its own animation frame.
 */
export const peersRef = { current: [] };

/** Your own slowed marker, drawn only while a seeker has you cornered. */
export const ownMarkerRef = { current: null };

/** Server-minus-client clock offset, so every countdown agrees on the deadline. */
let clockSkew = 0;

export const serverNow = () => Date.now() + clockSkew;

const RETRY_MIN_MS = 2000;
const RETRY_MAX_MS = 30000;
const CURSOR_INTERVAL_MS = 40;
const CATCH_TOAST_MS = 6000;

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
let youSignature = null;
let followId = null;
let followNavigatedAt = 0;

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

/**
 * Where you are, as the game sees it.
 *
 * Usually the pathname, but some screens keep the location in the query string
 * instead — the Media Library puts the open folder in `folder`/`folderPath`, so
 * on pathname alone every folder is one room and everyone shows up in all of
 * them. Only the keys the server nominates count; filters, sort and pagination
 * are left out on purpose, or two people looking at the same list through
 * different filters would never find each other.
 */
const pageId = () => {
  const keys = getState().game?.pageQueryKeys ?? [];
  const params = new URLSearchParams(window.location.search);
  const query = keys
    .slice()
    .sort()
    .map((key) => [key, params.get(key)])
    .filter(([, value]) => value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  return query ? `${window.location.pathname}?${query}` : window.location.pathname;
};

const reportPage = () => {
  const path = pageId();

  if (!socket || path === lastReportedPath) {
    return;
  }

  lastReportedPath = path;
  send('page', { path });
};

/**
 * Logging out is a client-side navigation too, so the socket would otherwise
 * stay open and leave a logged-out player sitting in the lobby looking present.
 */
const disconnectIfLoggedOut = () => {
  if (socket && isAuthRoute()) {
    // Say so explicitly: a dropped socket gets a grace period in case it was a
    // reload, but a logout should clear the roster straight away.
    send('bye');
    socket.close();

    return true;
  }

  return false;
};

/**
 * Logging in is a client-side navigation, not a reload, so this is where we
 * find out the session exists. Don't make the player sit through the backoff
 * that built up while they were on the login screen.
 */
const onNavigate = () => {
  if (disconnectIfLoggedOut()) {
    return;
  }

  if (!socket && !isAuthRoute()) {
    connectNow();
    return;
  }

  reportPage();
};

/* ------------------------------------------------------------------ *
 * Cursor tracking
 * ------------------------------------------------------------------ */

/**
 * Clicking away from the browser used to freeze your marker wherever you left
 * it, which made a tabbed-out hider effectively unfindable. Tell the server, and
 * it parks you in the middle of your page.
 */
const setAway = (away) => {
  send('away', { away });
};

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

const PLAYING = [STATUS.COUNTDOWN, STATUS.HIDING, STATUS.HUNTING];

const KEEP_ALIVE_MS = 60000;

let lastKeepAliveAt = 0;
/** Another tab took the game over; this one stays quiet until it is focused. */
let superseded = false;

/**
 * How long after losing the socket a hidden tab may reconnect on its own.
 *
 * Long enough to ride out a blip — a mid-round disconnection is forfeited after
 * `forfeitAfterMs` (20s by default) regardless, so nothing is saved by waiting
 * longer. Short enough that a tab which slept through a handover it was never
 * told about cannot wake up and take the game off the tab being played in: the
 * `superseded` packet is only advisory, and a connection that died without
 * delivering it leaves this tab believing it is still the holder.
 */
const RECLAIM_WINDOW_MS = 60000;

/** While in the future, this tab may reconnect without being looked at. */
let reclaimableUntil = 0;

/**
 * A hider who has found a good spot stops clicking, and Strapi eventually ends
 * an idle admin session — getting logged out mid-round, which now also removes
 * you from the game. A socket carries no HTTP activity, so poll a cheap
 * authenticated endpoint while a round is running: the admin's fetch client
 * refreshes the token off the back of it.
 */
const keepSessionAlive = () => {
  // Superseded, not merely disconnected: a tab that has handed the game over
  // would otherwise go on refreshing the session for a round it is watching
  // from the outside, for as long as it stays open. A tab that is between
  // sockets still wants its session, because it is the session the reconnect
  // is about to need — and the socket dying says nothing about whether HTTP
  // still works.
  //
  // But only while that reconnect is still on the table. A backgrounded tab
  // that loses its socket past the reclaim window returns early in `connect()`
  // and never comes back, and nothing expires `game` from the store: no TTL,
  // no timer, no `pagehide`. So `inGame()` stays true for the life of the tab
  // and this would renew that admin's session every minute for ever — the
  // same unbounded ping that was closed for the superseded tab.
  const strandedWithoutSocket = !socket && Date.now() >= reclaimableUntil;

  if (
    superseded ||
    strandedWithoutSocket ||
    !inGame() ||
    Date.now() - lastKeepAliveAt < KEEP_ALIVE_MS
  ) {
    return;
  }

  lastKeepAliveAt = Date.now();

  getFetchClient()
    .get(`/${PLUGIN_ID}/ping`)
    .catch(() => {
      /* the reconnect path already handles a dead session */
    });
};

const inGame = () => PLAYING.includes(getState().game?.status);

/**
 * Swallows clicks that would take you out of the round: everything while the
 * lockdown is on, and anything leaving this origin for as long as a game runs.
 * Capture phase, so it runs before the admin's router ever sees the click.
 */
const blockNavigation = (event) => {
  if (!(event.target instanceof Element)) {
    return;
  }

  const link = event.target.closest('a[href], [role="link"], [role="menuitem"]');

  if (!link) {
    return;
  }

  const locked = isLocked();

  if (!locked && !(inGame() && isExternal(link))) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  pushToast('bad', t(locked ? 'toast.locked' : 'toast.external'));
};

/* ------------------------------------------------------------------ *
 * Socket wiring
 * ------------------------------------------------------------------ */

const handleEvent = (event) => {
  const { playerId } = getState();

  if (event.type === 'catch') {
    if (event.hiderId === playerId) {
      sounds.caught();
      // Full screen rather than a toast: being caught ends your round, and the
      // next thing you need to know is what you just became.
      setState({
        caughtNotice: {
          // Server clock: the overlay compares this against the same one.
          at: serverNow(),
          becomes: event.becomes,
          survivedMs: event.survivedMs,
          seekerName: event.seekerName,
        },
      });
    } else if (event.seekerId === playerId) {
      sounds.found();
      pushToast('good', t('toast.youFound', { name: event.hiderName }), CATCH_TOAST_MS);
    } else {
      // Every catch is news for the whole room, not just the two involved: it is
      // how everyone still hiding learns the net is closing.
      sounds.found();
      pushToast(
        'catch',
        t('toast.someoneFound', { seeker: event.seekerName, hider: event.hiderName }),
        CATCH_TOAST_MS
      );
    }
  }

  if (event.type === 'left') {
    pushToast('neutral', t('toast.left', { name: event.name }));
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
    // An early release — a caught seeker freed, or a hider no longer cornered,
    // both of which this version can do. `setPage` refuses silently while the
    // lock holds, but `reportPage` caches the path before it is acknowledged,
    // so a player who navigated under lockdown is left in a room the server
    // still believes they are in: invisible where they are, catchable where
    // they are not. Re-announce the same way the timer branch below does.
    lastReportedPath = null;
    reportPage();

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

const FOLLOW_KEY = 'hide-and-seek:follow';
const FOLLOW_SETTLE_MS = 1500;

/**
 * A page id from another client, as a path this tab is willing to navigate to —
 * or null when it does not resolve to this origin.
 */
const localPage = (page) => {
  if (typeof page !== 'string' || !page.startsWith('/')) {
    return null;
  }

  try {
    const url = new URL(page, window.location.origin);

    return url.origin === window.location.origin ? `${url.pathname}${url.search}` : null;
  } catch {
    return null;
  }
};

const readFollow = () => {
  try {
    return window.sessionStorage.getItem(FOLLOW_KEY);
  } catch {
    return null;
  }
};

const writeFollow = (id) => {
  try {
    if (id) {
      window.sessionStorage.setItem(FOLLOW_KEY, id);
    } else {
      window.sessionStorage.removeItem(FOLLOW_KEY);
    }
  } catch {
    /* storage blocked; following just will not survive the jump */
  }
};

/**
 * Spectators tag along with a player. Following means going where they went,
 * and the admin router owns its own history, so this is a real navigation —
 * hence the settle delay, so a player hopping pages does not thrash the tab.
 */
const followTarget = (roster) => {
  if (!roster || roster.length === 0) {
    return;
  }

  const target = roster.find((entry) => entry.id === followId);

  // A page is self-reported by another client, so it is only ever followed when
  // it stays on this origin. Resolved rather than prefix-matched: the URL
  // parser treats `\` as `/` in a relative path, so `/\evil.example` looks like
  // a local path and is not one. The server refuses to store those at all; this
  // is the second lock on the same door, because this one does the navigating.
  const local = localPage(target?.page);

  if (!local) {
    return;
  }

  // Compare against the same thing the server was told, query string included,
  // or a page whose id carries one never matches and we reload for ever. Both
  // sides go through the same resolver, so neither can differ by encoding.
  if (local === localPage(pageId())) {
    followNavigatedAt = 0;
    return;
  }

  const now = Date.now();

  if (!followNavigatedAt) {
    followNavigatedAt = now;
    return;
  }

  if (now - followNavigatedAt < FOLLOW_SETTLE_MS) {
    return;
  }

  followNavigatedAt = 0;
  window.location.assign(local);
};

export const cycleFollow = (direction) => {
  const roster = getState().you?.follow ?? [];

  if (roster.length === 0) {
    return;
  }

  const index = roster.findIndex((entry) => entry.id === followId);
  const next = (index + direction + roster.length * 2) % roster.length;

  followId = roster[next].id;
  followNavigatedAt = 0;
  writeFollow(followId);
  setState({ followId });
  followTarget(roster);
};

export const stopFollowing = () => {
  followId = null;
  writeFollow(null);
  setState({ followId: null });
};

const handlePeers = ({ peers, you } = {}) => {
  peersRef.current = Array.isArray(peers) ? peers : [];
  ownMarkerRef.current = you?.slowed ? you.position : null;

  // The only clock reading that arrives during a quiet hunt: `state` is sent
  // on change, so without this the skew every countdown is measured against
  // goes stale for as long as nothing happens. Before the lockdown, which is
  // measured against it.
  if (you?.serverTime) {
    clockSkew = you.serverTime - Date.now();
  }

  setLockedUntil(you?.lockedUntil ?? 0);

  const danger =
    myRole() === ROLE.HIDER && peersRef.current.some((peer) => peer.role === ROLE.SEEKER);

  if (danger !== getState().danger) {
    if (danger) {
      sounds.alarm();
    }

    setState({ danger });
  }

  if (!you) {
    return;
  }

  if (you.follow) {
    if (!followId) {
      const stored = readFollow();

      followId = you.follow.some((entry) => entry.id === stored)
        ? stored
        : (you.follow[0]?.id ?? null);
    }

    followTarget(you.follow);
  }

  // `you` arrives 20 times a second but only changes on real events, so it goes
  // through React only when something the overlay draws actually moved.
  const signature = [
    you.role,
    you.caught,
    you.safe,
    you.slowed,
    you.away,
    you.hint?.path ?? '',
    followId ?? '',
    (you.follow ?? [])
      .map((entry) => `${entry.id}${entry.role}${entry.caught}${entry.page}`)
      .join('|'),
  ].join('~');

  if (signature !== youSignature) {
    youSignature = signature;
    setState({ you, followId });
  }
};

const DISMISSED_KEY = 'hide-and-seek:results-dismissed';

/** Rounds are told apart by when their hunt opened. */
const roundKey = (game) => String(game?.huntStartedAt ?? '');

const readDismissed = () => {
  try {
    return window.sessionStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
};

const writeDismissed = (key) => {
  try {
    if (key) {
      window.sessionStorage.setItem(DISMISSED_KEY, key);
    } else {
      window.sessionStorage.removeItem(DISMISSED_KEY);
    }
  } catch {
    /* storage blocked: the card will simply come back after the reload */
  }
};

/**
 * Closing the results card is personal, and it navigates home — which reloads
 * the admin and wipes the store. Remember the dismissal against this round so
 * the card does not reappear on the way back, while a *new* round still shows
 * its own.
 */
export const dismissResults = () => {
  writeDismissed(roundKey(getState().game));
  setState({ resultsDismissed: true });
  goHome();
};

/** The admin homepage, wherever this project mounts it. */
export const goHome = () => {
  const home = adminPath.replace(/\/$/, '') || '/admin';

  if (window.location.pathname.replace(/\/$/, '') !== home) {
    window.location.assign(home);
  }
};

/**
 * Somebody ended the round for everyone, so everyone goes back to where the
 * lobby is. A full navigation, because the admin's router owns its own history.
 */
const goHomeOnReset = (status) => {
  const previous = lastStatus;

  lastStatus = status;

  if (status !== STATUS.LOBBY || previous === null || previous === STATUS.LOBBY) {
    return;
  }

  goHome();
};

/** Restores (or drops) the dismissal that survived a reload. */
const syncDismissed = (state) => {
  const dismissed =
    state.status === STATUS.OVER && readDismissed() === roundKey(state) && roundKey(state) !== '';

  if (state.status !== STATUS.OVER && readDismissed()) {
    writeDismissed(null);
  }

  if (dismissed !== getState().resultsDismissed) {
    setState({ resultsDismissed: dismissed });
  }
};

const teardownSocket = () => {
  socket = null;
  peersRef.current = [];
  ownMarkerRef.current = null;
  youSignature = null;
  lastReportedPath = null;
  setLockedUntil(0);
  setState({ connected: false, danger: false });

  // Logged out or handed over, not a blip: drop the cached round so no overlay
  // is left hanging over the login screen, and so a superseded tab stops
  // drawing a HUD, dimming links and blocking clicks for a game it is watching
  // from the outside. A transient drop keeps its state.
  if (isAuthRoute() || superseded) {
    youSignature = null;
    setState({ game: null, playerId: null, you: null, caughtNotice: null });
  }
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

  superseded = false;
  setState({ superseded: false });

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
    syncDismissed(state);
    lastReportedPath = null;
    reportPage();
    // `away` is a fire-and-forget emit, so any change made while the socket was
    // down went nowhere, and the server carries the flag across a reconnect
    // untouched. Without this a hider who tabbed away *after* the drop comes
    // back marked present, parked at the cursor they left behind — exactly the
    // unfindable hider `setAway` exists to prevent.
    setAway(document.hidden);
  });

  instance.on('state', (state) => {
    clockSkew = state.serverTime - Date.now();
    const phaseChanged = state.status !== lastStatus;

    setState({ game: state });

    syncDismissed(state);

    goHomeOnReset(state.status);

    // The lockdown is only ever fed by the `peers` frame, and that frame stops
    // the instant the hunt ends — so the deadline the server has just zeroed
    // would live on here, with every link in the admin dead and no pill left
    // to say why. Outside the hunt there is no lockdown, full stop.
    if (state.status !== STATUS.HUNTING) {
      setLockedUntil(0);
    }

    // `start()` clears everyone's page server-side. Without re-announcing it, a
    // player who never navigates stays at no page at all: invisible, uncatchable
    // and credited with surviving.
    if (phaseChanged) {
      lastReportedPath = null;
      reportPage();
    }
  });

  instance.on('peers', handlePeers);
  instance.on('event', handleEvent);

  instance.on('superseded', () => {
    superseded = true;
    // The widget has to be able to tell this apart from a dead server: its
    // disconnected branch says "Connecting / Waiting for the game server…",
    // and the superseded path deliberately schedules no retry, so that wording
    // would sit there for ever — outliving the toast that explains it by a
    // good eight seconds.
    setState({ superseded: true });
    // Whatever this tab held, the other one holds now: it has no session to
    // win back on its own, and must wait to be looked at.
    reclaimableUntil = 0;
    pushToast('neutral', t('toast.superseded'), 8000);
    // Step aside immediately rather than waiting to be cut off, so there is no
    // window where two tabs are both reporting where this player is.
    instance.close();
  });

  instance.on('leaderboard', (rows) => {
    setState({ leaderboard: Array.isArray(rows) ? rows : [] });
  });

  instance.on('disconnect', () => {
    teardownSocket();

    // Reconnecting here would steal the game straight back and leave the two
    // tabs fighting over it. Wait until this one is focused instead.
    if (!superseded) {
      // It held the game until a moment ago, so it may win it back on its own
      // even while hidden — for as long as that claim is still fresh.
      reclaimableUntil = Date.now() + RECLAIM_WINDOW_MS;
      scheduleRetry();
    }
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

  // A background tab must not take the game off the tab being played in, so a
  // tab that has never held it waits to be looked at — see the focus handlers
  // below. A tab that was holding it moments ago and simply lost the socket is
  // a different case entirely: a hider who tabbed away to hide would otherwise
  // sit out the rest of the round and be forfeited where they stand. That
  // licence expires, because this tab's belief that it is still the holder is
  // only as fresh as the last packet it received.
  if (document.hidden && Date.now() > reclaimableUntil) {
    scheduleRetry();

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
  refreshLocale();

  window.addEventListener(NAVIGATION_EVENT, onNavigate);
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  document.addEventListener('click', blockNavigation, true);

  window.addEventListener('blur', () => setAway(true));
  window.addEventListener('focus', () => setAway(false));
  document.addEventListener('visibilitychange', () => setAway(document.hidden));

  // Safety net for navigations that bypass the history API. Page reports only:
  // routing a reconnect through here would sidestep the backoff and poll the
  // ticket endpoint once a second whenever the server is down.
  window.setInterval(() => {
    // Safety net for a logout that somehow bypassed the history hooks.
    if (disconnectIfLoggedOut()) {
      return;
    }

    reportPage();
    // Picks up a language change made in the profile page without a reload.
    refreshLocale();
    keepSessionAlive();
  }, 1000);

  // Focusing a tab hands it the game back, taking it from whichever tab holds it.
  window.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
      connectNow();
    }
  });

  window.addEventListener('focus', () => connectNow());

  // Focus alone cannot rescue a tab that was superseded while already focused
  // (a link opened in a background tab does that), so any interaction here
  // claims the game back — which is what the toast promises.
  const reclaim = () => {
    if (superseded) {
      connectNow();
    }
  };

  document.addEventListener('click', reclaim, true);
  document.addEventListener('keydown', reclaim, true);

  connect();
}
