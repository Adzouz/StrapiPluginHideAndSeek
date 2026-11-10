import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  apart,
  closeIn,
  deal,
  makeGame,
  MODE,
  openTheHunt,
  seat,
  STATUS,
  user,
} from './helpers.mjs';

describe('settings', () => {
  it('clamps a configured roundSeconds, not only a lobby one', () => {
    const game = makeGame({ config: { roundSeconds: 999999 } });

    assert.equal(game.publicState().settings.roundSeconds, 3600);
  });

  it('clamps a lobby roundSeconds too', () => {
    const game = makeGame();

    game.updateSettings({ roundSeconds: 999999 });

    assert.equal(game.publicState().settings.roundSeconds, 3600);
  });

  it('leaves a configured value under the ceiling alone', () => {
    const game = makeGame({ config: { roundSeconds: 300 } });

    assert.equal(game.publicState().settings.roundSeconds, 300);
  });

  it('refuses a lobby round that would end on the tick it begins', () => {
    const game = makeGame();

    // `updateSettings` tests the value it was sent, not the value it stores,
    // so 0.5 is positive, floors to 0 and gives a round whose first tick runs
    // every phase and then finishes it. Any connected socket can send this.
    game.updateSettings({ roundSeconds: 0.5 });

    assert.equal(game.publicState().settings.roundSeconds, 1);
  });

  it('matches a prey named as a number in config', () => {
    // Ids are strings everywhere in the engine, but an installer writing
    // `preyId: 3` in config/plugins.ts writes a number — and `'3' === 3` is
    // false, which used to make the named prey permanently unstartable.
    const game = makeGame({ config: { mode: MODE.MANHUNT, preyId: 3 } });

    seat(game, 3);

    assert.equal(game.publicState().settings.preyId, '3');
    assert.deepEqual(game.start(), { ok: true });
    assert.equal(game.state.preyId, '3');
  });

  it('forgets a prey who leaves the lobby', () => {
    const game = makeGame();
    const [, hunted] = seat(game, 2);

    game.updateSettings({ mode: MODE.MANHUNT, preyId: hunted.id });
    assert.equal(game.publicState().settings.preyId, hunted.id);

    game.forget(hunted.id);
    assert.equal(game.publicState().settings.preyId, null);
  });
});

describe('page reporting', () => {
  it('refuses a page that does not stay on this origin', () => {
    const game = makeGame();
    const [player] = seat(game, 2);

    game.setPage(player.id, '/admin/content-manager');
    assert.equal(player.page, '/admin/content-manager');

    // The URL parser reads `\` as `/` in a relative path, so this resolves to
    // https://evil.example/admin while passing startsWith('/').
    game.setPage(player.id, '/\\evil.example/admin');
    assert.equal(player.page, '/admin/content-manager');

    game.setPage(player.id, '//evil.example/admin');
    assert.equal(player.page, '/admin/content-manager');

    game.setPage(player.id, 'https://evil.example/admin');
    assert.equal(player.page, '/admin/content-manager');
  });

  it('keeps the query string that defines the room', () => {
    const game = makeGame();
    const [player] = seat(game, 2);

    game.setPage(player.id, '/admin/plugins/upload?folder=5&folderPath=/1/5');

    assert.equal(player.page, '/admin/plugins/upload?folder=5&folderPath=/1/5');
  });
});

