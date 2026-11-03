import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const configModule = require('../../server/src/config/index.js');
const createGame = require('../../server/src/services/game.js');

export const { STATUS, ROLE, MODE } = require('../../server/src/constants.js');

/**
 * The engine on its own: no Strapi, no sockets, no clock to wait out. Phases
 * are collapsed to zero seconds and a catch lands on the first tick, so a whole
 * round is a handful of synchronous calls.
 */
export const makeGame = ({ config = {}, adminPath = '/admin', absoluteUrl = null } = {}) => {
  const cfg = {
    ...configModule.default,
    countdownSeconds: 0,
    hideSeconds: 0,
    graceMs: 0,
    catchHoldMs: 0,
    ...config,
  };

  const strapi = {
    config: {
      get: (key, fallback) => {
        if (key === `plugin::hide-and-seek`) {
          return cfg;
        }

        if (key === 'admin.path') {
          return adminPath;
        }

        // Answered, not omitted. `adminRoot()` prefers this key precisely
        // because `admin.path` has the part it shares with `server.url`
        // stripped out, so a stub that never returns it leaves the whole
        // sub-path branch dead and every test running on the fallback.
        if (key === 'admin.absoluteUrl') {
          return absoluteUrl ?? fallback;
        }

        return fallback;
      },
    },
  };

  return createGame({ strapi });
};

export const user = (id) => ({ id, firstname: `Player${id}`, lastname: 'Test' });

/** Joins `count` players, readies them all, and hands back the player objects. */
export const seat = (game, count) =>
  Array.from({ length: count }, (_, index) => {
    const id = index + 1;
    const player = game.join(user(id), `socket-${id}`);

    game.setReady(player.id, true);

    return player;
  });

/**
 * Roles are drawn at random, which is the point of the draw and the enemy of a
 * test. Start the round, then deal the hand the test is about.
 */
export const deal = (game, { seekers = [], hiders = [] }) => {
  game.state.players.forEach((player) => {
    if (seekers.includes(player.id)) {
      player.role = ROLE.SEEKER;
      player.startedAs = ROLE.SEEKER;
    }

    if (hiders.includes(player.id)) {
      player.role = ROLE.HIDER;
      player.startedAs = ROLE.HIDER;
    }
  });
};

/** Through the countdown and the hiding phase, into the hunt. */
export const openTheHunt = (game) => {
  game.tick();
};

/**
 * Everybody starts in the middle of the page, which is a catch the instant two
 * of them share one. Put opposite corners between them.
 */
export const apart = (seeker, hider) => {
  seeker.cursor = { x: 0.1, y: 0.1 };
  seeker.gamePos = { ...seeker.cursor };
  hider.cursor = { x: 0.9, y: 0.9 };
  hider.gamePos = { ...hider.cursor };
};

/** Puts a seeker's cursor exactly on a hider's marker. */
export const closeIn = (seeker, hider) => {
  seeker.cursor = { ...hider.gamePos };
};
