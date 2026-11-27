const { snapshot, authorized } = require('./agent-api.cjs');

function createLockFeed({ store, env = process.env }) {
  let latest = null;
  return async (req, res, url) => {
    if (url.pathname !== '/api/lock-feed') return false;
    const origin = req.headers.origin;
    const allowed = (env.CALENDAR_ORIGIN || 'https://oceanvacationsmb.github.io').split(',').map(x => x.trim());
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(data));
      return true;
    };
    if (origin && !allowed.includes(origin) && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) return send(403, { error: 'Origin not allowed.' });
    if (origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
    }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      return send(204, undefined);
    }
    if (!['GET', 'POST'].includes(req.method)) return send(405, { error: 'Method not allowed.' });
    if (!authorized(req, req.method === 'POST' ? env.LOCK_COLLECTOR_KEY : env.LOCK_VIEW_KEY)) return send(401, { error: 'Lock access key not accepted.' });
    if (req.method === 'GET') return send(200, {
      ok: true, capturedAt: latest?.capturedAt || null, locks: latest?.locks || [],
      source: 'guesty-browser-collector', stale: !latest || Date.now() - Date.parse(latest.capturedAt) > 3600000,
      warning: latest ? null : 'No readings collected since the server started.'
    });
    try {
      let raw = '';
      for await (const chunk of req) {
        raw += chunk;
        if (Buffer.byteLength(raw) > 100000) return send(413, { error: 'Payload too large.' });
      }
      const input = JSON.parse(raw);
      if (input.complete !== true || !Array.isArray(input.locks) || input.locks.length > 200) return send(400, { error: 'A complete lock collection is required.' });
      if (Date.now() - Date.parse(input.capturedAt) > 300000) return send(400, { error: 'Collection is too old.' });
      const next = snapshot(input, store.data.properties);
      if (latest && Date.parse(next.capturedAt) <= Date.parse(latest.capturedAt)) return send(409, { error: 'Older readings were rejected.' });
      const expected = String(env.LOCK_EXPECTED_LISTING_IDS || '').split(',').map(x => x.trim()).filter(Boolean);
      if (!expected.length || expected.some(id => !next.locks.some(lock => lock.listingId === id)) || next.locks.some(lock => !expected.includes(lock.listingId))) return send(400, { error: 'Collection does not match the configured test properties.' });
      latest = { ...next, source: 'guesty-browser-collector' };
      return send(200, { ok: true, count: latest.locks.length, capturedAt: latest.capturedAt });
    } catch (error) {
      return send(error.status || 400, { error: error.status ? error.message : 'Invalid lock collection.' });
    }
  };
}
module.exports = { createLockFeed };
