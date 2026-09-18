import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { io } from 'socket.io-client';

export const BASE = process.env.HNS_URL ?? 'http://127.0.0.1:1337';
export const PASSWORD = process.env.HNS_PASSWORD ?? 'HideSeek1!';
export const USERS = (
  process.env.HNS_USERS ?? 'seeker@hns.test,hider@hns.test,third@hns.test'
).split(',');

const CACHE = join(dirname(fileURLToPath(import.meta.url)), '.tokens.json');

/**
 * Admin tokens are cached on disk, keyed by server and user.
 *
 * Strapi rate limits `/admin/login`, and these suites connect several players
 * and reconnect them. Logging in every time earns a 429 partway through a run —
 * which surfaces as a game assertion failing, not as an auth error, and sends
 * you hunting for a bug that is not there. The cache also spans processes, so
 * the four suites can be run back to back.
 */
const readCache = () => {
  try {
    return JSON.parse(readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
};

const writeCache = (cache) => {
  try {
    writeFileSync(CACHE, `${JSON.stringify(cache, null, 2)}\n`);
  } catch {
    /* read-only checkout: fall back to logging in each time */
  }
};

const login = async (email) => {
  const res = await fetch(`${BASE}/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();

  if (!res.ok || !body.data) {
    const hint =
      res.status === 429 ? ' (Strapi rate limited the login — restart the server to clear it)' : '';

    throw new Error(`login ${email}: ${res.status}${hint}`);
  }

  return body.data.token;
};

const ticket = async (token) => {
  const res = await fetch(`${BASE}/hide-and-seek/ticket`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  return res.ok ? res.json() : null;
};

const open = async (handshake, label) => {
  const socket = io(BASE, {
    path: handshake.socketPath,
    auth: { ticket: handshake.ticket },
    transports: ['websocket'],
    reconnection: false,
  });

  const client = {
    socket,
    email: label,
    id: null,
    state: null,
    peers: [],
    you: null,
    events: [],
    leaderboard: [],
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
    setTimeout(() => reject(new Error(`no hello for ${label}`)), 5000);
  });

  return client;
};

/** A cached admin token for this user, logging in only if there is not one. */
export const tokenFor = async (email) => {
  const cache = readCache();
  const key = `${BASE}|${email}`;

  if (cache[key] && (await ticket(cache[key]))) {
    return cache[key];
  }

  const token = await login(email);

  cache[key] = token;
  writeCache(cache);

  return token;
};

/** Connects a player from an admin token you already hold. */
export const connectWithToken = async (token, label = 'player') => {
  const handshake = await ticket(token);

  if (!handshake) {
    throw new Error(`ticket ${label}: refused`);
  }

  return open(handshake, label);
};

/** Connects one player, reusing a cached token when it is still good. */
export const connect = async (email) => {
  const cache = readCache();
  const key = `${BASE}|${email}`;

  let handshake = cache[key] ? await ticket(cache[key]) : null;

  if (!handshake) {
    // No token, or the cached one has expired.
    const token = await login(email);

    cache[key] = token;
    writeCache(cache);
    handshake = await ticket(token);

    if (!handshake) {
      throw new Error(`ticket ${email}: refused with a fresh token`);
    }
  }

  return open(handshake, email);
};

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Resolves with the elapsed time once the predicate holds. */
export const wait = (predicate, label, timeout = 20000) =>
  new Promise((resolve, reject) => {
    const started = Date.now();
    const id = setInterval(() => {
      if (predicate()) {
        clearInterval(id);
        resolve(Date.now() - started);
      } else if (Date.now() - started > timeout) {
        clearInterval(id);
        reject(new Error(`timeout: ${label}`));
      }
    }, 20);
  });

/** The roster as a human would read it, for assertion messages. */
export const roster = (client) =>
  client.state.players.map((p) => `${p.name}${p.connected ? '' : ' (disconnected)'}`);

export const check = (ok, message) => {
  if (!ok) {
    throw new Error(message);
  }

  console.log(`  ✓ ${message}`);
};
