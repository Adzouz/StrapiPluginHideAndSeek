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
