'use strict';

const { PLUGIN_ID } = require('../constants');

const ONE_USER = /^\/admin\/users\/([^/]+)\/?$/;
const BATCH_DELETE = /^\/admin\/users\/batch-delete\/?$/;

const ONE_ENTRY = /^\/content-manager\/collection-types\/([^/]+)\/([^/]+)\/?$/;
const BULK_ENTRIES = /^\/content-manager\/collection-types\/([^/]+)\/actions\/bulkDelete\/?$/;
const SINGLE_TYPE = /^\/content-manager\/single-types\/([^/]+)\/?$/;

const UPLOAD_BULK_DELETE = /^\/upload\/actions\/bulk-delete\/?$/;

/**
 * Nothing here has been authenticated yet — see `protectPlayers` — so the
 * refusal says only that somebody is in the way, never who or where.
 */
const refuse = (ctx, message, action) => {
  ctx.status = 409;
  ctx.body = {
    data: null,
    error: {
      status: 409,
      name: 'HideAndSeekRoundInProgress',
      message,
      details: { action },
    },
  };
};

/**
 * The Media Library folders this request would delete. Folders are the one
 * room type the game builds out of a query string, so the entry guard above
 * cannot see them: the delete names folder ids and nothing else.
 */
const folderTargetsFor = (ctx) => {
  if (ctx.method !== 'POST' || !UPLOAD_BULK_DELETE.test(ctx.path)) {
    return null;
  }

  const { folderIds } = ctx.request.body ?? {};

  return Array.isArray(folderIds) && folderIds.length > 0 ? folderIds : null;
};

/**
 * The content entry this request would delete, when somebody might be standing
 * on its page.
 */
const entryTargetsFor = (ctx) => {
  if (ctx.method === 'DELETE') {
    const entry = ONE_ENTRY.exec(ctx.path);

    if (entry) {
      return { model: entry[1], documentIds: [entry[2]] };
    }

    const single = SINGLE_TYPE.exec(ctx.path);

    if (single) {
      return { model: single[1], documentIds: [] };
    }
  }

  if (ctx.method === 'POST') {
    const bulk = BULK_ENTRIES.exec(ctx.path);
    const ids = ctx.request.body?.documentIds ?? ctx.request.body?.ids;

    if (bulk && Array.isArray(ids)) {
      return { model: bulk[1], documentIds: ids };
    }
  }

  return null;
};

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
 * A request carrying no bearer token at all. Strapi composes authentication
 * per route, inside the router — and the router is only mounted at `listen()`,
 * long after a plugin's `bootstrap()` has run. So this middleware sits ahead of
 * every auth check there is, and a 409 here would answer an anonymous caller
 * that a 401 was about to turn away. Let those through untouched: they are
 * going to be refused by Strapi itself a moment later, and nothing about the
 * round is any of their business in the meantime.
 */
const unauthenticated = (ctx) => !/^bearer\s+\S+$/i.test(ctx.request.header.authorization ?? '');

/**
 * Refuses to delete or deactivate an admin user who is in the middle of a round,
 * or to delete the entry or Media Library folder somebody is hiding in.
 *
 * The lobby is built out of admin users, so removing one mid-game strands
 * everybody else waiting for a player who no longer exists. This lives on the
 * server rather than hiding a button: the endpoint is what has to say no.
 */
const protectPlayers = ({ strapi }) => {
  strapi.server.use(async (ctx, next) => {
    if (unauthenticated(ctx)) {
      await next();

      return;
    }

    const entry = entryTargetsFor(ctx);
    const folderIds = folderTargetsFor(ctx);
    const target = targetsFor(ctx);

    // This runs in front of every request the app serves, so the common case —
    // which is all of them — gets out before looking anything up.
    if (!entry && !folderIds && (!target || target.ids.length === 0)) {
      await next();

      return;
    }

    const game = strapi.plugin(PLUGIN_ID).service('game');

    if (entry && game.occupantsOf(entry).length > 0) {
      refuse(
        ctx,
        'Somebody is hiding in this entry. Deleting it would leave them on a page nobody else can reach — end the round first.',
        'delete-entry'
      );

      return;
    }

    if (folderIds && game.occupantsOfFolders(folderIds).length > 0) {
      refuse(
        ctx,
        'Somebody is hiding in this folder. Deleting it would leave them on a page nobody else can reach — end the round first.',
        'delete-folder'
      );

      return;
    }

    if (!target || target.ids.length === 0) {
      await next();

      return;
    }

    const playing = game.playersInRound(target.ids);

    if (playing.length === 0) {
      await next();

      return;
    }

    const count = playing.length;

    refuse(
      ctx,
      `Cannot ${target.verb} ${count === 1 ? 'a player' : `${count} players`} during a Hide & Seek round. End the round first.`,
      target.verb
    );
  });
};

module.exports = { protectPlayers, targetsFor, entryTargetsFor, folderTargetsFor };
