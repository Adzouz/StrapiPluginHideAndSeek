import { USERS, check, connect, sleep, wait } from './helpers.mjs';

/**
 * Two things that used to let a player's position drift away from where they
 * actually were: a second tab quietly taking over the page reports, and screens
 * that keep their location in the query string rather than the path.
 */

const UPLOAD = '/admin/plugins/upload';

const run = async () => {
  const a = await connect(USERS[0]);
  const b = await connect(USERS[1]);

  if (a.state.status !== 'lobby') {
    a.socket.emit('reset');
    await wait(() => a.state.status === 'lobby', 'reset');
  }

  console.log('the newest tab owns the game');
  let supersededFired = false;
  a.socket.on('superseded', () => {
    supersededFired = true;
  });

  const secondTab = await connect(USERS[0]);
  await wait(() => supersededFired, 'first tab told it was superseded', 4000);
  check(true, 'the older tab is told another tab took over');
  await wait(() => a.socket.connected === false, 'older tab disconnected', 4000);
  check(true, 'the older tab is disconnected rather than left reporting pages');
  await sleep(500);
  const mine = secondTab.state.players.filter((p) => p.id === secondTab.id);
  check(mine.length === 1, `the player appears once in the roster, not twice (${mine.length})`);

  console.log('\nthe query string can be part of the room');
  check(
    Array.isArray(secondTab.state.pageQueryKeys) &&
      secondTab.state.pageQueryKeys.includes('folder'),
    `server nominates the query keys that matter: ${JSON.stringify(secondTab.state.pageQueryKeys)}`
  );

  secondTab.socket.emit('settings', {
    mode: 'classic',
    preyId: null,
    hideSeconds: 1,
    seekerCount: 1,
  });
  [secondTab, b].forEach((c) => c.socket.emit('ready', { ready: true }));
  await wait(() => secondTab.state.players.filter((p) => p.ready).length === 2, 'ready');
  await new Promise((r) => secondTab.socket.emit('start', {}, r));
  await wait(() => secondTab.state.status === 'hunting', 'hunting', 15000);

  const roleOf = (c) => c.state.players.find((p) => p.id === c.id)?.role;
  const seeker = roleOf(secondTab) === 'seeker' ? secondTab : b;
  const hider = seeker === secondTab ? b : secondTab;

  const ping = setInterval(() => {
    seeker.socket.emit('cursor', { x: 0.2, y: 0.2 });
    hider.socket.emit('cursor', { x: 0.8, y: 0.8 });
  }, 60);

  // Same pathname, different Media Library folder: different rooms.
  seeker.socket.emit('page', { path: `${UPLOAD}?folder=1` });
  hider.socket.emit('page', { path: `${UPLOAD}?folder=2` });
  await sleep(900);
  check(seeker.peers.length === 0, 'different folders on the same path are different rooms');

  // Same folder: same room.
  hider.socket.emit('page', { path: `${UPLOAD}?folder=1` });
  await sleep(900);
  check(seeker.peers.length === 1, 'the same folder puts them back together');

  // Both are in the same room now, so both are locked in. Aborting used to
  // leave those locks standing, and they carried into the next round.
  await sleep(600);
  check(hider.you.lockedUntil > Date.now(), 'the shared room locked them in');

  clearInterval(ping);
  seeker.socket.emit('reset');
  await wait(() => seeker.state.status === 'lobby', 'lobby');

  console.log('\naborting a round does not carry its locks into the next one');
  [seeker, hider].forEach((c) => c.socket.emit('ready', { ready: true }));
  await wait(() => seeker.state.players.filter((p) => p.ready).length === 2, 'ready again');
  await new Promise((r) => seeker.socket.emit('start', {}, r));
  await wait(() => seeker.state.status === 'hunting', 'hunting again', 15000);
  await sleep(400);
  check(
    [seeker, hider].every((c) => !c.you || c.you.lockedUntil < Date.now()),
    'the new round starts with nobody locked'
  );
  seeker.socket.emit('reset');
  await wait(() => seeker.state.status === 'lobby', 'back to lobby');
  [secondTab, b].forEach((c) => c.socket.close());
  console.log('\nTAB AND ROOM CHECKS PASS');
  process.exit(0);
};

run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
