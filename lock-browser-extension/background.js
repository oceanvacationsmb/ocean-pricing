const endpoint = 'https://ocean-pricing.onrender.com/api/lock-feed';
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('refresh-locks', { periodInMinutes: 15 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('refresh-locks', { periodInMinutes: 15 }));
async function refresh() {
  const { enabled } = await chrome.storage.local.get('enabled');
  if (!enabled) return;
  const tabs = await chrome.tabs.query({ url: 'https://app.guesty.com/integrations/guesty-locks-manager/locks/linked*' });
  if (!tabs.length) {
    await chrome.storage.local.set({ status: 'Open Guesty Locks Manager and sign in. Last readings were kept.' });
    return;
  }
  await chrome.storage.local.set({ status: 'Refreshing Guesty. If no new collection appears, check whether Guesty requires sign-in.' });
  await chrome.tabs.reload(tabs[0].id);
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'refresh-locks') refresh().catch(() => {}); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    if (message.type === 'refresh' && !sender.tab) { await refresh(); return { ok: true }; }
    if (message.type !== 'readings' || !sender.tab || new URL(sender.url).origin !== 'https://app.guesty.com') return { ok: false };
    const { enabled, collectorKey, listingId } = await chrome.storage.local.get(['enabled', 'collectorKey', 'listingId']);
    if (!enabled) return { ok: false };
    if (!Array.isArray(message.locks) || !message.locks.length || message.locks.length > 200) throw Error('Invalid collection.');
    const rows = listingId ? message.locks.filter(lock => lock.listingId === listingId) : message.locks;
    if (!rows.length) throw Error('Test property was not found. Previous readings were kept.');
    const locks = rows.map(lock => {
      if (typeof lock.listingId !== 'string' || ![true, false, null].includes(lock.online) || (lock.batteryPercent !== null && (typeof lock.batteryPercent !== 'number' || !Number.isFinite(lock.batteryPercent) || lock.batteryPercent < 0 || lock.batteryPercent > 100))) throw Error('Invalid lock values.');
      return { listingId: lock.listingId, batteryPercent: lock.batteryPercent, online: lock.online };
    });
    if (!collectorKey) throw Error('Save the lock-only upload key first.');
    const response = await fetch(endpoint, {
      method: 'POST', headers: { Authorization: 'Bearer ' + collectorKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ complete: true, capturedAt: message.capturedAt, locks }), signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) throw Error('Upload failed (HTTP ' + response.status + '). Previous server readings were kept.');
    await chrome.storage.local.set({ status: 'Uploaded ' + locks.length + ' lock reading(s).', lastSuccess: new Date().toISOString() });
    await chrome.action.setBadgeText({ text: 'OK' });
    return { ok: true };
  })().then(reply).catch(async error => {
    await chrome.storage.local.set({ status: error.message });
    await chrome.action.setBadgeText({ text: '!' });
    reply({ ok: false });
  });
  return true;
});
