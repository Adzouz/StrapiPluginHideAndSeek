import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);

const { validator, default: defaults } = require('../../server/src/config/index.js');

const rejects = (config, what) =>
  assert.throws(() => validator(config), /hide-and-seek/, `should reject ${what}`);

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
    rejects({ corsOrigin: 42 }, 'a number');
    rejects({ corsOrigin: [1] }, 'an array of non-strings');
  });

  it('caps every phase of a round', () => {
    // A phase with no ceiling keeps the deletion guards armed and the admin
    // session alive for as long as it lasts.
    rejects({ roundSeconds: 999999 }, 'an eleven-day round');
    rejects({ countdownSeconds: 999999 }, 'an eleven-day countdown');
    rejects({ hideSeconds: 600 }, 'a ten-minute hiding phase');
    rejects({ forfeitAfterMs: 999999999 }, 'a forfeit timer nobody reaches');
  });

  it('rejects a fractional number of seconds', () => {
    // These are floored on the way in, and Math.floor(0.5) is a round that
    // ends on the tick it starts.
    rejects({ roundSeconds: 0.5 }, 'half a second of round');
    rejects({ seekerCount: 1.5 }, 'one and a half seekers');
    assert.doesNotThrow(() => validator({ roundSeconds: 300 }));
  });

  it('still rejects the things it always rejected', () => {
    rejects({ roundSeconds: 0 }, 'a zero-length round');
    rejects({ roundSeconds: '600' }, 'a string');
    rejects({ catchRadius: 2 }, 'a catch radius larger than the viewport');
    rejects({ hiderSpeedLimit: -1 }, 'a negative speed limit');
    rejects({ caughtBecome: 'hider' }, 'an invalid caughtBecome');
    rejects({ tickHz: 120 }, 'a tick rate above 60');
    rejects({ pageQueryKeys: 'folder' }, 'a non-array pageQueryKeys');
  });
});
