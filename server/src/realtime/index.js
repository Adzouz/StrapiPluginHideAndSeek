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

  loop = setInterval(
    () => {
      game.tick();

      if (game.state.version !== lastVersion) {
        lastVersion = game.state.version;
        io.emit('state', game.publicState());
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
    },
    Math.round(1000 / cfg.tickHz)
  );

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
