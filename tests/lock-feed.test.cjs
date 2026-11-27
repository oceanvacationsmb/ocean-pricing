const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLockFeed } = require('../lock-feed.cjs');
test('private lock feed isolates credentials, validates complete scope, and never persists to GitHub', async () => {
  const feed = createLockFeed({ store: { data: { properties: [{ id: 'one', name: '113' }] }, save() { throw Error('Must not persist'); } }, env: { LOCK_COLLECTOR_KEY: 'upload', LOCK_VIEW_KEY: 'staff', LOCK_EXPECTED_LISTING_IDS: 'one' } });
  async function call(method, key, input, origin) {
    const req = { method, headers: { authorization: 'Bearer ' + key, ...(origin ? { origin } : {}) }, async *[Symbol.asyncIterator]() { yield JSON.stringify(input); } };
    const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(text) { this.body = text ? JSON.parse(text) : null; } };
    await feed(req, res, new URL('https://example.com/api/lock-feed'));
    return res;
  }
  const payload = { complete: true, capturedAt: new Date().toISOString(), locks: [{ listingId: 'one', batteryPercent: 94, online: true, code: 'NEVER_COPY' }] };
  assert.equal((await call('GET', 'upload')).status, 401);
  assert.equal((await call('POST', 'staff', payload)).status, 401);
  assert.equal((await call('GET', 'staff', null, 'https://evil.example')).status, 403);
  assert.equal((await call('POST', 'upload', { ...payload, complete: false })).status, 400);
  assert.equal((await call('POST', 'upload', payload)).status, 200);
  const result = await call('GET', 'staff');
  assert.equal(result.body.locks[0].batteryPercent, 94);
  assert.equal(result.body.locks[0].code, undefined);
  assert.equal(result.body.stale, false);
  assert.equal((await call('POST', 'upload', payload)).status, 409);
  assert.equal((await call('POST', 'upload', { ...payload, locks: [{ listingId: 'unknown', online: false }] })).status, 400);
  assert.equal((await call('GET', 'staff')).body.locks[0].online, true);
});
