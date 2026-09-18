import { USERS, check, connect, sleep, wait } from './helpers.mjs';

/** The hint test waits out hintAfterMs; set HNS_SKIP_SLOW=1 to stop before it. */
const SKIP_SLOW = process.env.HNS_SKIP_SLOW === '1';
const A = '/admin/plugins/alpha';
const B = '/admin/plugins/beta';

const run = async () => {
  const cs = [await connect(USERS[0]), await connect(USERS[1]), await connect(USERS[2])];
  if (cs[0].state.status !== 'lobby') {
    cs[0].socket.emit('reset');
    await wait(() => cs[0].state.status === 'lobby', 'reset');
  }

  cs[0].socket.emit('settings', { hideSeconds: 1, caughtBecome: 'spectator', seekerCount: 1 });
  cs.forEach((c) => c.socket.emit('ready', { ready: true }));
  await wait(() => cs[0].state.players.filter((p) => p.ready).length === 3, 'all ready');
  await new Promise((r) => cs[0].socket.emit('start', {}, r));
  await wait(() => cs[0].state.status === 'hiding', 'hiding');

  const roleOf = (c) => c.state.players.find((p) => p.id === c.id).role;
  const seeker = cs.find((c) => roleOf(c) === 'seeker');
  const [h1, h2] = cs.filter((c) => roleOf(c) === 'hider');

  seeker.socket.emit('page', { path: A });
  h1.socket.emit('page', { path: A });
  h2.socket.emit('page', { path: B });
  await wait(() => seeker.state.status === 'hunting', 'hunting');

  console.log('\n[3/4] catching the first hider turns them into a spectator');
  const chase = setInterval(() => {
    seeker.socket.emit('cursor', { x: 0.5, y: 0.5 });
    h1.socket.emit('cursor', { x: 0.5, y: 0.5 });
    h2.socket.emit('cursor', { x: 0.25, y: 0.75 });
  }, 40);
  await wait(() => h1.you?.caught === true, 'h1 caught', 12000);
  clearInterval(chase);
  check(h1.you.role === 'spectator', 'caught hider is now a spectator');
  check(seeker.state.status === 'hunting', 'round continues with one hider left');

  console.log('\n[4] spectator gets a follow roster');
  await sleep(300);
  const roster = h1.you.follow;
  check(Array.isArray(roster), 'roster delivered to the spectator');
  check(roster.length === 2, `roster lists the other ${roster.length} players`);
  const seekerEntry = roster.find((e) => e.id === seeker.id);
  const hiderEntry = roster.find((e) => e.id === h2.id);
  check(seekerEntry.page === A && hiderEntry.page === B, 'roster carries each player’s page');
  check(seeker.you.follow === null, 'players in the round get no roster (no leak)');

  console.log('\n[3] spectators can see everyone; players cannot see spectators');
  h1.socket.emit('page', { path: B });
  await sleep(400);
  h1.socket.emit('cursor', { x: 0.6, y: 0.6 });
  await sleep(400);
  check(
    h1.peers.some((p) => p.id === h2.id),
    'spectator sees the hider on that page'
  );
  check(!h2.peers.some((p) => p.id === h1.id), 'hider does not see the spectator');
  check(
    h2.peers.every((p) => p.role !== 'spectator'),
    'no spectators leak into a player view'
  );

  if (SKIP_SLOW) {
    seeker.socket.emit('reset');
    cs.forEach((c) => c.socket.close());
    console.log('\nSPECTATOR CHECKS PASS (hint test skipped)');
    process.exit(0);
  }

  console.log('\n[5] the seeker gets a hint after a dry spell (hintAfterMs = 45s)');
  seeker.socket.emit('page', { path: '/admin/plugins/empty' });
  const keep = setInterval(() => {
    seeker.socket.emit('cursor', { x: 0.1, y: 0.1 });
    h2.socket.emit('cursor', { x: 0.7 + Math.random() * 0.02, y: 0.7 });
  }, 200);
  const took = await wait(() => seeker.you?.hint, 'hint', 70000);
  clearInterval(keep);
  check(
    seeker.you.hint.path === B,
    `hint points at the hider's page (${seeker.you.hint.path}) after ${(took / 1000).toFixed(0)}s`
  );
  check(!('name' in seeker.you.hint), 'hint names a page, never a person');

  seeker.socket.emit('reset');
  cs.forEach((c) => c.socket.close());
  console.log('\nSPECTATOR + HINT CHECKS PASS');
  process.exit(0);
};

run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
