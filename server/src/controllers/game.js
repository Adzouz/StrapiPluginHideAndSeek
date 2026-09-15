'use strict';

const { PLUGIN_ID, SOCKET_PATH } = require('../constants');

module.exports = ({ strapi }) => ({
  /**
   * Hands the logged-in admin a one-shot ticket for the socket handshake.
   * Authentication is whatever the admin API already enforces on this route.
   */
  ticket(ctx) {
    const user = ctx.state.user;

    if (!user) {
      return ctx.unauthorized();
    }

    const { ticket, expiresIn } = strapi.plugin(PLUGIN_ID).service('tickets').issue(user);

    ctx.body = {
      ticket,
      expiresIn,
      socketPath: SOCKET_PATH,
      // Where the admin panel is mounted, so the client can send everyone
      // back to the homepage when a round ends.
      adminPath: strapi.config.get('admin.path', '/admin'),
      state: strapi.plugin(PLUGIN_ID).service('game').publicState(),
    };
  },
});
