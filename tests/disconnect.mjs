import { USERS, check, connect, roster, sleep, wait } from './helpers.mjs';

const run = async () => {
  const a = await connect(USERS[0]);
  let b = await connect(USERS[1]);
  const c3 = await connect(USERS[2]);
  if (a.state.status !== 'lobby') {
    a.socket.emit('reset');
    await wait(() => a.state.status === 'lobby', 'reset');
  }
  await sleep(300);

  console.log('a reload keeps your seat');
  b.socket.close();
  await sleep(1500);
  check(a.state.players.length === 3, `still listed 1.5s after dropping: ${roster(a)}`);
  b = await connect(USERS[1]);
  await sleep(500);
  check(
    a.state.players.every((p) => p.connected),
    'reconnected within the grace window, no ghost row'
  );

  console.log('\nlogging out clears the seat immediately');
  b.socket.emit('bye');
  await wait(() => a.state.players.length === 2, 'bye removes the player', 3000);
  check(true, `gone without waiting out the grace: ${roster(a)}`);
  b.socket.close();
  b = await connect(USERS[1]);
  await sleep(400);
  check(a.state.players.length === 3, 'and they can come back');

  console.log('\nleaving mid-round is cleaned up once the round ends');
  a.socket.emit('settings', { hideSeconds: 1, caughtBecome: 'spectator' });
  [a, b, c3].forEach((x) => x.socket.emit('ready', { ready: true }));
  await wait(() => a.state.players.filter((p) => p.ready).length === 3, 'ready');
  await new Promise((r) => a.socket.emit('start', {}, r));
  await wait(() => a.state.status === 'hunting', 'hunting', 15000);

  // Somebody rage-quits in the middle of the hunt.
  b.socket.close();
  await sleep(1500);
  check(a.state.players.length === 3, 'kept mid-round so the forfeit timer can run');
  check(
    a.state.players.find((p) => !p.connected) !== undefined,
    `shown as disconnected: ${roster(a)}`
  );

  a.socket.emit('reset');
  await wait(() => a.state.status === 'lobby', 'lobby');
  const gone = await wait(() => a.state.players.length === 2, 'sweep', 12000);
  check(true, `swept ${(gone / 1000).toFixed(1)}s after the round ended: ${roster(a)}`);

  // --- leaving mid-round -------------------------------------------------
  console.log('\nleaving mid-round drops you from the round');
  b = await connect(USERS[1]);
  await sleep(400);
  a.socket.emit('settings', { hideSeconds: 1, caughtBecome: 'spectator', seekerCount: 1 });
  [a, b, c3].forEach((x) => x.socket.emit('ready', { ready: true }));
  await wait(() => a.state.players.filter((p) => p.ready).length === 3, 'ready again');
  await new Promise((r) => a.socket.emit('start', {}, r));
  await wait(() => a.state.status === 'hunting', 'hunting again', 15000);

  const roleOf = (c) => c.state.players.find((p) => p.id === c.id)?.role;
  const seeker = [a, b, c3].find((c) => roleOf(c) === 'seeker');
  const hiders = [a, b, c3].filter((c) => roleOf(c) === 'hider');

  // A hider walks out: the round carries on without them.
  hiders[0].socket.emit('bye');
  await wait(() => seeker.state.players.length === 2, 'hider removed', 4000);
  check(seeker.state.status === 'hunting', 'round continues after one hider leaves');
  check(
    seeker.state.players.every((p) => p.id !== hiders[0].id),
    'the leaver is gone from the roster, not just greyed out'
  );

  // The only seeker walks out: nobody is hunting, so the round is over.
  seeker.socket.emit('bye');
  await wait(() => seeker.state.status === 'over', 'round ends with no seeker', 4000);
  check(
    seeker.state.result.winner === 'hiders',
    `hiders win by abandonment (${seeker.state.result.winner})`
  );

  [a, b, c3].forEach((x) => x.socket.close());
  console.log('\nDISCONNECT HANDLING PASSES');
  process.exit(0);
};
run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
