'use strict';

const { MODE, ROLE, DEFAULT_PAGE_QUERY_KEYS } = require('../constants');

module.exports = {
  default: {
    /** Seconds of "3… 2… 1…" before the seeker is revealed. */
    countdownSeconds: 3,
    /** Seconds hiders get to scatter while the seeker is blindfolded. Capped at 120. */
    hideSeconds: 10,
    /**
     * Hard time limit of a hunt. Hiders still free when it expires win. Capped
     * at 3600: while a round runs the plugin holds admin sessions open and
     * refuses some deletions, and neither should be able to last a week.
     */
    roundSeconds: 600,
    /**
     * A hider stays invisible for this long after a seeker lands on their page.
     * Defaults to none: the lockdown already freezes them, so a grace window
     * would only blind the seeker while the hider cannot flee anyway.
     */
    graceMs: 0,
    /** Catch distance, as a fraction of the viewport diagonal. */
    catchRadius: 0.09,
    /** How long the seeker must keep the cursor on a hider to catch them. */
    catchHoldMs: 800,
    /** A hider whose cursor stops moving this long gets revealed, grace or not. */
    idleRevealMs: 2000,
    /**
     * When a seeker and a hider share a page, both are locked in for this long.
     * Without it the hider just clicks away the moment the seeker walks in.
     */
    lockdownMs: 15000,
    /**
     * How fast a cornered hider's marker can move, in viewport widths per
     * second, while a seeker shares their page. Flicking the mouse across the
     * screen no longer teleports them out of reach — they have to dodge.
     * Set to 0 to disable the slowdown.
     */
    hiderSpeedLimit: 0.3,
    /** The admin homepage is a safe zone: no lockdown, no catching. */
    safeZone: true,
    /**
     * Query parameters that are part of *where you are*, rather than how you are
     * looking at it. The Media Library keeps the open folder in `folder` and
     * `folderPath`, so without these every folder is one room and everybody sees
     * each other regardless of which one they opened. Filters, sort and
     * pagination are deliberately not here: two people browsing the same page
     * with different filters are still in the same place.
     *
     * `null`, not the list itself, because Strapi merges plugin config with
     * lodash `defaultsDeep`, which recurses into arrays index-wise: a default of
     * `['folder', 'folderPath']` cannot be shortened by an installer, and worse,
     * `['plugins']` would merge to `['plugins', 'folderPath']` — silently
     * disarming the folder guard. A null default never joins the merge, so the
     * configured array arrives whole. The real list is
     * `DEFAULT_PAGE_QUERY_KEYS`, applied at the read site.
     */
    pageQueryKeys: null,
    /** A seeker who has not seen anybody for this long gets a nudge. */
    hintAfterMs: 45000,
    /** How often the nudge picks a fresh target. */
    hintRepeatMs: 20000,
    /** What a caught player becomes: 'seeker' (tag team) or 'spectator'. */
    caughtBecome: ROLE.SEEKER,
    /** How many seekers are drawn at the start of a round. Capped at 50. */
    seekerCount: 1,
    /**
     * 'classic' deals one or more seekers against the rest. 'manhunt' puts a
     * single named player against the entire room — everyone else is a seeker.
     */
    mode: MODE.CLASSIC,
    /** Manhunt only: who everybody is after. Falls back to a random player. */
    preyId: null,
    /**
     * Manhunt only. Being frozen in a room with a dozen hunters is an instant
     * catch, so the prey is never locked in — they can always run. The hunters
     * still are, which is what stops the swarm simply taking turns.
     */
    preyEscapesLockdown: true,
    /**
     * How long a disconnected player is held mid-round before being dropped
     * from it. Long enough to survive an accidental reload, short enough that a
     * closed tab is not hunted for the rest of the round. Between rounds the
     * seat is given up after a few seconds instead.
     */
    forfeitAfterMs: 20000,
    /** Server tick rate, also the rate positions are broadcast at. */
    tickHz: 20,
    /** socket.io CORS origin. `true` reflects the request origin (same-origin admin). */
    corsOrigin: true,
  },

  /**
   * Refuses *wrong* values; repairs *out-of-range* ones.
   *
   * The distinction decides whether an upgrade boots. Strapi rethrows anything
   * raised here as `Error regarding hide-and-seek config`, and `stopWithError`
   * exits the host CMS 1 — so a ceiling that throws turns a working install
   * into one that will not start, over a number the game is perfectly able to
   * clamp. Wrong types, unknown enum members and non-positive durations still
   * throw: there is no sane value to fall back to. Numbers that are merely too
   * large, too small or fractional are clamped in place, each with one warning
   * naming the key and the value applied.
   *
   * Mutating `config` is load-bearing: `applyUserConfig` assigns this very
   * object to `plugin.config` immediately after calling the validator, so what
   * is written here is what the plugin reads for the rest of the process.
   */
  validator(config = {}) {
    const warn = (message) => {
      const logger = globalThis.strapi && globalThis.strapi.log;

      if (logger && typeof logger.warn === 'function') {
        logger.warn(`[hide-and-seek] ${message}`);
        return;
      }

      // The validator runs during plugin load, which is early enough that a
      // logger is not guaranteed. A dropped warning is worse than a plain one.
      console.warn(`[hide-and-seek] ${message}`);
    };

    const positive = [
      'countdownSeconds',
      'hideSeconds',
      'roundSeconds',
      'catchHoldMs',
      'idleRevealMs',
      'lockdownMs',
      'hintAfterMs',
      'hintRepeatMs',
      'forfeitAfterMs',
      'seekerCount',
      'tickHz',
    ];

    positive.forEach((key) => {
      if (config[key] !== undefined && (typeof config[key] !== 'number' || config[key] <= 0)) {
        throw new Error(`[hide-and-seek] config.${key} must be a positive number`);
      }
    });

    // Every phase of a round keeps the deletion guards armed and the admin
    // session from going idle, so each phase needs a ceiling — not only the
    // three the lobby can change. A countdown measured in years is an outage
    // with a timer on it.
    //
    // Floors matter just as much, and for the same reason. `tickHz` is the only
    // thing that transitions phases, finishes rounds and sweeps disconnects, so
    // `tickHz: 0.01` leaves the guards armed a hundred seconds past the end of
    // the round; below ~4.66e-7 the computed delay overflows Node's 32-bit
    // timer and `setInterval` clamps to 1ms, giving a 1000Hz loop inside the
    // host process. And flooring 0.5 yields 0 — a round that ends on the tick
    // it begins — which is why whole units are floored to at least one.
    const bounds = {
      countdownSeconds: { min: 1, max: 60, whole: true },
      hideSeconds: { min: 1, max: 120, whole: true },
      roundSeconds: { min: 1, max: 3600, whole: true },
      seekerCount: { min: 1, max: 50, whole: true },
      tickHz: { min: 1, max: 60, whole: true },
      forfeitAfterMs: { max: 300000 },
    };

    Object.entries(bounds).forEach(([key, { min, max, whole }]) => {
      const value = config[key];

      if (value === undefined) {
        return;
      }

      let next = value;

      if (whole && !Number.isInteger(next)) {
        next = Math.floor(next);
      }

      if (min !== undefined) {
        next = Math.max(min, next);
      }

      if (max !== undefined) {
        next = Math.min(max, next);
      }

      if (next !== value) {
        config[key] = next;
        warn(`config.${key} is ${value}, which is out of range — using ${next}.`);
      }
    });

    if (
      config.hiderSpeedLimit !== undefined &&
      (typeof config.hiderSpeedLimit !== 'number' || config.hiderSpeedLimit < 0)
    ) {
      throw new Error('[hide-and-seek] config.hiderSpeedLimit must be a number >= 0');
    }

    if (
      config.graceMs !== undefined &&
      (typeof config.graceMs !== 'number' || config.graceMs < 0)
    ) {
      throw new Error('[hide-and-seek] config.graceMs must be a number >= 0');
    }

    // `preyEscapesLockdown: 'false'` is a string, and a string is truthy — it
    // would quietly turn the exemption *on*. Booleans are checked as booleans.
    ['safeZone', 'preyEscapesLockdown'].forEach((key) => {
      if (config[key] !== undefined && typeof config[key] !== 'boolean') {
        throw new Error(`[hide-and-seek] config.${key} must be a boolean`);
      }
    });

    if (config.mode !== undefined && !Object.values(MODE).includes(config.mode)) {
      throw new Error("[hide-and-seek] config.mode must be 'classic' or 'manhunt'");
    }

    // socket.io hands `cors.origin` to the `cors` package by way of engine.io,
    // which branches on `instanceof RegExp` and walks arrays element-wise — and
    // Strapi stores plugin config with a plain `config.set`, no clone and no
    // JSON round-trip, so a RegExp written in `config/plugins.ts` survives to
    // the socket server intact. Accepted here because it already worked.
    const isOrigin = (value) =>
      typeof value === 'boolean' ||
      typeof value === 'string' ||
      typeof value === 'function' ||
      value instanceof RegExp;

    if (
      config.corsOrigin !== undefined &&
      !isOrigin(config.corsOrigin) &&
      !(Array.isArray(config.corsOrigin) && config.corsOrigin.every(isOrigin))
    ) {
      throw new Error(
        '[hide-and-seek] config.corsOrigin must be a boolean, a string, a RegExp, an array of those or a function'
      );
    }

    if (config.pageQueryKeys !== undefined && config.pageQueryKeys !== null) {
      if (
        !Array.isArray(config.pageQueryKeys) ||
        config.pageQueryKeys.some((key) => typeof key !== 'string')
      ) {
        throw new Error('[hide-and-seek] config.pageQueryKeys must be an array of strings');
      }

      // Not an error — the list is yours to set — but dropping either key stops
      // the Media Library folder guard firing, with nothing else to show for it.
      const missing = DEFAULT_PAGE_QUERY_KEYS.filter((key) => !config.pageQueryKeys.includes(key));

      if (missing.length > 0) {
        warn(
          `config.pageQueryKeys omits ${missing.join(' and ')}; the Media Library folder guard will not fire.`
        );
      }
    }

    if (
      config.catchRadius !== undefined &&
      (typeof config.catchRadius !== 'number' || config.catchRadius <= 0 || config.catchRadius > 1)
    ) {
      throw new Error('[hide-and-seek] config.catchRadius must be a number between 0 and 1');
    }

    if (
      config.caughtBecome !== undefined &&
      ![ROLE.SEEKER, ROLE.SPECTATOR].includes(config.caughtBecome)
    ) {
      throw new Error("[hide-and-seek] config.caughtBecome must be 'seeker' or 'spectator'");
    }
  },
};
