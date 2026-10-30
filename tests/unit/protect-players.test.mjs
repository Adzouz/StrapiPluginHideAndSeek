import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { describe, it } from 'node:test';

const require = createRequire(import.meta.url);

const {
  targetsFor,
  entryTargetsFor,
  folderTargetsFor,
} = require('../../server/src/middlewares/protect-players.js');

/** The shape of a Koa context, as far as these matchers care. */
const ctx = (method, path, body = undefined) => ({
  method,
  // Koa's ctx.path is the raw, undecoded pathname.
  path,
  request: { body },
});

describe('admin user targets', () => {
  it('matches a single delete', () => {
    assert.deepEqual(targetsFor(ctx('DELETE', '/admin/users/7')), {
      verb: 'delete',
      ids: ['7'],
    });
  });

  it('matches a batch delete', () => {
    assert.deepEqual(targetsFor(ctx('POST', '/admin/users/batch-delete', { ids: [1, 2] })), {
      verb: 'delete',
      ids: [1, 2],
    });
  });

  it('matches a deactivation but not any other edit', () => {
    assert.equal(targetsFor(ctx('PUT', '/admin/users/7', { isActive: false })).verb, 'deactivate');
    assert.equal(
      targetsFor(ctx('PUT', '/admin/users/7', { isActive: 'false' })).verb,
      'deactivate'
    );
    assert.equal(targetsFor(ctx('PUT', '/admin/users/7', { firstname: 'Sam' })), null);
    assert.equal(targetsFor(ctx('GET', '/admin/users/7')), null);
  });

  // Koa's router decodes its captures before the controller sees them, so a
  // matcher reading the raw path compares '%37' against the id '7' and lets
  // the request through — deleting a player out of a running round.
  it('reads a percent-encoded id the way the router will', () => {
    assert.deepEqual(targetsFor(ctx('DELETE', '/admin/users/%37')).ids, ['7']);
  });

  it('survives a malformed escape rather than throwing', () => {
    assert.deepEqual(targetsFor(ctx('DELETE', '/admin/users/%ZZ')).ids, ['%ZZ']);
  });

  it('ignores a body that is not a list', () => {
    assert.equal(targetsFor(ctx('POST', '/admin/users/batch-delete', { ids: 'all' })), null);
    assert.equal(targetsFor(ctx('POST', '/admin/users/batch-delete', undefined)), null);
  });
});

describe('content entry targets', () => {
  it('matches a single entry delete', () => {
    assert.deepEqual(
      entryTargetsFor(ctx('DELETE', '/content-manager/collection-types/api::a.a/doc-1')),
      { model: 'api::a.a', documentIds: ['doc-1'] }
    );
  });

  it('decodes the model uid, whose colons are often escaped', () => {
    assert.deepEqual(
      entryTargetsFor(ctx('DELETE', '/content-manager/collection-types/api%3A%3Aa.a/doc-1')),
      { model: 'api::a.a', documentIds: ['doc-1'] }
    );
  });

  it('matches a single type, which has no document id', () => {
    assert.deepEqual(entryTargetsFor(ctx('DELETE', '/content-manager/single-types/api::b.b')), {
      model: 'api::b.b',
      documentIds: [],
    });
  });

  it('matches a bulk delete and reads either body key', () => {
    const path = '/content-manager/collection-types/api::a.a/actions/bulkDelete';

    assert.deepEqual(entryTargetsFor(ctx('POST', path, { documentIds: ['x'] })).documentIds, ['x']);
    assert.deepEqual(entryTargetsFor(ctx('POST', path, { ids: ['y'] })).documentIds, ['y']);
    assert.equal(entryTargetsFor(ctx('POST', path, {})), null);
  });

  it('ignores reads and updates', () => {
    assert.equal(
      entryTargetsFor(ctx('GET', '/content-manager/collection-types/api::a.a/doc-1')),
      null
    );
    assert.equal(
      entryTargetsFor(ctx('PUT', '/content-manager/collection-types/api::a.a/doc-1')),
      null
    );
  });
});

describe('media library folder targets', () => {
  const PATH = '/upload/actions/bulk-delete';

  it('matches a folder delete', () => {
    assert.deepEqual(folderTargetsFor(ctx('POST', PATH, { folderIds: [3, 4] })), [3, 4]);
  });

  it('ignores a delete of files only', () => {
    assert.equal(folderTargetsFor(ctx('POST', PATH, { fileIds: [1] })), null);
    assert.equal(folderTargetsFor(ctx('POST', PATH, { folderIds: [] })), null);
  });

  it('ignores a hostile or absent body', () => {
    assert.equal(folderTargetsFor(ctx('POST', PATH, { folderIds: 'all' })), null);
    assert.equal(folderTargetsFor(ctx('POST', PATH, null)), null);
    assert.equal(folderTargetsFor(ctx('POST', PATH, undefined)), null);
  });

  it('ignores the other bulk actions on the same prefix', () => {
    assert.equal(
      folderTargetsFor(ctx('POST', '/upload/actions/bulk-move', { folderIds: [3] })),
      null
    );
    assert.equal(folderTargetsFor(ctx('GET', PATH, { folderIds: [3] })), null);
  });
});
