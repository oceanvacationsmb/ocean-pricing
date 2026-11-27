const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
test('refresh accepts the extension settings tab but not a Guesty content script', async () => {
  let listener, reloads = 0;
  const noop = { addListener() {} };
  const chrome = {
    runtime: { id: 'test', getURL: file => 'chrome-extension://test/' + file, onInstalled: noop, onStartup: noop, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { setAccessLevel() {}, async get() { return { enabled: true }; }, async set() {} } },
    alarms: { create() {}, onAlarm: noop },
    tabs: { async query() { return [{ id: 42 }]; }, async reload(id) { assert.equal(id, 42); reloads++; } },
    action: { async setBadgeText() {} }
  };
  vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname, 'background.js'), 'utf8'), { chrome, URL });
  const call = sender => new Promise(resolve => listener({ type: 'refresh' }, sender, resolve));
  assert.equal((await call({ id: 'test', url: 'chrome-extension://test/popup.html', tab: { id: 1 } })).ok, true);
  assert.equal(reloads, 1);
  assert.equal((await call({ id: 'test', url: 'https://oceanvacationsmb.github.io/-shared_calendar-/calendar_all/', tab: { id: 3 } })).ok, true);
  assert.equal(reloads, 2);
  assert.equal((await call({ id: 'test', url: 'https://oceanvacationsmb.github.io/unrelated/', tab: { id: 4 } })).ok, false);
  assert.equal((await call({ id: 'test', url: 'https://app.guesty.com/', tab: { id: 2 } })).ok, false);
  assert.equal(reloads, 2);
});
