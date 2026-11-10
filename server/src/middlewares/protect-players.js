'use strict';

const { PLUGIN_ID } = require('../constants');

// Case-insensitive, every one of them. `@koa/router` defaults `sensitive` to
// false and Strapi never overrides it, so every route in the admin compiles
// with the `/i` flag and authorises off `ctx.state.route` — meaning
// `DELETE /ADMIN/USERS/7` is routed, authorised and executed while a matcher
// reading raw `ctx.path` sees nothing. Same class of hole as the one
// `decodeSegment` closes, on a different axis. Captures keep the input's own
// case, so model uids and document ids are unaffected.
const ONE_USER = /^\/admin\/users\/([^/]+)\/?$/i;
const BATCH_DELETE = /^\/admin\/users\/batch-delete\/?$/i;

const ONE_ENTRY = /^\/content-manager\/collection-types\/([^/]+)\/([^/]+)\/?$/i;
const BULK_ENTRIES = /^\/content-manager\/collection-types\/([^/]+)\/actions\/bulkDelete\/?$/i;
const SINGLE_TYPE = /^\/content-manager\/single-types\/([^/]+)\/?$/i;

const UPLOAD_BULK_DELETE = /^\/upload\/actions\/bulk-delete\/?$/i;

/** Where the upload plugin keeps its folders, for resolving a delete's subtree. */
const FOLDER_UID = 'plugin::upload.folder';

/**
 * A path segment as the router will read it.
 *
 * `ctx.path` is raw and undecoded, but Koa's router decodes its captures before
 * the controller sees them — so `/admin/users/%31` is user `1` to Strapi and
 * the literal string `%31` to a matcher that does not decode. Comparing the raw
 * form against ids the game holds in decoded form lets a percent-encoded
 * request walk straight past every guard here.
 */
const decodeSegment = (value) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/**
 * The refusal says only that somebody is in the way, never who. The caller has
 * been authenticated by the time this is reached, but they are still not
 * entitled to the roster: knowing an account exists is not knowing it is
 * playing, and a count is the most the message needs.
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
      return { model: decodeSegment(entry[1]), documentIds: [decodeSegment(entry[2])] };
    }

    const single = SINGLE_TYPE.exec(ctx.path);

    if (single) {
      return { model: decodeSegment(single[1]), documentIds: [] };
    }
  }

  if (ctx.method === 'POST') {
    const bulk = BULK_ENTRIES.exec(ctx.path);
    const ids = ctx.request.body?.documentIds ?? ctx.request.body?.ids;

    if (bulk && Array.isArray(ids)) {
      return { model: decodeSegment(bulk[1]), documentIds: ids };
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

    return match ? { verb: 'delete', ids: [decodeSegment(match[1])] } : null;
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
      return { verb: 'deactivate', ids: [decodeSegment(match[1])] };
    }
  }

  return null;
};

/**
 * The folders a delete names, each with the `path` that defines its subtree.
 *
 * The id in a Media Library URL and the ids in `folderPath` come from two
 * different counters, so the subtree cannot be read off the URL — only the
 * database knows which folders a delete would really take with it. If the
 * lookup fails, fall back to the ids alone: the guard then still catches
 * somebody standing in the folder itself, which is the common case, rather
 * than failing open entirely.
 */
const resolveFolders = async (strapi, folderIds) => {
  try {
    const rows = await strapi.db.query(FOLDER_UID).findMany({
      select: ['id', 'path'],
      where: { id: { $in: folderIds } },
    });

    return rows.map((row) => ({ id: row.id, path: row.path }));
  } catch (error) {
    strapi.log.warn(
      `[hide-and-seek] could not resolve folder paths, guarding by id only: ${error?.message ?? error}`
    );

    return folderIds.map((id) => ({ id, path: null }));
  }
};

const BEARER = /^bearer\s+(\S+)$/i;

/**
 * Whether this request carries a live admin session.
 *
 * It has to be asked here, by hand. Strapi composes authentication per route,
 * inside the router, and the router is only mounted at `listen()` — long after
 * a plugin's `bootstrap()` has run. So this middleware sits ahead of every auth
 * check there is, and a 409 from it would answer a caller that a 401 was about
 * to turn away: an unauthenticated oracle for whether a given entry, single
 * type or folder currently has somebody standing on it.
 *
 * Testing the *shape* of the header is not enough — `Bearer x` has the shape.
 * The token is verified and its session checked against the store, so only a
 * caller holding a live admin session learns anything from the refusal. Note
 * that moving this to `strapi.server.api('admin').use()` would not help:
 * router-level middleware still runs before the layer's policies, so
 * `ctx.state.user` is unset there too.
 *
 * That is authentication, not authorisation: the policies that decide whether
 * this caller may touch *this* model or folder are inside the router, behind
 * this middleware, so the refusal tells any admin with any session that a
 * given entry or folder is occupied — including on models they have no rights
 * on. Occupancy is not a secret worth a round trip through the router, but it
 * is a disclosure, and it is written down in the README.
 *
 * `strapi.sessionManager` arrived in 5.24 and the peer range admits 5.13, so
 * on an older host there is no way to tell a real token from `Bearer x`. The
 * guard switches itself off there rather than answer an anonymous caller: the
 * cost is that a delete goes through mid-round, which is the behaviour without
 * this plugin at all.
 */
const authenticated = async (strapi, ctx) => {
  const match = BEARER.exec(ctx.request.header.authorization ?? '');

  if (!match) {
    return false;
  }

  if (typeof strapi.sessionManager !== 'function') {
    return false;
  }

  try {
    const sessions = strapi.sessionManager('admin');
    const { isValid, payload } = sessions.validateAccessToken(match[1]);

    if (!isValid || !payload?.sessionId) {
      return false;
    }

    return await sessions.isSessionActive(payload.sessionId);
  } catch {
    // An unknown origin or an unreachable session store. Treat it as not
    // authenticated: the cost is that a delete goes through mid-round, which
    // is the behaviour without this plugin at all.
    return false;
  }
};

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
    const entry = entryTargetsFor(ctx);
    const folderIds = folderTargetsFor(ctx);
    const target = targetsFor(ctx);

    // This runs in front of every request the app serves, so the common case —
    // which is all of them — gets out before looking anything up. Matching is
    // pure string work and discloses nothing, which is why it comes first: the
    // session check below costs a store lookup, and only the handful of
    // delete-shaped requests should pay for it.
    if (!entry && !folderIds && (!target || target.ids.length === 0)) {
      await next();

      return;
    }

    if (!(await authenticated(strapi, ctx))) {
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

    if (folderIds && game.occupantsOfFolders(await resolveFolders(strapi, folderIds)).length > 0) {
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