describe('a catch', () => {
  const cornered = () => {
    const game = makeGame();
    const [seeker, hider, spare] = seat(game, 3);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id, spare.id] });
    openTheHunt(game);

    game.setPage(seeker.id, '/admin/settings');
    game.setPage(hider.id, '/admin/settings');
    // Somewhere else entirely, so the round does not end on the first catch.
    game.setPage(spare.id, '/admin/plugins/upload');
    apart(seeker, hider);

    return { game, seeker, hider, spare };
  };

  it('frees the seeker as well as the hider', () => {
    const { game, seeker, hider } = cornered();

    game.tick();
    assert.ok(seeker.lockedUntil > Date.now(), 'the standoff locks the seeker in');

    closeIn(seeker, hider);
    game.tick();

    assert.equal(hider.caught, true, 'the hider is caught');
    assert.equal(seeker.lockedUntil, 0, 'the seeker is free to chase the next one');
  });

  it('holds the standoff while it is still a standoff', () => {
    const { game, seeker, hider } = cornered();

    game.tick();
    game.tick();

    assert.ok(seeker.lockedUntil > Date.now(), 'the seeker stays put');
    assert.ok(hider.lockedUntil > Date.now(), 'and so does the hider');
  });

  it('frees a hider whose room empties without a catch', () => {
    const { game, hider } = cornered();

    game.tick();
    assert.ok(hider.lockedUntil > Date.now(), 'the standoff locks the hider in too');

    // The other half of the release pass. Every existing case frees a seeker;
    // this one frees the hider, whose branch is otherwise only ever evaluated
    // with the opponent still standing there.
    game.leave('socket-1');
    game.tick();

    assert.equal(hider.lockedUntil, 0, 'the hider can move again once nobody is hunting them');
  });

  it('frees a seeker whose room empties without a catch', () => {
    const { game, seeker } = cornered();

    game.tick();
    assert.ok(seeker.lockedUntil > Date.now());

    // The hider's tab goes. They are still in the round — the forfeit timer is
    // running — but nobody is cornered in that room any more.
    game.leave('socket-2');
    game.tick();

    assert.equal(seeker.lockedUntil, 0);
  });
});

describe('reloading mid-lockdown', () => {
  const standoff = () => {
    const game = makeGame();
    const [seeker, hider, spare] = seat(game, 3);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id, spare.id] });
    openTheHunt(game);

    game.setPage(seeker.id, '/admin/settings');
    game.setPage(hider.id, '/admin/settings');
    game.setPage(spare.id, '/admin/plugins/upload');
    apart(seeker, hider);
    game.tick();

    assert.ok(hider.lockedUntil > Date.now(), 'the hider is locked in');

    return { game, seeker, hider };
  };

  it('does not leave the player with no page at all', () => {
    const { game, seeker, hider } = standoff();
    const pageAt = hider.pageAt;

    // The socket drops mid-standoff. The page is the room the lock is holding
    // them in, so it outlives the socket.
    game.leave('socket-2');
    assert.equal(hider.page, '/admin/settings', 'still standing where they were');

    const back = game.join(user(2), 'socket-2b');

    game.setPage(back.id, '/admin/settings');

    assert.equal(back.page, '/admin/settings', 'they are back in the room they reloaded out of');
    assert.equal(back.pageAt, pageAt, 'and are not dealt a second full lockdown for refreshing');
    assert.ok(
      game.peersFor(seeker.id).some((peer) => peer.id === back.id),
      'and the seeker can still see them'
    );
  });

  it('is not an escape from the standoff', () => {
    const { game } = standoff();

    game.leave('socket-2');
    const back = game.join(user(2), 'socket-2b');

    // Cmd+R and then click away: the whole point of the lockdown is that this
    // does not work.
    game.setPage(back.id, '/admin/plugins/upload');

    assert.equal(back.page, '/admin/settings', 'the lock still holds them to the room');
    assert.ok(back.lockedUntil > Date.now(), 'and is still running');
  });

  it('releases the page once the lock has lapsed', () => {
    const { game, hider } = standoff();

    hider.lockedUntil = 0;
    game.leave('socket-2');

    assert.equal(hider.page, null, 'nothing is holding them anywhere any more');
  });
});

