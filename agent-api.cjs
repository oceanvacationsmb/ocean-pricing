const crypto = require('node:crypto');
const { fail } = require('./providers.cjs');
const digest = value => crypto.createHash('sha256').update(value).digest();
function authorized(req, key) {
  return Boolean(key) && crypto.timingSafeEqual(digest(String(req.headers.authorization || '')), digest('Bearer ' + key));
}
async function body(req) {
  let text = '';
  for await (const chunk of req) { text += chunk; if (text.length > 200000) throw fail(413, 'Request too large.'); }
  try { return JSON.parse(text || '{}'); } catch { throw fail(400, 'Invalid JSON.'); }
}
function snapshot(input, properties) {
  const time = Date.parse(input.capturedAt);
  if (!Number.isFinite(time) || time > Date.now() + 60000 || !Array.isArray(input.locks) || !input.locks.length) throw fail(400, 'Provide a timestamp and complete, nonempty lock readings.');
  const seen = new Set();
  const locks = input.locks.map(lock => {
    const property = properties.find(p => p.id === lock.listingId);
    if (!property || seen.has(lock.listingId)) throw fail(400, 'Use unique known Guesty listing IDs.');
    seen.add(lock.listingId);
    if (![true, false, null].includes(lock.online)) throw fail(400, 'Connectivity must be true, false, or null.');
    const batteryPercent = lock.batteryPercent ?? null;
    if (batteryPercent !== null && (typeof batteryPercent !== 'number' || !Number.isFinite(batteryPercent) || batteryPercent < 0 || batteryPercent > 100)) throw fail(400, 'Battery must be between 0 and 100, or null.');
    return { listingId: property.id, propertyName: property.name, propertyKey: property.name.toLowerCase().replace(/[^a-z0-9]/g, ''),
      online: lock.online, batteryPercent, batteryStatus: batteryPercent === null ? 'unknown' : batteryPercent <= 10 ? 'critical' : batteryPercent <= 30 ? 'low' : 'good' };
  });
  return { capturedAt: new Date(time).toISOString(), source: 'guesty-dashboard-observation', locks };
}
function createAgentApi({ store, providers, env = process.env, priceWriter = async (path, payload) => {
  const token = await providers.guestyToken();
  const response = await providers.guestyRequest('https://open-api.guesty.com/v1' + path, {
    method: 'PUT', headers: { Authorization: 'Bearer ' + token, Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(45000)
  });
  if (!response.ok) throw fail(502, 'Guesty price update failed (' + response.status + '). No automatic retry was made.');
} }) {
  return async (req, res, url) => {
    const route = url.pathname;
    const publicLocks = route === '/api/locks-status';
    if (!publicLocks && !route.startsWith('/api/agent/')) return false;
    const send = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); return true; };
    try {
      if (publicLocks) {
        if (req.method !== 'GET') throw fail(405, 'Read-only endpoint.');
        const origin = req.headers.origin;
        const allowed = String(env.CALENDAR_ORIGIN || '').split(',').map(x => x.trim()).filter(Boolean);
        if (origin) {
          if (!allowed.includes(origin)) throw fail(403, 'Calendar origin is not configured.');
          res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
        }
        const saved = store.data.lockSnapshot;
        if (!saved) return send(503, { ok: false, locks: [], capturedAt: null, warning: 'No lock readings have been collected yet.' });
        const stale = Date.now() - Date.parse(saved.capturedAt) > 30 * 60000;
        return send(200, { ok: true, ...saved, stale, ...(stale ? { warning: 'Saved lock readings are over 30 minutes old.' } : {}) });
      }
      const write = req.method !== 'GET';
      if (!authorized(req, write ? env.DOT_WRITE_KEY : env.DOT_READ_KEY)) throw fail(401, 'Agent access is not authorized.');
      if (route === '/api/agent/status' && req.method === 'GET') {
        await providers.guestyGet('/listings?limit=1&fields=_id');
        return send(200, { ok: true, guestyConnected: true, lockCapturedAt: store.data.lockSnapshot?.capturedAt || null });
      }
      if (route === '/api/agent/inbox' && req.method === 'GET') {
        const query = new URLSearchParams({ limit: '25', type: 'guest', sort: '-createdAt' });
        if (url.searchParams.has('cursorAfter')) query.set('cursorAfter', url.searchParams.get('cursorAfter'));
        return send(200, { ok: true, data: await providers.guestyGet('/communication/conversations?' + query) });
      }
      if (route === '/api/agent/locks' && req.method === 'POST') {
        const input = await body(req);
        if (input.complete !== true) throw fail(400, 'Only complete dashboard observations can replace readings.');
        const next = snapshot(input, store.data.properties);
        if (store.data.lockSnapshot && Date.parse(next.capturedAt) <= Date.parse(store.data.lockSnapshot.capturedAt)) throw fail(409, 'Older observations cannot replace newer readings.');
        store.data.lockSnapshot = next; store.save(); await store.flush();
        return send(200, { ok: true, ...next });
      }
      if (route === '/api/agent/prices' && req.method === 'PUT') {
        const input = await body(req);
        if (input.confirm !== true || !store.data.properties.some(p => p.id === input.listingId)) throw fail(400, 'Confirm an update for a known property.');
        const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
        if (!validDate(input.startDate) || !validDate(input.endDate) || input.startDate > input.endDate || typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price <= 0) throw fail(400, 'Provide valid dates and a positive nightly price.');
        const payload = { startDate: input.startDate, endDate: input.endDate, price: input.price };
        await priceWriter('/availability-pricing/api/calendar/listings/' + encodeURIComponent(input.listingId), payload);
        return send(200, { ok: true, listingId: input.listingId, ...payload });
      }
      throw fail(404, 'Agent action not found.');
    } catch (error) { return send(error.status || 502, { ok: false, error: error.status ? error.message : 'Guesty request failed; no automatic retry was made.' }); }
  };
}
module.exports = { createAgentApi, snapshot, authorized };
