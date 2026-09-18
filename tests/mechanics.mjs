import { USERS, check, connect, sleep, wait } from './helpers.mjs';

const [PLAYER_A, PLAYER_B] = USERS;
const HOME = '/admin';
const SPOT = '/admin/plugins/spot';

const run = async () => {
  const a = await connect(PLAYER_A);
  const b = await connect(PLAYER_B);
  if (a.state.status !== 'lobby') {
    a.socket.emit('reset');
    await wait(() => a.state.status === 'lobby', 'reset');
  }
  console.log('safePath from state:', a.state.safePath);

  a.socket.emit('settings', { hideSeconds: 1 });
  a.socket.emit('ready', { ready: true });
  b.socket.emit('ready', { ready: true });
  await wait(() => a.state.players.filter((p) => p.ready).length === 2, 'ready');
  await new Promise((r) => a.socket.emit('start', {}, r));
  await wait(() => a.state.status === 'hiding', 'hiding');

  const roleOf = (c) => c.state.players.find((p) => p.id === c.id).role;
  const seeker = roleOf(a) === 'seeker' ? a : b;
  const hider = seeker === a ? b : a;

  hider.socket.emit('page', { path: SPOT });
  seeker.socket.emit('page', { path: HOME });
  hider.socket.emit('cursor', { x: 0.2, y: 0.2 });
  seeker.socket.emit('cursor', { x: 0.8, y: 0.8 });
  await wait(() => seeker.state.status === 'hunting', 'hunting');
  await sleep(500);

  console.log('\n[6] immediate sighting (graceMs now 0)');
  seeker.socket.emit('page', { path: SPOT });
  const delay = await wait(() => seeker.peers.length > 0, 'sighting', 5000);
  check(delay < 400, `hider visible in ${delay}ms (was ~1500ms)`);

  console.log('\n[1] cornered hider is speed-limited');
  await sleep(300);
  // Flick from one corner to the other in a single jump.
  hider.socket.emit('cursor', { x: 0.9, y: 0.9 });
  await sleep(120);
  const seen = seeker.peers[0];
  const ownPos = hider.you.position;
  check(hider.you.slowed === true, 'hider reports slowed');
  check(
    seen.x < 0.6 && seen.y < 0.6,
    `marker still near the old spot after a flick (${seen.x.toFixed(2)}, ${seen.y.toFixed(2)})`
  );
  check(Math.abs(ownPos.x - seen.x) < 0.02, 'hider sees the same marker the seeker chases');
  await sleep(3500);
  const settled = seeker.peers[0];
  check(settled.x > 0.85, `marker catches up when the cursor stays put (${settled.x.toFixed(2)})`);

  console.log('\n[7] tabbing away parks you in the middle');
  hider.socket.emit('away', { away: true });
  await sleep(300);
  const away = seeker.peers[0];
  check(away.away === true, 'peer flagged away');
  check(
    Math.abs(away.x - 0.5) < 0.01 && Math.abs(away.y - 0.5) < 0.01,
    `parked at centre (${away.x}, ${away.y})`
  );
  hider.socket.emit('away', { away: false });
  await sleep(200);

  console.log('\n[2] homepage is a safe zone');
  hider.socket.emit('page', { path: HOME });
  seeker.socket.emit('page', { path: HOME });
  await sleep(600);
  hider.socket.emit('cursor', { x: 0.5, y: 0.5 });
  seeker.socket.emit('cursor', { x: 0.5, y: 0.5 });
  await sleep(2500);
  check(hider.you.safe === true, 'hider reports being in the safe zone');
  check(hider.you.lockedUntil < Date.now(), 'no new lockdown in the safe zone');
  check(seeker.state.status === 'hunting', 'no catch in the safe zone despite overlapping cursors');
  check(hider.you.slowed === false, 'no slowdown in the safe zone');

  console.log('\n[3] catch carries survival time and the new role');
  hider.socket.emit('page', { path: SPOT });
  seeker.socket.emit('page', { path: SPOT });
  await sleep(400);
  const chase = setInterval(() => {
    hider.socket.emit('cursor', { x: 0.5, y: 0.5 });
    seeker.socket.emit('cursor', { x: 0.5, y: 0.5 });
  }, 40);
  await wait(() => seeker.state.status === 'over', 'catch', 8000);
  clearInterval(chase);
  const caught = seeker.events.find((e) => e.type === 'catch');
  if (!caught) {
    console.log('  events seen:', JSON.stringify(seeker.events));
    console.log('  final state:', JSON.stringify(seeker.state.result));
  }
  check(
    typeof caught.survivedMs === 'number' && caught.survivedMs > 1000,
    `survivedMs = ${caught.survivedMs}`
  );
  check(['seeker', 'spectator'].includes(caught.becomes), `becomes = ${caught.becomes}`);

  seeker.socket.emit('reset');
  await wait(() => seeker.state.status === 'lobby', 'lobby');
  a.socket.close();
  b.socket.close();
  console.log('\nALL MECHANICS PASS');
  process.exit(0);
};

run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