describe('manhunt', () => {
  it('refuses to start when the named prey is not ready', () => {
    const game = makeGame();
    const [, hunted] = seat(game, 3);

    game.setReady(hunted.id, false);
    game.updateSettings({ mode: MODE.MANHUNT, preyId: hunted.id });

    assert.deepEqual(game.start(), { ok: false, code: 'preyNotReady' });
    assert.equal(game.state.status, STATUS.LOBBY);
  });

  it('starts when the named prey is ready', () => {
    const game = makeGame();
    const [, hunted] = seat(game, 3);

    game.updateSettings({ mode: MODE.MANHUNT, preyId: hunted.id });

    assert.deepEqual(game.start(), { ok: true });
    assert.equal(game.state.preyId, hunted.id);
  });

  it('reports a prey who quit as having quit', () => {
    const game = makeGame();
    const [, hunted] = seat(game, 3);

    game.updateSettings({ mode: MODE.MANHUNT, preyId: hunted.id });
    game.start();
    openTheHunt(game);

    game.forget(hunted.id);
    game.tick();

    const { result } = game.publicState();

    assert.equal(result.prey.left, true, 'the card can tell quitting from escaping');
    assert.equal(result.prey.caught, false);
    assert.equal(result.preySurvivedMs, null, 'there is no survival time to print');
  });

  it('never locks the prey in, and always locks the hunters', () => {
    // The rule the whole mode rests on: being frozen in a room with a dozen
    // hunters is an instant catch, so the prey can always run. No fixture
    // reached this before — the manhunt cases that tick never set a page, and
    // `evaluateLockdowns` skips a player who has not reported one.
    const game = makeGame();
    const [hunter, hunted, spare] = seat(game, 3);

    game.updateSettings({ mode: MODE.MANHUNT, preyId: hunted.id });
    assert.deepEqual(game.start(), { ok: true });
    openTheHunt(game);

    game.setPage(hunter.id, '/admin/settings');
    game.setPage(hunted.id, '/admin/settings');
    // Out of the room, so the round does not end on this tick.
    game.setPage(spare.id, '/admin/plugins/upload');
    apart(hunter, hunted);

    game.tick();

    assert.ok(hunter.lockedUntil > Date.now(), 'the hunter is pinned to the room');
    assert.equal(hunted.lockedUntil, 0, 'the prey can always run');
  });

  it('abandons a hunt that lost its hunters before it opened', () => {
    // `huntStartedAt` is null until the hunt opens, so finishing here reported
    // the prey as having survived exactly zero milliseconds — "got away after
    // 0:00", the one string the results card exists to avoid.
    const game = makeGame({ config: { hideSeconds: 30 } });
    const [hunter, hunted] = seat(game, 2);

    game.updateSettings({ mode: MODE.MANHUNT, preyId: hunted.id });
    assert.deepEqual(game.start(), { ok: true });

    game.forget(hunter.id);
    game.tick();

    assert.equal(game.state.status, STATUS.LOBBY, 'a round nobody can hunt yet is abandoned');
    assert.equal(game.publicState().result, null, 'and nothing is reported about it');
  });

  it('does not advertise a safe zone', () => {
    const game = makeGame();

    game.updateSettings({ mode: MODE.MANHUNT });

    assert.equal(game.publicState().safePath, null);
  });

  it('still advertises one in classic', () => {
    const game = makeGame();

    assert.equal(game.publicState().safePath, '/admin');
  });
});

