const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, 'observe.js'), 'utf8');
function browser(payload) {
  const messages = [];
  class XHR {
    open() {}
    send() { this.status = 200; this.responseText = JSON.stringify(payload); this.listener(); }
    addEventListener(event, listener) { this.listener = listener; }
  }
  const window = { postMessage(message) { messages.push(message); }, fetch: async () => ({ ok: true, clone: () => ({ json: async () => payload }) }) };
  vm.runInNewContext(source, { window, XMLHttpRequest: XHR, location: { href: 'https://app.guesty.com/', origin: 'https://app.guesty.com' }, URL, Request, Date, Set, WeakMap });
  return { window, XHR, messages };
}
const url = 'https://app.guesty.com/api/sl-service/locks?linked=true';
test('XHR capture converts battery fractions and only forwards health allowlist', () => {
  const b = browser({ cursor: { hasMore: false }, data: [{ batteryLevel: 0.94, online: true, listings: [{ id: 'one' }], providerAccount: { webviewUrl: 'SECRET' }, code: 'SECRET' }] });
  const xhr = new b.XHR(); xhr.open('GET', url); xhr.send();
  assert.equal(b.messages.length, 1);
  assert.equal(b.messages[0].locks[0].batteryPercent, 94);
  assert.equal(JSON.stringify(b.messages).includes('SECRET'), false);
  assert.deepEqual(Object.keys(b.messages[0].locks[0]), ['listingId', 'batteryPercent', 'online']);
});
test('partial, duplicate, empty, and unrelated responses cannot overwrite readings', () => {
  for (const payload of [
    { cursor: { hasMore: true }, data: [{ listings: [{ id: 'one' }] }] },
    { cursor: { hasMore: false }, data: [] },
    { cursor: { hasMore: false }, data: [{ listings: [{ id: 'one' }] }, { listings: [{ id: 'one' }] }] }
  ]) {
    const b = browser(payload); const xhr = new b.XHR(); xhr.open('GET', url); xhr.send(); assert.equal(b.messages.length, 0);
  }
});
test('fetch capture retains unknown connectivity instead of guessing offline', async () => {
  const b = browser({ cursor: { hasMore: false }, data: [{ batteryLevel: null, listings: [{ id: 'one' }] }] });
  await b.window.fetch(url); await new Promise(resolve => setImmediate(resolve));
  assert.equal(b.messages[0].locks[0].online, null);
  assert.equal(b.messages[0].locks[0].batteryPercent, null);
});
