'use strict';

const { Server } = require('socket.io');

const { PLUGIN_ID, SOCKET_PATH, STATUS } = require('../constants');

let io = null;
let loop = null;

const setup = ({ strapi }) => {
  const httpServer = strapi.server?.httpServer;

  if (!httpServer) {
    strapi.log.error('[hide-and-seek] no HTTP server to attach to, real-time features are off');
    return;
  }

  const cfg = strapi.config.get(`plugin::${PLUGIN_ID}`);
  const game = strapi.plugin(PLUGIN_ID).service('game');
  const leaderboard = strapi.plugin(PLUGIN_ID).service('leaderboard');
  const tickets = strapi.plugin(PLUGIN_ID).service('tickets');

  const sendLeaderboard = (target) => {
    leaderboard
      .rows()
      .then((rows) => target.emit('leaderboard', rows))
      .catch((error) => {
        strapi.log.error(`[hide-and-seek] could not read the leaderboard: ${error.message}`);
      });
  };

  io = new Server(httpServer, {
    path: SOCKET_PATH,
    serveClient: false,
    cors: { origin: cfg.corsOrigin, credentials: true },
  });

  io.use((socket, next) => {
    const user = tickets.consume(socket.handshake.auth?.ticket);

    if (!user) {
      next(new Error('unauthorized'));
      return;
    }

    socket.data.user = user;
    next();
  });

  io.on('connection', (socket) => {
    const player = game.join(socket.data.user, socket.id);

    socket.data.playerId = player.id;

    // One tab per player. With two open, both report a page and the server only
    // keeps the last one — so you stand wherever your *other* tab happens to be,
    // which is how people ended up hiding on pages they had already navigated
    // away from (or deleted). The newest tab takes over; the old one is told why.
    [...player.sockets]
      .filter((id) => id !== socket.id)
      .forEach((id) => {
        const previous = io.sockets.sockets.get(id);

        if (!previous) {
          return;
        }

        previous.emit('superseded');
        // Closing in the same tick tears the transport down before the packet is
        // written, so the old tab would just go quiet with no explanation.
        setTimeout(() => previous.disconnect(true), 250);
      });
    socket.emit('hello', { playerId: player.id, state: game.publicState() });
    sendLeaderboard(socket);

    socket.on('page', (payload = {}) => {
      game.setPage(player.id, payload.path);
    });

    socket.on('cursor', (payload = {}) => {
      game.setCursor(player.id, payload.x, payload.y);
    });

    socket.on('away', (payload = {}) => {
      game.setAway(player.id, payload.away);
    });

    socket.on('ready', (payload = {}) => {
      game.setReady(player.id, payload.ready);
    });

    socket.on('settings', (payload = {}) => {
      game.updateSettings(payload);
    });

    socket.on('start', (_payload, ack) => {
      const result = game.start();

      if (typeof ack === 'function') {
        ack(result);
      }
    });

    socket.on('reset', () => {
      game.reset();
    });

    // Sent by a player on their way out (logging out), so the roster does not
    // have to wait for the socket to lapse.
    socket.on('bye', () => {
      game.forget(player.id);
    });

    socket.on('disconnect', () => {
      game.leave(socket.id);
    });
  });

  let lastVersion = -1;
  let failures = 0;

  /** A deterministic throw fires 20x/s; log the first, then one in this many. */
  const LOG_EVERY = 200;

  /**
   * Everything the game does happens in here, 20 times a second, on a timer
   * with nothing above it. An exception escaping this callback is an uncaught
   * exception in the host's process — a game bug would take the whole CMS
   * down with it. Log it and keep ticking instead.
   */
  const step = () => {
    try {
      game.tick();

      if (game.state.version !== lastVersion) {
        // Recorded only once the frame is actually out: marking it sent first
        // means a throw in publicState() drops that state for good, and every
        // client sits on stale state until something else bumps the version.
        const payload = game.publicState();

        io.emit('state', payload);
        lastVersion = game.state.version;
      }

      game.drainEvents().forEach((event) => {
        io.emit('event', event);

        if (event.type !== 'over') {
          return;
        }

        leaderboard
          .record(event.participants)
          .then((rows) => io.emit('leaderboard', rows))
          .catch((error) => {
            strapi.log.error(`[hide-and-seek] could not save the leaderboard: ${error.message}`);
          });
      });

      if (game.state.status !== STATUS.HUNTING) {
        return;
      }

      io.sockets.sockets.forEach((socket) => {
        if (!socket.data.playerId) {
          return;
        }

        // Volatile: a dropped position frame is always better than a late one.
        // Carries the player's own lockdown deadline alongside what they can see.
        socket.volatile.emit('peers', game.viewFor(socket.data.playerId));
      });
    } catch (error) {
      failures += 1;

      // `error` is whatever was thrown, which need not be an Error at all —
      // reading .stack off a thrown null would throw again, this time with
      // nothing to catch it, which is the crash this block exists to prevent.
      // The log is throttled because a deterministic throw happens 20 times a
      // second, and a flood that fills the disk is its own outage.
      if (failures === 1 || failures % LOG_EVERY === 0) {
        strapi.log.error(
          `[hide-and-seek] tick failed (${failures}x): ${error?.stack ?? error?.message ?? String(error)}`
        );
      }
    }
  };

  loop = setInterval(step, Math.round(1000 / cfg.tickHz));

  strapi.log.info(`[hide-and-seek] real-time server listening on ${SOCKET_PATH}`);
};

const teardown = () => {
  if (loop) {
    clearInterval(loop);
    loop = null;
  }

  if (io) {
    io.close();
    io = null;
  }
};

module.exports = { setup, teardown };
