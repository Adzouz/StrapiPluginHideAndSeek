import { useSyncExternalStore } from 'react';

const MUTE_KEY = 'hide-and-seek:muted';

const readMuted = () => {
  try {
    return window.localStorage.getItem(MUTE_KEY) === 'true';
  } catch {
    return false;
  }
};

const listeners = new Set();

let state = {
  connected: false,
  playerId: null,
  /** Last `state` payload from the server, or null while disconnected. */
  game: null,
  /** True when a seeker shares the current page with us. */
  danger: false,
  /** Timestamp (server clock) until which this player cannot change page. */
  lockedUntil: 0,
  /** All-time standings, refreshed on connect and after every round. */
  leaderboard: [],
  /** Admin locale the overlay catalogue is currently loaded for. */
  locale: 'en',
  /** Your own slice of the round: role, safe zone, lockdown, hint, follow list. */
  you: null,
  /** Who a spectator is tailing. */
  followId: null,
  /** Set the moment you are caught, so the overlay can say so full screen. */
  caughtNotice: null,
  /** Whether the current hint found a link to pulse on this page. */
  hintMatched: false,
  /** You closed the results card. Yours only — it does not end anyone's round. */
  resultsDismissed: false,
  /** Transient banner: `{ id, kind, text }`. */
  toast: null,
  muted: readMuted(),
};

export const getState = () => state;

export const setState = (patch) => {
  const next = typeof patch === 'function' ? patch(state) : patch;

  state = { ...state, ...next };
  listeners.forEach((listener) => listener());
};

export const subscribe = (listener) => {
  listeners.add(listener);

  return () => listeners.delete(listener);
};

/**
 * The overlay lives in its own React root, outside the admin tree, so both
 * roots read the same plain store instead of a shared context.
 */
export const useGameStore = () => useSyncExternalStore(subscribe, getState);

export const toggleMuted = () => {
  const muted = !state.muted;

  try {
    window.localStorage.setItem(MUTE_KEY, String(muted));
  } catch {
    /* storage blocked, keep it in memory only */
  }

  setState({ muted });
};

let toastTimer = null;

export const pushToast = (kind, text, ttl = 3500) => {
  setState({ toast: { id: Date.now(), kind, text } });

  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => setState({ toast: null }), ttl);
};