describe('the deletion guards', () => {
  const inRound = ({ adminPath, page } = {}) => {
    const game = makeGame({ adminPath });
    const [seeker, hider] = seat(game, 2);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id] });
    openTheHunt(game);
    game.setPage(hider.id, page);

    return { game, hider };
  };

  it('finds a player sitting on a content entry', () => {
    const { game, hider } = inRound({
      page: '/admin/content-manager/collection-types/api::article.article/doc-1',
    });

    assert.deepEqual(
      game.occupantsOf({ model: 'api::article.article', documentIds: ['doc-1'] }).map((p) => p.id),
      [hider.id]
    );
    assert.deepEqual(
      game.occupantsOf({ model: 'api::article.article', documentIds: ['doc-2'] }),
      []
    );
  });

  it('finds one on a project that mounts the admin somewhere else', () => {
    const { game, hider } = inRound({
      adminPath: '/',
      page: '/content-manager/collection-types/api::article.article/doc-1',
    });

    assert.deepEqual(
      game.occupantsOf({ model: 'api::article.article', documentIds: ['doc-1'] }).map((p) => p.id),
      [hider.id]
    );
  });

  it('ignores a crafted page string on a mount point that is not the admin', () => {
    const { game } = inRound({
      page: '/elsewhere/content-manager/collection-types/api::article.article/doc-1',
    });

    assert.deepEqual(
      game.occupantsOf({ model: 'api::article.article', documentIds: ['doc-1'] }),
      []
    );
  });

  // The two numbers in a Media Library URL come from different counters, and a
  // fixture where they coincide proves nothing. Here the open folder has id 12
  // and pathId 7, and its parent has id 3 and pathId 4 — the shape Strapi
  // produces as soon as any folder has ever been deleted.
  const MEDIA_LIBRARY = '/admin/plugins/upload?folder=12&folderPath=/4/7';
  const PARENT = { id: 3, path: '/4' };
  const ITSELF = { id: 12, path: '/4/7' };

  it('finds a player inside a Media Library folder', () => {
    const { game, hider } = inRound({ page: MEDIA_LIBRARY });

    assert.deepEqual(
      game.occupantsOfFolders([ITSELF]).map((p) => p.id),
      [hider.id],
      'the folder they are in'
    );
    assert.deepEqual(
      game.occupantsOfFolders([PARENT]).map((p) => p.id),
      [hider.id],
      'and every folder above it, because deleting one deletes the subtree'
    );
  });

  it('does not mistake a folder id for an ancestor pathId', () => {
    const { game } = inRound({ page: MEDIA_LIBRARY });

    // Folder id 4 is some unrelated folder that merely shares a number with an
    // ancestor's pathId. Matching the two spaces against each other would both
    // refuse this delete and miss the one above.
    assert.deepEqual(game.occupantsOfFolders([{ id: 4, path: '/9' }]), []);
    assert.deepEqual(game.occupantsOfFolders([{ id: 7, path: '/11' }]), []);
  });

  it('does not match a sibling whose path merely shares a prefix', () => {
    const { game } = inRound({ page: MEDIA_LIBRARY });

    // '/4/7' must not be read as living under '/4/70'.
    assert.deepEqual(game.occupantsOfFolders([{ id: 99, path: '/4/70' }]), []);
  });

  it('still matches on the id alone when the path could not be resolved', () => {
    const { game, hider } = inRound({ page: MEDIA_LIBRARY });

    assert.deepEqual(
      game.occupantsOfFolders([{ id: 12, path: null }]).map((p) => p.id),
      [hider.id]
    );
    assert.deepEqual(game.occupantsOfFolders([{ id: 3, path: null }]), [], 'but not the subtree');
    assert.deepEqual(game.occupantsOfFolders([]), []);
  });

  it('stands down between rounds', () => {
    const { game } = inRound({
      page: '/admin/content-manager/collection-types/api::article.article/doc-1',
    });

    game.reset();

    assert.deepEqual(
      game.occupantsOf({ model: 'api::article.article', documentIds: ['doc-1'] }),
      []
    );
    assert.deepEqual(game.occupantsOfFolders([{ id: 12, path: '/4/7' }]), []);
  });
});

describe('somebody who never readied up', () => {
  // Dealt no role, which leaves them SPECTATOR — indistinguishable by role
  // alone from a player who was knocked out. `startedAs` is the difference,
  // and nothing in the suite reached either guard before: `seat` readies
  // everybody, and all seven live suites do too.
  const abstainer = () => {
    const game = makeGame();
    const seeker = game.join(user(1), 'socket-1');
    const hider = game.join(user(2), 'socket-2');
    const watcher = game.join(user(3), 'socket-3');

    game.setReady(seeker.id, true);
    game.setReady(hider.id, true);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id] });
    openTheHunt(game);

    game.setPage(seeker.id, '/admin/plugins/upload');
    game.setPage(hider.id, '/admin/settings');
    game.setPage(watcher.id, '/admin/settings');

    return { game, hider, watcher };
  };

  it('is handed no follow roster', () => {
    const { game, watcher } = abstainer();

    assert.equal(game.viewFor(watcher.id).you.follow, null);
  });

  it('is handed no live positions for the players on their page', () => {
    const { game, watcher } = abstainer();

    assert.deepEqual(game.peersFor(watcher.id), [], 'standing in the room is not watching it');
  });

  it('while a knocked-out player still sees the round', () => {
    const { game, hider } = abstainer();

    hider.role = 'spectator';
    hider.caught = true;

    assert.ok(Array.isArray(game.viewFor(hider.id).you.follow), 'they earned it by playing');
  });
});

