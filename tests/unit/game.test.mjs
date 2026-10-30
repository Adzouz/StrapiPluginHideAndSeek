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
  it('does not leave the player with no page at all', () => {
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

    // The socket drops mid-standoff, and leave() takes their page with it.
    game.leave('socket-2');
    assert.equal(hider.page, null);

    const back = game.join(user(2), 'socket-2b');

    game.setPage(back.id, '/admin/settings');

    assert.equal(back.page, '/admin/settings', 'they are back in the room they reloaded out of');
    assert.ok(
      game.peersFor(seeker.id).some((peer) => peer.id === back.id),
      'and the seeker can still see them'
    );
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

  it('finds a player inside a Media Library folder', () => {
    const { game, hider } = inRound({ page: '/admin/plugins/upload?folder=5&folderPath=/1/5' });

    assert.deepEqual(
      game.occupantsOfFolders(['5']).map((p) => p.id),
      [hider.id],
      'the folder they are in'
    );
    assert.deepEqual(
      game.occupantsOfFolders([1]).map((p) => p.id),
      [hider.id],
      'and every folder above it, because deleting one deletes the subtree'
    );
    assert.deepEqual(game.occupantsOfFolders(['9']), [], 'but not an unrelated folder');
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
    assert.deepEqual(game.occupantsOfFolders(['5']), []);
  });
});

describe('a finished round', () => {
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
