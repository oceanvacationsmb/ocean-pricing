const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createLockFeed } = require('../lock-feed.cjs');
test('clear key names take precedence while legacy names remain supported', async () => {
  const feed = createLockFeed({ store: { data: { properties: [] } }, env: { EXTENSION_KEY: 'new-upload', CALENDAR_KEY: 'new-view', LOCK_VIEW_KEY: 'old-view' } });
  async function call(key) {
    const req = { method: 'GET', headers: { authorization: 'Bearer ' + key } };
    const res = { setHeader() {}, writeHead(status) { this.status = status; }, end() {} };
    await feed(req, res, new URL('https://example.com/api/lock-feed')); return res.status;
  }
  assert.equal(await call('new-view'), 200);
  assert.equal(await call('old-view'), 401);
  assert.equal(await call('new-upload'), 401);
});
test('all-lock mode requires complete inventory and retains last good collection', async () => {
  const properties = Array.from({ length: 26 }, (_, i) => ({ id: String(i), name: 'Property ' + i }));
  const feed = createLockFeed({ store: { data: { properties } }, env: { LOCK_COLLECTOR_KEY: 'upload', LOCK_VIEW_KEY: 'staff', LOCK_EXPECTED_LISTING_IDS: 'all' } });
  async function call(method, input) {
    const req = { method, headers: { authorization: 'Bearer ' + (method === 'GET' ? 'staff' : 'upload') }, async *[Symbol.asyncIterator]() { yield JSON.stringify(input); } };
    const res = { setHeader() {}, writeHead(status) { this.status = status; }, end(text) { this.body = JSON.parse(text); } };
    await feed(req, res, new URL('https://example.com/api/lock-feed')); return res;
  }
  const locks = properties.map(p => ({ listingId: p.id, batteryPercent: 94, online: true }));
  const capturedAt = new Date(Date.now() - 1000).toISOString();
  assert.equal((await call('POST', { complete: true, capturedAt, locks: locks.slice(0, 1) })).status, 400);
  assert.equal((await call('POST', { complete: true, capturedAt, locks })).status, 200);
  assert.equal((await call('POST', { complete: true, capturedAt: new Date().toISOString(), locks: locks.slice(0, 25) })).status, 400);
  assert.equal((await call('GET')).body.locks.length, 26);
});
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
