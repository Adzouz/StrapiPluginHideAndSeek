'use strict';

const { PLUGIN_ID } = require('../constants');

const ONE_USER = /^\/admin\/users\/([^/]+)\/?$/;
const BATCH_DELETE = /^\/admin\/users\/batch-delete\/?$/;

/**
 * What this request would do to which admin users, when it is something that
 * would take a player out of a round.
 */
const targetsFor = (ctx) => {
  if (ctx.method === 'DELETE') {
    const match = ONE_USER.exec(ctx.path);

    return match ? { verb: 'delete', ids: [match[1]] } : null;
  }

  if (ctx.method === 'POST' && BATCH_DELETE.test(ctx.path)) {
    const { ids } = ctx.request.body ?? {};

    return Array.isArray(ids) ? { verb: 'delete', ids } : null;
  }

  // Deactivating is as disruptive as deleting: the account survives, the player
  // does not. Any other edit — name, email, roles — is left alone.
  if (ctx.method === 'PUT') {
    const match = ONE_USER.exec(ctx.path);
    const { isActive } = ctx.request.body ?? {};

    if (match && (isActive === false || isActive === 'false')) {
      return { verb: 'deactivate', ids: [match[1]] };
    }
  }

  return null;
};

/**
 * Refuses to delete or deactivate an admin user who is in the middle of a round.
 *
 * The lobby is built out of admin users, so removing one mid-game strands
 * everybody else waiting for a player who no longer exists. This lives on the
 * server rather than hiding a button: the endpoint is what has to say no.
 */
const protectPlayers = ({ strapi }) => {
  strapi.server.use(async (ctx, next) => {
    const target = targetsFor(ctx);

    if (!target || target.ids.length === 0) {
      await next();

      return;
    }

    const playing = strapi.plugin(PLUGIN_ID).service('game').playersInRound(target.ids);

    if (playing.length === 0) {
      await next();

      return;
    }

    const names = playing.map((player) => player.name).join(', ');

    ctx.status = 409;
    ctx.body = {
      data: null,
      error: {
        status: 409,
        name: 'HideAndSeekRoundInProgress',
        message: `Cannot ${target.verb} ${names} during a Hide & Seek round. End the round first.`,
        details: { players: playing, action: target.verb },
      },
    };
  });
};

module.exports = { protectPlayers, targetsFor };
