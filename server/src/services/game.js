'use strict';

const { STATUS, ROLE, PALETTE } = require('../constants');

const MUTABLE_SETTINGS = ['hideSeconds', 'roundSeconds', 'caughtBecome', 'seekerCount'];

const clamp01 = (n) => Math.min(1, Math.max(0, n));

/**
 * The whole game lives in memory on a single Strapi node: a round is short,
 * a crash just sends everyone back to the lobby, and nothing here is worth a
 * database round-trip at 20Hz.
 */
module.exports = ({ strapi }) => {
  const config = () => strapi.config.get('plugin::hide-and-seek');

  const state = {
    status: STATUS.LOBBY,
    /** Bumped whenever the lobby-visible state changes, so we only broadcast on change. */
    version: 0,
    phaseEndsAt: null,
    roundEndsAt: null,
    startedAt: null,
    result: null,
    players: new Map(),
    /** `${seekerId}:${hiderId}` -> timestamp the cursor lock started. */
    holds: new Map(),
    events: [],
    settings: null,
  };

  const touch = () => {
    state.version += 1;
  };

  const emit = (event) => {
    state.events.push(event);
  };

  const settings = () => {
    if (!state.settings) {
      const cfg = config();
      state.settings = MUTABLE_SETTINGS.reduce((acc, key) => ({ ...acc, [key]: cfg[key] }), {});
    }
    return state.settings;
  };

  const nextColor = () => {
    const taken = new Set([...state.players.values()].map((p) => p.color));
    return PALETTE.find((c) => !taken.has(c)) ?? PALETTE[state.players.size % PALETTE.length];
  };

  const createPlayer = (user) => ({
    id: String(user.id),
    name:
      [user.firstname, user.lastname].filter(Boolean).join(' ').trim() ||
      user.username ||
      user.email,
    color: nextColor(),
    connected: true,
    sockets: new Set(),
    ready: false,
    role: ROLE.SPECTATOR,
    caught: false,
    page: null,
    pageAt: 0,
    cursor: { x: 0.5, y: 0.5 },
    lastMoveAt: 0,
    disconnectedAt: null,
    foundCount: 0,
    /** While in the future, this player is stuck on their current page. */
    lockedUntil: 0,
  });

  const playerBySocket = (socketId) =>
    [...state.players.values()].find((p) => p.sockets.has(socketId));

  const activeHiders = () =>
    [...state.players.values()].filter((p) => p.role === ROLE.HIDER && !p.caught);

  /* ------------------------------------------------------------------ *
   * Connection lifecycle
   * ------------------------------------------------------------------ */

  const join = (user, socketId) => {
    let player = state.players.get(String(user.id));

    if (!player) {
      player = createPlayer(user);
      state.players.set(player.id, player);
    }

    player.sockets.add(socketId);
    player.connected = true;
    player.disconnectedAt = null;
    touch();

    return player;
  };

  const leave = (socketId) => {
    const player = playerBySocket(socketId);

    if (!player) {
      return null;
    }

    player.sockets.delete(socketId);

    if (player.sockets.size === 0) {
      player.connected = false;
      player.disconnectedAt = Date.now();
      player.page = null;

      // Nobody left to play against: wipe the player entirely while in lobby.
      if (state.status === STATUS.LOBBY) {
        state.players.delete(player.id);
      }
    }

    touch();

    return player;
  };

  /* ------------------------------------------------------------------ *
   * Lobby
   * ------------------------------------------------------------------ */

  const setReady = (playerId, ready) => {
    const player = state.players.get(playerId);

    if (!player || state.status !== STATUS.LOBBY) {
      return;
    }

    player.ready = Boolean(ready);
    touch();
  };

  const updateSettings = (patch = {}) => {
    if (state.status !== STATUS.LOBBY) {
      return;
    }

    const current = settings();

    MUTABLE_SETTINGS.forEach((key) => {
      if (patch[key] === undefined) {
        return;
      }

      if (key === 'caughtBecome') {
        if ([ROLE.SEEKER, ROLE.SPECTATOR].includes(patch[key])) {
          current[key] = patch[key];
        }
        return;
      }

      const value = Number(patch[key]);

      if (Number.isFinite(value) && value > 0) {
        current[key] = Math.floor(value);
      }
    });

    touch();
  };

  const start = () => {
    if (![STATUS.LOBBY, STATUS.OVER].includes(state.status)) {
      return { ok: false, error: 'A round is already running' };
    }

    const candidates = [...state.players.values()].filter((p) => p.connected && p.ready);

    if (candidates.length < 2) {
      return { ok: false, error: 'Need at least 2 ready players' };
    }

    const cfg = settings();
    const seekerCount = Math.min(Math.max(1, cfg.seekerCount), candidates.length - 1);
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const seekers = new Set(shuffled.slice(0, seekerCount).map((p) => p.id));

    state.players.forEach((player) => {
      player.caught = false;
      player.foundCount = 0;
      player.page = null;
      player.pageAt = 0;

      if (!player.connected || !player.ready) {
        player.role = ROLE.SPECTATOR;
        return;
      }

      player.role = seekers.has(player.id) ? ROLE.SEEKER : ROLE.HIDER;
    });

    state.holds.clear();
    state.result = null;
    state.startedAt = Date.now();
    state.status = STATUS.COUNTDOWN;
    state.phaseEndsAt = Date.now() + config().countdownSeconds * 1000;
    state.roundEndsAt = null;

    emit({ type: 'phase', status: state.status });
    touch();

    return { ok: true };
  };

  const reset = () => {
    state.status = STATUS.LOBBY;
    state.phaseEndsAt = null;
    state.roundEndsAt = null;
    state.startedAt = null;
    state.result = null;
    state.holds.clear();

    state.players.forEach((player) => {
      player.role = ROLE.SPECTATOR;
      player.caught = false;
      player.page = null;
      player.pageAt = 0;
    });

    emit({ type: 'phase', status: state.status });
    touch();
  };

  /* ------------------------------------------------------------------ *
   * In-round input
   * ------------------------------------------------------------------ */

  const setPage = (playerId, page) => {
    const player = state.players.get(playerId);

    if (!player || typeof page !== 'string' || player.page === page) {
      return;
    }

    // Locked in. The client blocks the links, but a reload or the back button
    // can still move the browser — as far as the game is concerned they never
    // left the room, and they stay catchable there.
    if (state.status === STATUS.HUNTING && Date.now() < player.lockedUntil) {
      return;
    }

    player.page = page.slice(0, 512);
    player.pageAt = Date.now();
    player.lastMoveAt = Date.now();

    // Moving rooms breaks every lock the player was involved in.
    [...state.holds.keys()]
      .filter((key) => key.split(':').includes(player.id))
      .forEach((key) => state.holds.delete(key));
  };

  const setCursor = (playerId, x, y) => {
    const player = state.players.get(playerId);

    if (!player || !Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }

    const next = { x: clamp01(x), y: clamp01(y) };

    if (next.x !== player.cursor.x || next.y !== player.cursor.y) {
      player.lastMoveAt = Date.now();
    }

    player.cursor = next;
  };

  /* ------------------------------------------------------------------ *
   * Tick
   * ------------------------------------------------------------------ */

  const finish = (winner) => {
    state.status = STATUS.OVER;
    state.phaseEndsAt = null;
    state.roundEndsAt = null;
    state.result = {
      winner,
      durationMs: state.startedAt ? Date.now() - state.startedAt : 0,
      survivors: activeHiders().map((p) => ({ id: p.id, name: p.name, color: p.color })),
      scores: [...state.players.values()]
        .filter((p) => p.role !== ROLE.SPECTATOR || p.caught)
        .map((p) => ({ id: p.id, name: p.name, color: p.color, foundCount: p.foundCount })),
    };

    state.holds.clear();
    state.players.forEach((player) => {
      player.lockedUntil = 0;
    });
    emit({ type: 'over', result: state.result });
    touch();
  };

  const catchPlayer = (seeker, hider) => {
    hider.caught = true;
    hider.lockedUntil = 0;
    hider.role = settings().caughtBecome === ROLE.SEEKER ? ROLE.SEEKER : ROLE.SPECTATOR;
    seeker.foundCount += 1;

    [...state.holds.keys()]
      .filter((key) => key.endsWith(`:${hider.id}`))
      .forEach((key) => state.holds.delete(key));

    emit({
      type: 'catch',
      seekerId: seeker.id,
      seekerName: seeker.name,
      hiderId: hider.id,
      hiderName: hider.name,
    });
    touch();
  };

  /**
   * The standoff: the moment a seeker and a hider share a page, neither can
   * leave for `lockdownMs`. The hider has to dodge instead of running.
   */
  const evaluateLockdowns = (at) => {
    const { lockdownMs } = config();
    const seekers = [...state.players.values()].filter(
      (p) => p.role === ROLE.SEEKER && p.connected && p.page
    );

    seekers.forEach((seeker) => {
      activeHiders()
        .filter((hider) => hider.connected && hider.page === seeker.page)
        .forEach((hider) => {
          // The encounter starts when the second of the two arrived.
          const until = Math.max(seeker.pageAt, hider.pageAt) + lockdownMs;

          if (until <= at) {
            return;
          }

          seeker.lockedUntil = Math.max(seeker.lockedUntil, until);
          hider.lockedUntil = Math.max(hider.lockedUntil, until);
        });
    });
  };

  const evaluateCatches = (at) => {
    const cfg = config();
    const seekers = [...state.players.values()].filter(
      (p) => p.role === ROLE.SEEKER && p.connected && p.page
    );

    seekers.forEach((seeker) => {
      activeHiders()
        .filter((hider) => hider.connected && hider.page === seeker.page)
        .forEach((hider) => {
          const key = `${seeker.id}:${hider.id}`;
          const revealed =
            at - hider.lastMoveAt >= cfg.idleRevealMs ||
            at - Math.max(seeker.pageAt, hider.pageAt) >= cfg.graceMs;

          const distance = Math.hypot(
            seeker.cursor.x - hider.cursor.x,
            seeker.cursor.y - hider.cursor.y
          );

          if (!revealed || distance > cfg.catchRadius) {
            state.holds.delete(key);
            return;
          }

          const since = state.holds.get(key) ?? at;
          state.holds.set(key, since);

          if (at - since >= cfg.catchHoldMs) {
            catchPlayer(seeker, hider);
          }
        });
    });
  };

  const evaluateForfeits = (at) => {
    const cfg = config();

    activeHiders()
      .filter((p) => !p.connected && p.disconnectedAt && at - p.disconnectedAt >= cfg.forfeitAfterMs)
      .forEach((player) => {
        player.caught = true;
        player.role = ROLE.SPECTATOR;
        emit({ type: 'forfeit', hiderId: player.id, hiderName: player.name });
        touch();
      });
  };

  const tick = () => {
    const at = Date.now();
    const cfg = config();

    if (state.status === STATUS.COUNTDOWN && at >= state.phaseEndsAt) {
      state.status = STATUS.HIDING;
      state.phaseEndsAt = at + settings().hideSeconds * 1000;
      emit({ type: 'phase', status: state.status });
      touch();
    }

    if (state.status === STATUS.HIDING && at >= state.phaseEndsAt) {
      state.status = STATUS.HUNTING;
      state.phaseEndsAt = null;
      state.roundEndsAt = at + settings().roundSeconds * 1000;
      // Everyone gets a fresh grace window the moment the hunt opens.
      state.players.forEach((player) => {
        player.pageAt = at;
      });
      emit({ type: 'phase', status: state.status });
      touch();
    }

    if (state.status !== STATUS.HUNTING) {
      return;
    }

    evaluateForfeits(at);
    evaluateLockdowns(at);
    evaluateCatches(at);

    if (activeHiders().length === 0) {
      finish('seekers');
      return;
    }

    if (state.roundEndsAt && at >= state.roundEndsAt) {
      finish('hiders');
    }

    // Everyone hunting them left: nothing to do but end it.
    const liveSeekers = [...state.players.values()].filter(
      (p) => p.role === ROLE.SEEKER && p.connected
    );

    if (liveSeekers.length === 0 && at - (state.startedAt ?? at) > cfg.forfeitAfterMs) {
      finish('hiders');
    }
  };

  /* ------------------------------------------------------------------ *
   * Views
   * ------------------------------------------------------------------ */

  /** Roles stay secret until the countdown is over — that's the reveal. */
  const exposedRole = (player) =>
    state.status === STATUS.COUNTDOWN || state.status === STATUS.LOBBY ? null : player.role;

  const publicState = () => ({
    status: state.status,
    version: state.version,
    serverTime: Date.now(),
    phaseEndsAt: state.phaseEndsAt,
    roundEndsAt: state.roundEndsAt,
    settings: settings(),
    /** Exposed so the client can scale the lockdown countdown bar. */
    lockdownMs: config().lockdownMs,
    result: state.result,
    players: [...state.players.values()].map((player) => ({
      id: player.id,
      name: player.name,
      color: player.color,
      connected: player.connected,
      ready: player.ready,
      role: exposedRole(player),
      caught: player.caught,
      foundCount: player.foundCount,
    })),
  });

  const holdProgress = (seekerId, hiderId, at) => {
    const since = state.holds.get(`${seekerId}:${hiderId}`);

    return since ? clamp01((at - since) / config().catchHoldMs) : 0;
  };

  /**
   * What a single player is allowed to see on their current page. The seeker
   * never receives a hider they have not earned sight of.
   */
  const peersFor = (playerId) => {
    const player = state.players.get(playerId);

    if (!player || !player.page || state.status !== STATUS.HUNTING) {
      return [];
    }

    const at = Date.now();
    const cfg = config();
    const peers = [];

    state.players.forEach((other) => {
      if (other.id === player.id || !other.connected || other.page !== player.page) {
        return;
      }

      if (other.role === ROLE.SPECTATOR) {
        return;
      }

      let pinging = false;
      let catchProgress = 0;

      if (player.role === ROLE.SEEKER && other.role === ROLE.HIDER) {
        pinging = at - other.lastMoveAt >= cfg.idleRevealMs;

        const visible = pinging || at - Math.max(player.pageAt, other.pageAt) >= cfg.graceMs;

        if (!visible) {
          return;
        }

        catchProgress = holdProgress(player.id, other.id, at);
      }

      if (player.role === ROLE.HIDER && other.role === ROLE.SEEKER) {
        // The hider's own danger meter: how close that seeker is to catching them.
        catchProgress = holdProgress(other.id, player.id, at);
      }

      peers.push({
        id: other.id,
        name: other.name,
        color: other.color,
        role: other.role,
        x: other.cursor.x,
        y: other.cursor.y,
        pinging,
        catchProgress,
      });
    });

    return peers;
  };

  const viewFor = (playerId) => {
    const player = state.players.get(playerId);

    return {
      you: player
        ? {
            id: player.id,
            role: exposedRole(player),
            caught: player.caught,
            ready: player.ready,
            color: player.color,
            lockedUntil: player.lockedUntil,
            serverTime: Date.now(),
          }
        : null,
      peers: peersFor(playerId),
    };
  };

  const drainEvents = () => state.events.splice(0, state.events.length);

  return {
    state,
    join,
    leave,
    setReady,
    updateSettings,
    start,
    reset,
    setPage,
    setCursor,
    tick,
    publicState,
    viewFor,
    peersFor,
    drainEvents,
    playerBySocket,
  };
};
