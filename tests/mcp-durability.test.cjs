const { test } = require('node:test');
const assert = require('node:assert/strict');
const { ConnectorAuth } = require('../mcp-auth.cjs');
const { Providers } = require('../providers.cjs');
const origin = 'https://example.com';
test('authorization survives restarts, rotates durably, and stores no raw credentials', async () => {
  let disk;
  const store = { data: {}, save() { disk = JSON.stringify(this.data); }, async flush() {} };
  let auth = new ConnectorAuth(origin, 'test-password', store);
  const client = await auth.clientsStore.registerClient({ redirect_uris: ['https://chatgpt.com/callback'] });
  const first = await auth.issue(client, ['guesty:read']);
  assert.equal(disk.includes(first.access_token), false);
  assert.equal(disk.includes(first.refresh_token), false);
  const restartedStore = { ...store, data: JSON.parse(disk) };
  auth = new ConnectorAuth(origin, 'test-password', restartedStore);
  assert.equal((await auth.verifyAccessToken(first.access_token)).clientId, client.client_id);
  await assert.rejects(auth.exchangeRefreshToken({ client_id: 'wrong' }, first.refresh_token));
  await assert.rejects(auth.exchangeRefreshToken(client, first.refresh_token, ['guesty:write']));
  const next = await auth.exchangeRefreshToken(client, first.refresh_token);
  const third = new ConnectorAuth(origin, 'test-password', { ...store, data: JSON.parse(disk) });
  await assert.rejects(third.exchangeRefreshToken(client, first.refresh_token));
  assert.deepEqual((await third.verifyAccessToken(next.access_token)).scopes, ['guesty:read']);
  await third.revokeToken(client, { token: next.refresh_token });
  await assert.rejects(new ConnectorAuth(origin, 'test-password', { ...store, data: JSON.parse(disk) }).exchangeRefreshToken(client, next.refresh_token));
  await assert.rejects(new ConnectorAuth(origin, 'new-password', restartedStore).verifyAccessToken(first.access_token));
});
test('expired access renews from saved refresh authorization after a restart', async () => {
  const store = { data: {}, save() {}, async flush() {} };
  const auth = new ConnectorAuth(origin, 'test-password', store);
  const client = { client_id: 'client' };
  const issued = await auth.issue(client, ['guesty:read', 'guesty:write']);
  const now = Date.now;
  try {
    Date.now = () => now() + 2 * 3600000;
    const restarted = new ConnectorAuth(origin, 'test-password', store);
    await assert.rejects(restarted.verifyAccessToken(issued.access_token));
    const renewed = await restarted.exchangeRefreshToken(client, issued.refresh_token);
    assert.deepEqual((await restarted.verifyAccessToken(renewed.access_token)).scopes, ['guesty:read', 'guesty:write']);
  } finally { Date.now = now; }
});
test('Guesty inbox reads automatically renew expired and rejected provider tokens', async () => {
  let authCalls = 0, reads = 0, rejectOnce = false;
  const providers = new Providers(async (url, options) => {
    providers.nextGuestyRequest = 0;
    if (url.includes('/oauth2/token')) return { ok: true, status: 200, json: async () => ({ access_token: 'test-token-' + (++authCalls), expires_in: 86400 }) };
    assert.match(url, /communication\/conversations/);
    assert.equal(options.method, 'GET'); reads++;
    if (rejectOnce) { rejectOnce = false; return { ok: false, status: 401 }; }
    return { ok: true, status: 200, json: async () => ({ results: [] }) };
  });
  providers.configure({ guestyClientId: 'test-id', guestyClientSecret: 'test-secret' });
  await providers.guestyGet('/communication/conversations');
  providers.token.expires = Date.now() - 1;
  await providers.guestyGet('/communication/conversations');
  assert.equal(authCalls, 2);
  rejectOnce = true;
  await providers.guestyGet('/communication/conversations');
  assert.equal(authCalls, 3); assert.equal(reads, 4);
});
