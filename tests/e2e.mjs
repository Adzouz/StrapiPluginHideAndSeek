import { io } from 'socket.io-client';

const BASE = process.env.HNS_URL ?? 'http://127.0.0.1:1337';
const PASSWORD = process.env.HNS_PASSWORD ?? 'HideSeek1!';
const PLAYER_A = process.env.HNS_USER_A ?? 'seeker@hns.test';
const PLAYER_B = process.env.HNS_USER_B ?? 'hider@hns.test';
const PAGE = '/admin/plugins/hide-and-seek-test';
const ESCAPE_PAGE = '/admin/settings/hide-and-seek-escape';

const login = async (email) => {
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(body)}`);
  return body.data.token;
};

const connect = async (email) => {
  const token = await login(email);
  const res = await fetch(`${BASE}/hide-and-seek/ticket`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`ticket ${email}: ${res.status}`);
  const { ticket, socketPath } = await res.json();

  const socket = io(BASE, {
    path: socketPath,
    auth: { ticket },
    transports: ['websocket'],
    reconnection: false,
  });
  const client = {
    socket,
    email,
    state: null,
    peers: [],
    you: null,
    events: [],
    leaderboard: [],
    id: null,
  };

  socket.on('hello', ({ playerId, state }) => {
    client.id = playerId;
    client.state = state;
  });
  socket.on('state', (state) => {
    client.state = state;
  });
  socket.on('peers', ({ peers, you }) => {
    client.peers = peers;
    client.you = you;
  });
  socket.on('event', (event) => client.events.push(event));
  socket.on('leaderboard', (rows) => {
    client.leaderboard = rows;
  });

  await new Promise((resolve, reject) => {
    socket.once('hello', resolve);
    socket.once('connect_error', reject);
    setTimeout(() => reject(new Error(`no hello for ${email}`)), 5000);
  });

  return client;
};

const waitFor = (predicate, label, timeout = 20000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const id = setInterval(() => {
      if (predicate()) {
        clearInterval(id);
        resolve();
      } else if (Date.now() - started > timeout) {
        clearInterval(id);
        reject(new Error(`timeout: ${label}`));
      }
    }, 50);
  });

const run = async () => {
  const a = await connect(PLAYER_A);
  const b = await connect(PLAYER_B);
  console.log('connected:', a.id, b.id, '| players:', a.state.players.length);

  if (a.state.status !== 'lobby') {
    a.socket.emit('reset');
    await waitFor(() => a.state.status === 'lobby', 'reset before test');
  }

  a.socket.emit('settings', { hideSeconds: 1, caughtBecome: 'spectator' });
  a.socket.emit('ready', { ready: true });
  b.socket.emit('ready', { ready: true });

  await waitFor(() => a.state.players.filter((p) => p.ready).length === 2, 'both ready');
  console.log('both ready, settings:', JSON.stringify(a.state.settings));

  const started = await new Promise((resolve) => a.socket.emit('start', {}, resolve));
  if (!started.ok) throw new Error(`start refused: ${started.error}`);

  await waitFor(() => a.state.status === 'countdown', 'countdown');
  if (a.state.players.some((p) => p.role !== null))
    throw new Error('roles leaked during countdown');
  console.log('countdown, roles hidden ✓');

  await waitFor(() => a.state.status === 'hiding', 'hiding');
  const roleOf = (client) => client.state.players.find((p) => p.id === client.id).role;
  const seeker = roleOf(a) === 'seeker' ? a : b;
  const hider = seeker === a ? b : a;
  console.log(`roles revealed: seeker=${seeker.email} hider=${hider.email}`);

  // Both land on the same page; the hider parks their cursor, the seeker hunts it.
  [seeker, hider].forEach((c) => c.socket.emit('page', { path: PAGE }));

  await waitFor(() => seeker.state.status === 'hunting', 'hunting');
  console.log('hunt open');

  // Both sides see each other as soon as they share a page: the lockdown, not a
  // grace window, is what gives the hider their chance now.
  [seeker, hider].forEach((c) => c.socket.emit('cursor', { x: 0.5, y: 0.5 }));
  await new Promise((r) => setTimeout(r, 400));
  if (seeker.peers.length !== 1) throw new Error('seeker should see the hider immediately');
  if (hider.peers.length !== 1) throw new Error('hider should see the seeker immediately');
  console.log('both sides visible on arrival \u2713');

  let jitter = 0;
  const mover = setInterval(() => {
    jitter = (jitter + 0.0005) % 0.01;
    hider.socket.emit('cursor', { x: 0.1 + jitter, y: 0.1 });
    seeker.socket.emit('cursor', { x: 0.9, y: 0.9 });
  }, 40);

  // Far apart first: the seeker must not be able to lock on.
  await new Promise((r) => setTimeout(r, 2500));
  console.log(
    'seeker sees peers:',
    JSON.stringify(seeker.peers.map((p) => [p.name, p.role, Number(p.catchProgress.toFixed(2))]))
  );
  if (seeker.peers.length !== 1) throw new Error('seeker should see exactly the hider after grace');
  if (seeker.peers[0].catchProgress > 0) throw new Error('catch progress without proximity');
  if (hider.peers.length !== 1 || hider.peers[0].role !== 'seeker')
    throw new Error('hider should always see the seeker');

  // --- lockdown -----------------------------------------------------------
  const lockdownMs = seeker.state.lockdownMs;
  if (!(seeker.you.lockedUntil > Date.now())) throw new Error('seeker not locked in');
  if (!(hider.you.lockedUntil > Date.now())) throw new Error('hider not locked in');
  console.log(
    `both locked in for ${((hider.you.lockedUntil - Date.now()) / 1000).toFixed(1)}s more \u2713`
  );

  hider.socket.emit('page', { path: ESCAPE_PAGE });
  await new Promise((r) => setTimeout(r, 400));
  if (seeker.peers.length !== 1) throw new Error('hider escaped during lockdown');
  console.log('escape attempt during lockdown ignored \u2713');

  // Once it lifts, leaving works again.
  await new Promise((r) => setTimeout(r, Math.max(0, hider.you.lockedUntil - Date.now()) + 300));
  hider.socket.emit('page', { path: ESCAPE_PAGE });
  await new Promise((r) => setTimeout(r, 400));
  if (seeker.peers.length !== 0) throw new Error('hider could not leave after the lockdown lifted');
  console.log(`escape after lockdown (${lockdownMs}ms) works \u2713`);

  hider.socket.emit('page', { path: PAGE });
  await new Promise((r) => setTimeout(r, 2000));

  clearInterval(mover);
  const chase = setInterval(() => {
    hider.socket.emit('cursor', { x: 0.5, y: 0.5 });
    seeker.socket.emit('cursor', { x: 0.51, y: 0.5 });
  }, 40);

  await waitFor(() => seeker.state.status === 'over', 'catch + game over', 8000);
  clearInterval(chase);

  const caught = seeker.events.find((e) => e.type === 'catch');
  console.log('catch event:', JSON.stringify(caught));
  console.log('result:', JSON.stringify(seeker.state.result));

  const caughtPlayer = seeker.state.players.find((p) => p.id === hider.id);
  if (!caughtPlayer.caught) throw new Error('hider not marked caught');
  if (caughtPlayer.role !== 'spectator')
    throw new Error(`caughtBecome=spectator not honoured, got ${caughtPlayer.role}`);
  if (seeker.state.result.winner !== 'seekers') throw new Error('wrong winner');

  // --- leaderboard --------------------------------------------------------
  await waitFor(
    () => seeker.leaderboard.some((r) => r.id === seeker.id && r.found > 0),
    'leaderboard updated',
    5000
  );
  const seekerRow = seeker.leaderboard.find((r) => r.id === seeker.id);
  const hiderRow = seeker.leaderboard.find((r) => r.id === hider.id);
  console.log(
    'leaderboard:',
    JSON.stringify(
      seeker.leaderboard.map((r) => [r.name, r.points, r.found, r.survived, r.caught, r.rounds])
    )
  );
  if (seekerRow.points !== seekerRow.found * 10 + seekerRow.survived * 20)
    throw new Error('points formula mismatch');
  if (hiderRow.caught < 1) throw new Error('caught not recorded for the hider');
  if (seekerRow.rounds < 1 || hiderRow.rounds < 1) throw new Error('rounds not counted');
  if (seeker.leaderboard[0].points < seeker.leaderboard[seeker.leaderboard.length - 1].points)
    throw new Error('leaderboard not sorted');
  console.log('leaderboard recorded and sorted \u2713');

  // The results card is dismissed per round, keyed on this, so it has to
  // outlive the round it belongs to.
  if (typeof seeker.state.huntStartedAt !== 'number')
    throw new Error('huntStartedAt missing once the round is over');
  console.log(
    `round key survives into the results (huntStartedAt=${seeker.state.huntStartedAt}) \u2713`
  );

  // A finished round hands everyone back their ready flag.
  if (seeker.state.players.some((p) => p.ready)) throw new Error('ready flags survived the round');
  console.log('everyone back to idle after the round \u2713');

  // The lobby has to stay usable while the results are still on screen —
  // otherwise the only way to play again is a global reset.
  seeker.socket.emit('ready', { ready: true });
  await waitFor(
    () => seeker.state.players.find((p) => p.id === seeker.id)?.ready,
    'ready while over',
    4000
  );
  seeker.socket.emit('settings', { hideSeconds: 12 });
  await waitFor(() => seeker.state.settings.hideSeconds === 12, 'settings while over', 4000);
  console.log('can ready up and change settings without resetting \u2713');
  seeker.socket.emit('ready', { ready: false });

  seeker.socket.emit('reset');
  await waitFor(() => seeker.state.status === 'lobby', 'back to lobby');
  console.log('reset to lobby ✓');

  a.socket.close();
  b.socket.close();
  console.log('\nALL CHECKS PASSED');
  process.exit(0);
};

run().catch((error) => {
  console.error('FAILED:', error.message);
  process.exit(1);
});
