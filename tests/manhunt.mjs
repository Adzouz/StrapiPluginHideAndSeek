import { USERS, check, connect, sleep, wait } from './helpers.mjs';

/**
 * Manhunt: one named player against the whole room. The two exemptions are what
 * make it playable — pinned in a room full of hunters, or able to camp the
 * homepage, and it is over before anyone has stopped laughing.
 */

const HOME = '/admin';
const SPOT = '/admin/plugins/manhunt-spot';

const run = async () => {
  const cs = [await connect(USERS[0]), await connect(USERS[1]), await connect(USERS[2])];

  if (cs[0].state.status !== 'lobby') {
    cs[0].socket.emit('reset');
    await wait(() => cs[0].state.status === 'lobby', 'reset');
  }

  const preyClient = cs[2];
  cs[0].socket.emit('settings', { mode: 'manhunt', preyId: preyClient.id, hideSeconds: 1 });
  await wait(() => cs[0].state.settings.mode === 'manhunt', 'mode set');
  check(cs[0].state.settings.preyId === preyClient.id, 'the room agrees on who is hunted');

  cs.forEach((c) => c.socket.emit('ready', { ready: true }));
  await wait(() => cs[0].state.players.filter((p) => p.ready).length === 3, 'ready');
  await new Promise((r) => cs[0].socket.emit('start', {}, r));
  await wait(() => cs[0].state.status === 'hunting', 'hunting', 15000);

  const roleOf = (c) => c.state.players.find((p) => p.id === c.id)?.role;
  check(cs[0].state.preyId === preyClient.id, 'the named player is the prey');
  check(roleOf(preyClient) === 'hider', 'the prey is the only one hiding');
  check(cs.filter((c) => roleOf(c) === 'seeker').length === 2, 'everybody else hunts (2 seekers)');

  const hunter = cs.find((c) => roleOf(c) === 'seeker');

  check(
    cs.every((c) => !c.you || c.you.lockedUntil < Date.now()),
    'a fresh round starts with nobody still locked from the last one'
  );

  console.log('\nthe prey can always run');
  [hunter, preyClient].forEach((c) => c.socket.emit('page', { path: SPOT }));
  const move = setInterval(() => {
    hunter.socket.emit('cursor', { x: 0.2, y: 0.2 });
    preyClient.socket.emit('cursor', { x: 0.75 + Math.random() * 0.02, y: 0.75 });
  }, 60);
  await sleep(1200);

  check(hunter.you.lockedUntil > Date.now(), 'the hunter is locked in by the encounter');
  check(preyClient.you.lockedUntil < Date.now(), 'the prey is not — they can still leave');

  // And the lock is real for the hunter: their page change is refused.
  hunter.socket.emit('page', { path: '/admin/plugins/elsewhere' });
  await sleep(400);
  check(preyClient.peers.length === 1, 'the locked hunter is stuck in the room');

  // The lock exists to force a standoff. Once the prey walks out there is no
  // standoff, and a hunter left pinned is a hunter the prey has removed.
  preyClient.socket.emit('page', { path: '/admin/plugins/manhunt-elsewhere' });
  await wait(
    () => hunter.you && hunter.you.lockedUntil < Date.now(),
    'the hunter is freed when the prey leaves',
    6000
  );
  check(true, 'leaving releases the hunters rather than pinning them');
  preyClient.socket.emit('page', { path: SPOT });
  await sleep(400);

  console.log('\nno hiding on the homepage');
  preyClient.socket.emit('page', { path: HOME });
  await sleep(600);
  check(preyClient.you.safe !== true, 'the safe zone is off in a manhunt');

  console.log('\ncatching the prey ends it');
  preyClient.socket.emit('page', { path: SPOT });
  await sleep(500);
  clearInterval(move);
  const chase = setInterval(() => {
    hunter.socket.emit('cursor', { x: 0.5, y: 0.5 });
    preyClient.socket.emit('cursor', { x: 0.5, y: 0.5 });
  }, 40);
  await wait(() => cs[0].state.status === 'over', 'caught', 20000);
  clearInterval(chase);

  const { result } = cs[0].state;
  check(result.mode === 'manhunt', 'the result knows which game was played');
  check(result.prey?.caught === true, `the prey was caught (${result.prey?.name})`);
  check(
    result.preySurvivedMs > 0,
    `survival time recorded: ${(result.preySurvivedMs / 1000).toFixed(1)}s`
  );

  console.log('\na random prey is still one of the players');
  cs[0].socket.emit('settings', { preyId: null });
  await wait(() => cs[0].state.settings.preyId === null, 'prey cleared');
  cs.forEach((c) => c.socket.emit('ready', { ready: true }));
  await wait(() => cs[0].state.players.filter((p) => p.ready).length === 3, 'ready for random');
  await new Promise((r) => cs[0].socket.emit('start', {}, r));
  await wait(() => cs[0].state.status === 'hunting', 'random round', 15000);
  const ids = cs.map((c) => c.id);
  check(ids.includes(cs[0].state.preyId), `random prey is a real player (${cs[0].state.preyId})`);
  check(
    cs[0].state.players.filter((p) => p.role === 'hider').length === 1,
    'exactly one hider in a manhunt'
  );
  cs[0].socket.emit('reset');
  await wait(() => cs[0].state.status === 'lobby', 'lobby after random round');

  // A nonsense prey id must not be stored, let alone broadcast to the room.
  cs[0].socket.emit('settings', { preyId: 'not-a-player-'.repeat(40) });
  await sleep(500);
  check(cs[0].state.settings.preyId === null, 'an unknown prey id is rejected, not echoed back');

  cs[0].socket.emit('settings', { mode: 'classic', preyId: null });
  cs[0].socket.emit('reset');
  await wait(() => cs[0].state.status === 'lobby', 'lobby');
  cs.forEach((c) => c.socket.close());
  console.log('\nMANHUNT CHECKS PASS');
  process.exit(0);
};

run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
