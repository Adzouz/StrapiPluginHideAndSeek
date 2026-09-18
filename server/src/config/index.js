'use strict';

const { ROLE } = require('../constants');

module.exports = {
  default: {
    /** Seconds of "3… 2… 1…" before the seeker is revealed. */
    countdownSeconds: 3,
    /** Seconds hiders get to scatter while the seeker is blindfolded. */
    hideSeconds: 10,
    /** Hard time limit of a hunt. Hiders still free when it expires win. */
    roundSeconds: 600,
    /**
     * A hider stays invisible for this long after a seeker lands on their page.
     * Defaults to none: the lockdown already freezes them, so a grace window
     * would only blind the seeker while the hider cannot flee anyway.
     */
    graceMs: 0,
    /** Catch distance, as a fraction of the viewport diagonal. */
    catchRadius: 0.06,
    /** How long the seeker must keep the cursor on a hider to catch them. */
    catchHoldMs: 800,
    /** A hider whose cursor stops moving this long gets revealed, grace or not. */
    idleRevealMs: 2000,
    /**
     * When a seeker and a hider share a page, both are locked in for this long.
     * Without it the hider just clicks away the moment the seeker walks in.
     */
    lockdownMs: 4000,
    /**
     * How fast a cornered hider's marker can move, in viewport widths per
     * second, while a seeker shares their page. Flicking the mouse across the
     * screen no longer teleports them out of reach — they have to dodge.
     * Set to 0 to disable the slowdown.
     */
    hiderSpeedLimit: 0.55,
    /** The admin homepage is a safe zone: no lockdown, no catching. */
    safeZone: true,
    /** A seeker who has not seen anybody for this long gets a nudge. */
    hintAfterMs: 45000,
    /** How often the nudge picks a fresh target. */
    hintRepeatMs: 20000,
    /** What a caught player becomes: 'seeker' (tag team) or 'spectator'. */
    caughtBecome: ROLE.SEEKER,
    /** How many seekers are drawn at the start of a round. */
    seekerCount: 1,
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

  validator(config = {}) {
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

    if (config.safeZone !== undefined && typeof config.safeZone !== 'boolean') {
      throw new Error('[hide-and-seek] config.safeZone must be a boolean');
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

    if (config.tickHz !== undefined && config.tickHz > 60) {
      throw new Error('[hide-and-seek] config.tickHz must not exceed 60');
    }
  },
};
