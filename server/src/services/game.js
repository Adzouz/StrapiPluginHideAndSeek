'use strict';

const { STATUS, ROLE, PALETTE } = require('../constants');

const MUTABLE_SETTINGS = ['hideSeconds', 'roundSeconds', 'caughtBecome', 'seekerCount'];

/**
 * How long a disconnected player keeps their seat between rounds. Long enough
 * that reloading the admin does not lose your place in the lobby, short enough
 * that someone who closed the tab is gone before anyone wonders.
 */
const DISCONNECT_GRACE_MS = 5000;

/** Phases where a round is under way and can therefore be abandoned. */
const IN_ROUND = [STATUS.COUNTDOWN, STATUS.HIDING, STATUS.HUNTING];

const clamp01 = (n) => Math.min(1, Math.max(0, n));

const CENTRE = { x: 0.5, y: 0.5 };

const normalisePath = (path) => String(path ?? '').replace(/\/+$/, '') || '/';

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
    huntStartedAt: null,
    lastTickAt: Date.now(),
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
    cursor: { ...CENTRE },
    /**
     * Where the player actually is as far as the game is concerned. It trails
     * the real cursor when a hider is cornered, which is what makes a hider
     * catchable instead of a mouse-flick away.
     */
    gamePos: { ...CENTRE },
    lastMoveAt: 0,
    /** Tabbed away: parked in the middle of the page and easy to find. */
    away: false,
    disconnectedAt: null,
    foundCount: 0,
    /** Role this player was dealt at the start of the round, for the leaderboard. */
    startedAs: null,
    /** While in the future, this player is stuck on their current page. */
    lockedUntil: 0,
    caughtAt: null,
    /** Seekers only: last time they could see a hider, for the hint timer. */
    lastSightingAt: 0,
    hint: null,
  });

  const playerBySocket = (socketId) =>
    [...state.players.values()].find((p) => p.sockets.has(socketId));

  /** The admin homepage: a truce. No lockdown, no catching, nothing. */
  const safePath = () => normalisePath(strapi.config.get('admin.path', '/admin'));

  const isSafe = (page) => config().safeZone && normalisePath(page) === safePath();

  /** A hider sharing a page with a seeker, outside the safe zone, is slowed. */
  const isSlowed = (player) =>
    state.status === STATUS.HUNTING &&
    player.role === ROLE.HIDER &&
    !player.caught &&
    Boolean(player.page) &&
    config().hiderSpeedLimit > 0 &&
    !isSafe(player.page) &&
    [...state.players.values()].some(
      (other) => other.role === ROLE.SEEKER && other.connected && other.page === player.page
    );

  /**
   * Between rounds. `over` is not a separate screen to escape from — the lobby
   * widget is the lobby, and it stays usable while the last result is still up.
   */
  const betweenRounds = () => state.status === STATUS.LOBBY || state.status === STATUS.OVER;

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
      player.ready = false;
    }

    touch();

    return player;
  };

  /**
   * A deliberate exit — logging out — rather than a dropped connection. No
   * grace period: they told us they are going.
   */
  const forget = (playerId) => {
    const player = state.players.get(playerId);

    if (!player) {
      return;
    }

    // Mid-round too: someone who has gone should not be hunted or waited for.
    if (!betweenRounds() && player.startedAs) {
      emit({ type: 'left', playerId: player.id, name: player.name, role: player.role });
    }

    state.players.delete(playerId);
    touch();
  };

  /* ------------------------------------------------------------------ *
   * Lobby
   * ------------------------------------------------------------------ */

  const setReady = (playerId, ready) => {
    const player = state.players.get(playerId);

    if (!player || !betweenRounds()) {
      return;
    }

    player.ready = Boolean(ready);
    touch();
  };

  const updateSettings = (patch = {}) => {
    if (!betweenRounds()) {
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
    if (!betweenRounds()) {
      // Codes, not sentences: the admin panel owns the wording and the locale.
      return { ok: false, code: 'roundRunning' };
    }

    const candidates = [...state.players.values()].filter((p) => p.connected && p.ready);

    if (candidates.length < 2) {
      return { ok: false, code: 'notEnoughPlayers' };
    }

    const cfg = settings();
    const seekerCount = Math.min(Math.max(1, cfg.seekerCount), candidates.length - 1);
    const shuffled = [...candidates].sort(() => Math.random() - 0.5);
    const seekers = new Set(shuffled.slice(0, seekerCount).map((p) => p.id));

    state.players.forEach((player) => {
      player.caught = false;
      player.caughtAt = null;
      player.foundCount = 0;
      player.page = null;
      player.pageAt = 0;
      player.hint = null;
      player.lastSightingAt = 0;
      player.gamePos = { ...player.cursor };

      if (!player.connected || !player.ready) {
        player.role = ROLE.SPECTATOR;
        player.startedAs = null;
        return;
      }

      player.role = seekers.has(player.id) ? ROLE.SEEKER : ROLE.HIDER;
      player.startedAs = player.role;
    });

    state.holds.clear();
    state.result = null;
    state.startedAt = Date.now();
    state.huntStartedAt = null;
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
      player.caughtAt = null;
      player.page = null;
      player.pageAt = 0;
      player.hint = null;
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

    if (!isSlowed(player)) {
      player.gamePos = next;
    }
  };

  /**
   * A player who tabs away stops sending cursor moves, which used to make them
   * invisible in practice. Park them in the middle of their page instead: still
   * in the game, and easy to find.
   */
  const setAway = (playerId, away) => {
    const player = state.players.get(playerId);

    if (!player || player.away === Boolean(away)) {
      return;
    }

    player.away = Boolean(away);

    if (player.away) {
      player.cursor = { ...CENTRE };
      player.gamePos = { ...CENTRE };
      player.lastMoveAt = Date.now();
    }
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
      // Everyone opts in again for the next round rather than being carried
      // into it by a stale tick from the last one.
      player.ready = false;
    });

    // Only players who were actually dealt a role count towards the leaderboard.
    const participants = [...state.players.values()]
      .filter((player) => player.startedAs)
      .map((player) => ({
        id: player.id,
        name: player.name,
        color: player.color,
        startedAs: player.startedAs,
        found: player.foundCount,
        caught: player.caught,
        // Sitting out the round in the safe zone is allowed, but it does not
        // count as surviving — otherwise the homepage would win every game.
        survived: player.startedAs === ROLE.HIDER && !player.caught && !isSafe(player.page),
      }));

    emit({ type: 'over', result: state.result, participants });
    touch();
  };

  const catchPlayer = (seeker, hider) => {
    const at = Date.now();

    hider.caught = true;
    hider.caughtAt = at;
    hider.lockedUntil = 0;
    hider.role = settings().caughtBecome === ROLE.SEEKER ? ROLE.SEEKER : ROLE.SPECTATOR;
    seeker.foundCount += 1;
    seeker.lastSightingAt = at;
    seeker.hint = null;

    [...state.holds.keys()]
      .filter((key) => key.endsWith(`:${hider.id}`))
      .forEach((key) => state.holds.delete(key));

    emit({
      type: 'catch',
      seekerId: seeker.id,
      seekerName: seeker.name,
      hiderId: hider.id,
      hiderName: hider.name,
      becomes: hider.role,
      survivedMs: at - (state.huntStartedAt ?? at),
    });
    touch();
  };

  /**
   * The standoff: the moment a seeker and a hider share a page, neither can
   * leave for `lockdownMs`. The hider has to dodge instead of running.
   */
  /**
   * Cornered hiders move at a capped speed. Their marker chases the real cursor
   * instead of being it, so a fast flick buys distance over time rather than
   * instantly — the difference between a dodge and a teleport.
   */
  const updatePositions = (dtMs) => {
    const { hiderSpeedLimit } = config();
    const maxStep = (hiderSpeedLimit * dtMs) / 1000;

    state.players.forEach((player) => {
      if (!isSlowed(player)) {
        player.gamePos = { ...player.cursor };
        return;
      }

      const dx = player.cursor.x - player.gamePos.x;
      const dy = player.cursor.y - player.gamePos.y;
      const distance = Math.hypot(dx, dy);

      if (distance <= maxStep || distance === 0) {
        player.gamePos = { ...player.cursor };
        return;
      }

      player.gamePos = {
        x: clamp01(player.gamePos.x + (dx / distance) * maxStep),
        y: clamp01(player.gamePos.y + (dy / distance) * maxStep),
      };
    });
  };

  const evaluateLockdowns = (at) => {
    const { lockdownMs } = config();
    const seekers = [...state.players.values()].filter(
      (p) => p.role === ROLE.SEEKER && p.connected && p.page
    );

    seekers.forEach((seeker) => {
      if (isSafe(seeker.page)) {
        return;
      }

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
      if (isSafe(seeker.page)) {
        return;
      }

      activeHiders()
        .filter((hider) => hider.connected && hider.page === seeker.page)
        .forEach((hider) => {
          const key = `${seeker.id}:${hider.id}`;
          const revealed =
            at - hider.lastMoveAt >= cfg.idleRevealMs ||
            at - Math.max(seeker.pageAt, hider.pageAt) >= cfg.graceMs;

          // The hider's slowed marker is what gets caught, not their real cursor.
          const distance = Math.hypot(
            seeker.cursor.x - hider.gamePos.x,
            seeker.cursor.y - hider.gamePos.y
          );

          if (revealed) {
            seeker.lastSightingAt = at;
            seeker.hint = null;
          }

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

  /**
   * Ends a round nobody is left to play. Leavers are removed outright, so this
   * reads the roster rather than connection flags — a reload is still in the
   * game, a closed tab is not.
   *
   * @returns true when the round was ended
   */
  const endIfNobodyLeft = () => {
    const dealt = [...state.players.values()].filter((player) => player.startedAs);

    if (dealt.length === 0) {
      reset();

      return true;
    }

    if (!dealt.some((player) => player.role === ROLE.SEEKER)) {
      // Everyone doing the hunting has gone: the hiders were never found.
      finish('hiders');

      return true;
    }

    if (state.status === STATUS.HUNTING && activeHiders().length === 0) {
      finish('seekers');

      return true;
    }

    return false;
  };

  /**
   * A seeker who has drawn a blank for long enough gets pointed at somebody.
   * The hint names a page, not a person, and never says who is on it.
   */
  const evaluateHints = (at) => {
    const cfg = config();

    state.players.forEach((seeker) => {
      if (seeker.role !== ROLE.SEEKER || !seeker.connected) {
        return;
      }

      if (!seeker.lastSightingAt) {
        seeker.lastSightingAt = state.huntStartedAt ?? at;
      }

      if (at - seeker.lastSightingAt < cfg.hintAfterMs) {
        return;
      }

      if (seeker.hint && at - seeker.hint.at < cfg.hintRepeatMs) {
        return;
      }

      const targets = activeHiders().filter(
        (hider) => hider.connected && hider.page && hider.page !== seeker.page
      );

      if (targets.length === 0) {
        seeker.hint = null;
        return;
      }

      const target = targets[Math.floor(Math.random() * targets.length)];

      seeker.hint = { path: target.page, at };
      touch();
    });
  };

  /**
   * Drops players who are no longer here. Only between rounds: mid-round a
   * disconnection is the forfeit timer's business, not a reason to erase
   * somebody who is about to reconnect.
   */
  const sweepDisconnected = (at) => {
    // Mid-round the window is longer: an accidental reload should not cost you
    // the game, while a closed tab should not leave a ghost to hunt for long.
    const grace = betweenRounds() ? DISCONNECT_GRACE_MS : config().forfeitAfterMs;

    state.players.forEach((player) => {
      if (player.connected || at - (player.disconnectedAt ?? at) < grace) {
        return;
      }

      if (!betweenRounds() && player.startedAs) {
        emit({ type: 'left', playerId: player.id, name: player.name, role: player.role });
      }

      state.players.delete(player.id);
      touch();
    });
  };

  const tick = () => {
    const at = Date.now();
    const dtMs = Math.min(200, Math.max(0, at - state.lastTickAt));

    state.lastTickAt = at;

    if (state.status === STATUS.COUNTDOWN && at >= state.phaseEndsAt) {
      state.status = STATUS.HIDING;
      state.phaseEndsAt = at + settings().hideSeconds * 1000;
      emit({ type: 'phase', status: state.status });
      touch();
    }

    if (state.status === STATUS.HIDING && at >= state.phaseEndsAt) {
      state.status = STATUS.HUNTING;
      state.phaseEndsAt = null;
      state.huntStartedAt = at;
      state.roundEndsAt = at + settings().roundSeconds * 1000;
      // Everyone gets a fresh grace window the moment the hunt opens.
      state.players.forEach((player) => {
        player.pageAt = at;
        player.lastSightingAt = at;
      });
      emit({ type: 'phase', status: state.status });
      touch();
    }

    // Runs in every phase: a round ending is exactly when the players who
    // dropped out mid-round need clearing out.
    sweepDisconnected(at);

    if (IN_ROUND.includes(state.status) && endIfNobodyLeft()) {
      return;
    }

    if (state.status !== STATUS.HUNTING) {
      return;
    }

    updatePositions(dtMs);
    evaluateLockdowns(at);
    evaluateCatches(at);
    evaluateHints(at);

    if (activeHiders().length === 0) {
      finish('seekers');
      return;
    }

    if (state.roundEndsAt && at >= state.roundEndsAt) {
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
    /** The homepage path, so the client can badge the safe zone. */
    safePath: config().safeZone ? safePath() : null,
    huntStartedAt: state.huntStartedAt,
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

      // Spectators are out of the round, so they get to watch everything —
      // including each other. Players never see them.
      const watching = player.role === ROLE.SPECTATOR;

      if (other.role === ROLE.SPECTATOR && !watching) {
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
        caught: other.caught,
        away: other.away,
        x: other.gamePos.x,
        y: other.gamePos.y,
        pinging,
        catchProgress,
      });
    });

    return peers;
  };

  /**
   * Who a spectator can follow, and where they are. Only ever sent to players
   * who are already out of the round.
   */
  const followRoster = (player) => {
    if (!player || player.role !== ROLE.SPECTATOR || state.status !== STATUS.HUNTING) {
      return null;
    }

    return [...state.players.values()]
      .filter((other) => other.startedAs && other.connected && other.id !== player.id)
      .map((other) => ({
        id: other.id,
        name: other.name,
        role: other.role,
        caught: other.caught,
        page: other.page,
      }));
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
            away: player.away,
            safe: Boolean(player.page) && isSafe(player.page),
            slowed: isSlowed(player),
            // Your own slowed marker, so you can see what the seeker is chasing.
            position: { x: player.gamePos.x, y: player.gamePos.y },
            hint: player.role === ROLE.SEEKER ? player.hint : null,
            follow: followRoster(player),
            serverTime: Date.now(),
          }
        : null,
      peers: peersFor(playerId),
    };
  };

  /**
   * Of these admin user ids, which are currently dealt into a running round.
   * Used to refuse deleting somebody out from under the game.
   */
  const playersInRound = (ids = []) => {
    if (!IN_ROUND.includes(state.status)) {
      return [];
    }

    return ids
      .map((id) => state.players.get(String(id)))
      .filter((player) => player && player.startedAs)
      .map((player) => ({ id: player.id, name: player.name }));
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
    setAway,
    forget,
    tick,
    publicState,
    playersInRound,
    viewFor,
    peersFor,
    drainEvents,
    playerBySocket,
  };
};