describe('the admin root', () => {
  // `admin.path` has the part it shares with `server.url` stripped out, so a
  // project served under /cms reports /admin while the browser is on
  // /cms/admin. Everything that compares a reported page against the admin
  // root — the deletion guards, the safe zone — is wrong by that prefix.
  const SUB_PATH = { absoluteUrl: 'http://localhost:1337/cms/admin', adminPath: '/admin' };

  it('comes from the absolute URL when there is one', () => {
    const game = makeGame(SUB_PATH);

    assert.equal(game.adminRoot(), '/cms/admin');
    assert.equal(game.publicState().safePath, '/cms/admin');
  });

  it('falls back to the relative path when there is not', () => {
    const game = makeGame({ adminPath: '/admin' });

    assert.equal(game.adminRoot(), '/admin');
  });

  it('finds a player hiding in an entry under the sub-path', () => {
    const game = makeGame(SUB_PATH);
    const [seeker, hider] = seat(game, 2);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id] });
    openTheHunt(game);
    game.setPage(hider.id, '/cms/admin/content-manager/collection-types/api::a.a/doc-1');

    assert.deepEqual(
      game.occupantsOf({ model: 'api::a.a', documentIds: ['doc-1'] }).map((p) => p.id),
      [hider.id]
    );
  });

  it('treats the sub-path homepage as the safe zone', () => {
    const game = makeGame(SUB_PATH);
    const [seeker, hider] = seat(game, 2);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id] });
    openTheHunt(game);
    game.setPage(hider.id, '/cms/admin');

    assert.equal(game.viewFor(hider.id).you.safe, true);
  });
});

describe('a finished round', () => {
  const scored = (game, playerId) => {
    const over = game.drainEvents().find((event) => event.type === 'over');

    return over.participants.find((participant) => participant.id === playerId);
  };

  const endIt = (game, { page } = {}) => {
    const [seeker, hider] = seat(game, 2);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id] });
    openTheHunt(game);

    if (page) {
      game.setPage(hider.id, page);
    }

    // The last seeker goes: the hiders were never found.
    game.forget(seeker.id);
    game.tick();

    assert.equal(game.state.status, STATUS.OVER);

    return hider;
  };

  it('credits a hider who was somewhere with surviving', () => {
    const game = makeGame();
    const hider = endIt(game, { page: '/admin/settings' });

    assert.equal(scored(game, hider.id).survived, true);
  });

  it('does not credit a hider who never said where they were', () => {
    // `peersFor`, `evaluateCatches`, `evaluateHints` and both deletion guards
    // all filter out a player with no page, so a socket that emits `ready` and
    // never `page` is dealt in, unfindable and uncatchable. Nothing obliges a
    // client to send one.
    const game = makeGame();
    const hider = endIt(game);

    assert.equal(hider.page, null);
    assert.equal(scored(game, hider.id).survived, false, 'invisible is not the same as alive');
  });

  // The `survived` flag and the `survivors` list were computed off two
  // different predicates, so the same round said both things about one player:
  // `survived: false` on their participant record, and their name in the list
  // of who made it.
  it('leaves a hider it did not credit out of the survivors too', () => {
    const game = makeGame();
    const hider = endIt(game);
    const over = game.drainEvents().find((event) => event.type === 'over');

    assert.equal(hider.page, null);
    assert.deepEqual(
      over.result.survivors.map((survivor) => survivor.id),
      [],
      'the list and the flag have to agree'
    );
  });

  // The page gate belongs on who can be *found*, not on who is still in. Every
  // page is cleared when a round opens, so reading the findable list to decide
  // whether anybody is left hands the seekers the round in the gap before the
  // clients have re-announced where they are.
  it('does not hand the seekers a win before anybody has reported a page', () => {
    const game = makeGame();
    const [seeker, hider] = seat(game, 2);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id] });
    openTheHunt(game);

    assert.equal(hider.page, null);
    assert.equal(game.state.status, STATUS.HUNTING, 'the round is still being played');
  });

  it('does not outlive everybody who played it', () => {
    const game = makeGame();
    const [seeker, hider] = seat(game, 2);

    game.start();
    deal(game, { seekers: [seeker.id], hiders: [hider.id] });
    openTheHunt(game);

    game.forget(hider.id);
    game.tick();
    assert.equal(game.state.status, STATUS.OVER);

    game.forget(seeker.id);
    game.tick();

    assert.equal(game.state.status, STATUS.LOBBY, 'the next admin to look gets a lobby');
  });
});
