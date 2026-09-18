import { io } from 'socket.io-client';

const BASE = process.env.HNS_URL ?? 'http://127.0.0.1:1337';
const PASSWORD = process.env.HNS_PASSWORD ?? 'HideSeek1!';
const USERS = (process.env.HNS_USERS ?? 'seeker@hns.test,hider@hns.test,third@hns.test').split(',');

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
  const c = { socket, email, state: null, id: null };
  socket.on('hello', ({ playerId, state }) => {
    c.id = playerId;
    c.state = state;
  });
  socket.on('state', (s) => {
    c.state = s;
  });
  await new Promise((res, rej) => {
    socket.once('hello', res);
    socket.once('connect_error', rej);
    setTimeout(() => rej(new Error('no hello')), 5000);
  });
  return c;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const roster = (c) =>
  c.state.players.map((p) => `${p.name}${p.connected ? '' : ' (disconnected)'}`);
const check = (ok, msg) => {
  if (!ok) throw new Error(msg);
  console.log('  ✓ ' + msg);
};

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

  a.socket.close();
  c3.socket.close();
  console.log('\nDISCONNECT HANDLING PASSES');
  process.exit(0);
};
run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
