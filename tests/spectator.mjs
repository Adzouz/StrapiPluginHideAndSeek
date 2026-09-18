import { io } from 'socket.io-client';

const BASE = process.env.HNS_URL ?? 'http://127.0.0.1:1337';
const PASSWORD = process.env.HNS_PASSWORD ?? 'HideSeek1!';
const USERS = (process.env.HNS_USERS ?? 'seeker@hns.test,hider@hns.test,third@hns.test').split(',');
/** The hint test waits out hintAfterMs; set HNS_SKIP_SLOW=1 to stop before it. */
const SKIP_SLOW = process.env.HNS_SKIP_SLOW === '1';
const A = '/admin/plugins/alpha';
const B = '/admin/plugins/beta';

const connect = async (email) => {
  const r = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const { data } = await r.json();
  const t = await fetch(`${BASE}/hide-and-seek/ticket`, {
    headers: { Authorization: `Bearer ${data.token}` },
  });
  const d = await t.json();
  const socket = io(BASE, {
    path: d.socketPath,
    auth: { ticket: d.ticket },
    transports: ['websocket'],
    reconnection: false,
  });
  const c = { socket, email, state: null, peers: [], you: null, id: null, events: [] };
  socket.on('hello', ({ playerId, state }) => {
    c.id = playerId;
    c.state = state;
  });
  socket.on('state', (s) => {
    c.state = s;
  });
  socket.on('peers', (v) => {
    c.peers = v.peers;
    c.you = v.you;
  });
  socket.on('event', (e) => c.events.push(e));
  await new Promise((res, rej) => {
    socket.once('hello', res);
    socket.once('connect_error', rej);
    setTimeout(() => rej(new Error('no hello')), 5000);
  });
  return c;
};

const wait = (fn, label, ms = 20000) =>
  new Promise((res, rej) => {
    const t0 = Date.now();
    const id = setInterval(() => {
      if (fn()) {
        clearInterval(id);
        res(Date.now() - t0);
      } else if (Date.now() - t0 > ms) {
        clearInterval(id);
        rej(new Error('timeout: ' + label));
      }
    }, 20);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const check = (ok, msg) => {
  if (!ok) throw new Error(msg);
  console.log('  ✓ ' + msg);
};

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
