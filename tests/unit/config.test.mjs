import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);

const { validator, default: defaults } = require('../../server/src/config/index.js');

const rejects = (config, what) =>
  assert.throws(() => validator(config), /hide-and-seek/, `should reject ${what}`);

/**
 * Out-of-range numbers are repaired in place rather than thrown at: the
 * validator mutates the object Strapi is about to hand the plugin, and a throw
 * here exits the host CMS. Returns nothing — the assertion is what `config`
 * holds afterwards.
 */
const clamps = (config, key, expected, what) => {
  assert.doesNotThrow(() => validator(config), `should not refuse to boot over ${what}`);
  assert.equal(config[key], expected, `should clamp ${what}`);
};

describe('config validation', () => {
  it('accepts the shipped defaults', () => {
    assert.doesNotThrow(() => validator(defaults));
    assert.doesNotThrow(() => validator({}));
  });

  it('rejects a boolean written as a string', () => {
    // The one that matters: a string is truthy, so 'false' used to switch the
    // prey's lockdown exemption ON.
    rejects({ preyEscapesLockdown: 'false' }, "preyEscapesLockdown: 'false'");
    rejects({ safeZone: 'false' }, "safeZone: 'false'");
    assert.doesNotThrow(() => validator({ preyEscapesLockdown: false }));
  });

  it('rejects an unknown mode', () => {
    rejects({ mode: 'deathmatch' }, 'an invented mode');
    assert.doesNotThrow(() => validator({ mode: 'manhunt' }));
    assert.doesNotThrow(() => validator({ mode: 'classic' }));
  });

  it('accepts every shape socket.io takes for corsOrigin, and nothing else', () => {
    assert.doesNotThrow(() => validator({ corsOrigin: true }));
    assert.doesNotThrow(() => validator({ corsOrigin: 'https://example.com' }));
    assert.doesNotThrow(() => validator({ corsOrigin: ['https://example.com'] }));
    assert.doesNotThrow(() => validator({ corsOrigin: () => true }));
    // socket.io hands this to the `cors` package, which branches on
    // `instanceof RegExp` and walks arrays element-wise — and Strapi stores
    // plugin config without a clone or a JSON round-trip, so a RegExp written
    // in config/plugins.ts arrives at the socket server intact.
    assert.doesNotThrow(() => validator({ corsOrigin: /^https:\/\/.*\.internal$/ }));
    assert.doesNotThrow(() => validator({ corsOrigin: [/^https:\/\/a\.internal$/] }));
    rejects({ corsOrigin: 42 }, 'a number');
    rejects({ corsOrigin: [1] }, 'an array of non-strings');
  });

  it('caps every phase of a round without refusing to boot', () => {
    // A phase with no ceiling keeps the deletion guards armed and the admin
    // session alive for as long as it lasts. But a throw here is rethrown by
    // Strapi's plugin loader into `stopWithError`, so an install that worked
    // on a version with no ceilings would stop booting on upgrade over a
    // number the game can perfectly well clamp.
    clamps({ roundSeconds: 999999 }, 'roundSeconds', 3600, 'an eleven-day round');
    clamps({ countdownSeconds: 999999 }, 'countdownSeconds', 60, 'an eleven-day countdown');
    clamps({ hideSeconds: 600 }, 'hideSeconds', 120, 'a ten-minute hiding phase');
    clamps({ forfeitAfterMs: 999999999 }, 'forfeitAfterMs', 300000, 'an unreachable forfeit');
    clamps({ seekerCount: 999 }, 'seekerCount', 50, 'more seekers than players');
  });

  it('floors a fractional number of seconds to a whole one', () => {
    // Math.floor(0.5) is a round that ends on the tick it starts, so the floor
    // is one rather than zero.
    clamps({ roundSeconds: 0.5 }, 'roundSeconds', 1, 'half a second of round');
    clamps({ seekerCount: 1.5 }, 'seekerCount', 1, 'one and a half seekers');
    clamps({ roundSeconds: 600.7 }, 'roundSeconds', 600, 'a fractional round');
    assert.doesNotThrow(() => validator({ roundSeconds: 300 }));
  });

  it('gives the tick rate a floor as well as a ceiling', () => {
    // `tick()` is the only thing that transitions phases, finishes rounds and
    // sweeps disconnects, so a fractional tickHz leaves the deletion guards
    // armed long past the end of the round.
    clamps({ tickHz: 0.01 }, 'tickHz', 1, 'a tick every hundred seconds');
    clamps({ tickHz: 120 }, 'tickHz', 60, 'a tick rate above 60');
    clamps({ tickHz: 20.5 }, 'tickHz', 20, 'a fractional tick rate');
  });

  it('leaves a configured pageQueryKeys whole', () => {
    // The default is null, not the list: Strapi merges plugin config with
    // lodash defaultsDeep, which recurses into arrays index-wise, so a default
    // of ['folder', 'folderPath'] would turn ['plugins'] into
    // ['plugins', 'folderPath'] and silently disarm the folder guard.
    assert.equal(defaults.pageQueryKeys, null);
    assert.doesNotThrow(() => validator({ pageQueryKeys: ['plugins'] }));
    assert.doesNotThrow(() => validator({ pageQueryKeys: [] }));
  });

  it('still rejects the things it always rejected', () => {
    rejects({ roundSeconds: 0 }, 'a zero-length round');
    rejects({ roundSeconds: '600' }, 'a string');
    rejects({ catchRadius: 2 }, 'a catch radius larger than the viewport');
    rejects({ hiderSpeedLimit: -1 }, 'a negative speed limit');
    rejects({ caughtBecome: 'hider' }, 'an invalid caughtBecome');
    rejects({ pageQueryKeys: 'folder' }, 'a non-array pageQueryKeys');
    rejects({ tickHz: -1 }, 'a negative tick rate');
  });
});
