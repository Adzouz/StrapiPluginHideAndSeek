import {
  BASE,
  PASSWORD,
  USERS,
  check,
  connect,
  connectWithToken,
  sleep,
  tokenFor,
  wait,
} from './helpers.mjs';

/**
 * The guard that stops an admin user being deleted out of a running round.
 *
 * Every user this suite deletes is one it created, so it never removes the
 * shared test accounts the other suites depend on.
 */

const api = async (path, { method = 'GET', token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  return { status: res.status, body: await res.json().catch(() => null) };
};

/** Creates a throwaway admin. `playable` also sets a password so it can log in. */
const createAdmin = async (token, { playable }) => {
  const email = `hns-${playable ? 'player' : 'bystander'}-${Date.now()}@hns.test`;
  const created = await api('/admin/users', {
    method: 'POST',
    token,
    body: { email, firstname: 'Throwaway', lastname: 'Admin', roles: [1] },
  });

  if (!created.body?.data) {
    throw new Error(`create admin: ${created.status} ${JSON.stringify(created.body?.error)}`);
  }

  const { id, registrationToken } = created.body.data;

  if (!playable) {
    return { id, email, token: null };
  }

  const registered = await api('/admin/register', {
    method: 'POST',
    body: {
      registrationToken,
      userInfo: { firstname: 'Throwaway', lastname: 'Admin', password: PASSWORD },
    },
  });

  if (!registered.body?.data?.token) {
    throw new Error(
      `register admin: ${registered.status} ${JSON.stringify(registered.body?.error)}`
    );
  }

  return { id, email, token: registered.body.data.token };
};

const del = (token, id) => api(`/admin/users/${id}`, { method: 'DELETE', token });
const setActive = (token, id, isActive) =>
  api(`/admin/users/${id}`, { method: 'PUT', token, body: { isActive } });
const batchDel = (token, ids) =>
  api('/admin/users/batch-delete', { method: 'POST', token, body: { ids } });

const run = async () => {
  const admin = await tokenFor(USERS[0]);

  const victim = await createAdmin(admin, { playable: true });
  const bystander = await createAdmin(admin, { playable: false });
  console.log(`created a throwaway player (#${victim.id}) and a bystander (#${bystander.id})`);

  const seeker = await connect(USERS[0]);
  const hider = await connect(USERS[1]);
  const guest = await connectWithToken(victim.token, victim.email);
  const players = [seeker, hider, guest];

  if (seeker.state.status !== 'lobby') {
    seeker.socket.emit('reset');
    await wait(() => seeker.state.status === 'lobby', 'reset');
  }

  console.log('\nwhile in the lobby');
  const inLobby = await del(admin, victim.id);
  check(inLobby.status !== 409, `a lobby member can still be deleted (${inLobby.status})`);

  // That really deleted them, so bring a fresh one in for the round.
  guest.socket.close();
  const player = await createAdmin(admin, { playable: true });
  const guest2 = await connectWithToken(player.token, player.email);
  players[2] = guest2;

  seeker.socket.emit('settings', { hideSeconds: 1, seekerCount: 1 });
  players.forEach((c) => c.socket.emit('ready', { ready: true }));
  await wait(() => seeker.state.players.filter((p) => p.ready).length === 3, 'ready');
  await new Promise((r) => seeker.socket.emit('start', {}, r));
  await wait(() => seeker.state.status === 'hunting', 'hunting', 15000);

  console.log('\nduring a round');
  const blocked = await del(admin, player.id);
  check(blocked.status === 409, `single delete refused with ${blocked.status}`);
  check(
    blocked.body?.error?.name === 'HideAndSeekRoundInProgress',
    `named error: ${blocked.body?.error?.name}`
  );
  console.log(`   message: "${blocked.body?.error?.message}"`);

  const batch = await batchDel(admin, [player.id]);
  check(batch.status === 409, `batch delete refused with ${batch.status}`);

  const deactivate = await setActive(admin, player.id, false);
  check(deactivate.status === 409, `deactivating a player refused with ${deactivate.status}`);
  check(
    deactivate.body?.error?.details?.action === 'deactivate',
    `refusal names the action: ${deactivate.body?.error?.details?.action}`
  );

  // Editing a player in harmless ways still works.
  const rename = await api(`/admin/users/${player.id}`, {
    method: 'PUT',
    token: admin,
    body: { firstname: 'Renamed' },
  });
  check(rename.status !== 409, `renaming a player mid-round is fine (${rename.status})`);

  const spareOff = await setActive(admin, bystander.id, false);
  check(spareOff.status !== 409, `deactivating a non-player is fine (${spareOff.status})`);

  console.log('\nafter the round');
  seeker.socket.emit('reset');
  await wait(() => seeker.state.status === 'lobby', 'lobby');
  await sleep(300);
  const after = await del(admin, player.id);
  check(after.status !== 409, `deletion allowed again once the round is over (${after.status})`);

  const bystanderGone = await del(admin, bystander.id);
  check(bystanderGone.status !== 409, `throwaway bystander cleaned up (${bystanderGone.status})`);

  players.forEach((c) => c.socket.close());
  console.log('\nPLAYER DELETION GUARD PASSES');
  process.exit(0);
};

run().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
