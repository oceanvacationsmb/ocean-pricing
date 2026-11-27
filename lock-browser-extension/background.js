const endpoint = 'https://ocean-pricing.onrender.com/api/lock-feed';
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
chrome.runtime.onInstalled.addListener(() => chrome.alarms.create('refresh-locks', { periodInMinutes: 15 }));
chrome.runtime.onStartup.addListener(() => chrome.alarms.create('refresh-locks', { periodInMinutes: 15 }));
let refreshPending = null;
function refresh() {
  if (!refreshPending) refreshPending = refreshOnce().finally(() => { refreshPending = null; });
  return refreshPending;
}
async function refreshOnce() {
  const { enabled } = await chrome.storage.local.get('enabled');
  if (!enabled) {
    await chrome.storage.local.set({ status: 'Enable collection and click Save first.' });
    return { ok: false, error: 'Enable collection in Lock Reader first.' };
  }
  const tabs = await chrome.tabs.query({ url: 'https://app.guesty.com/integrations/guesty-locks-manager/locks/linked*' });
  if (!tabs.length) {
    const guestyTabs = await chrome.tabs.query({ url: 'https://app.guesty.com/*' });
    if (!guestyTabs.length) {
      await chrome.storage.local.set({ status: 'Open any Guesty page and sign in. Last readings were kept.' });
      return { ok: false, error: 'Open any Guesty page in this Chrome profile and sign in.' };
    }
    await chrome.storage.local.set({ status: 'Opening Locks Manager in a background tab. Your current Guesty page will stay unchanged.' });
    await chrome.tabs.create({ url: 'https://app.guesty.com/integrations/guesty-locks-manager/locks/linked', active: false });
    return { ok: true };
  }
  await chrome.storage.local.set({ status: 'Refreshing Guesty. If no new collection appears, check whether Guesty requires sign-in.' });
  await chrome.tabs.reload(tabs[0].id);
  return { ok: true };
}
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === 'refresh-locks') refresh().catch(() => {}); });
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  (async () => {
    const calendarSender = sender.url && /^https:\/\/oceanvacationsmb\.github\.io\/-shared_calendar-\/calendar_all\/(?:index\.html)?(?:[?#].*)?$/.test(sender.url);
    if (message.type === 'refresh' && sender.id === chrome.runtime.id && (sender.url === chrome.runtime.getURL('popup.html') || calendarSender)) return await refresh();
    if (message.type !== 'readings' || !sender.tab || new URL(sender.url).origin !== 'https://app.guesty.com') return { ok: false };
    const { enabled, collectorKey, listingId, allLocks } = await chrome.storage.local.get(['enabled', 'collectorKey', 'listingId', 'allLocks']);
    if (!enabled) return { ok: false };
    if (!Array.isArray(message.locks) || !message.locks.length || message.locks.length > 200) throw Error('Invalid collection.');
    const rows = allLocks ? message.locks : listingId ? message.locks.filter(lock => lock.listingId === listingId) : [];
    if (!rows.length) throw Error('Test property was not found. Previous readings were kept.');
    const locks = rows.map(lock => {
      if (typeof lock.listingId !== 'string' || ![true, false, null].includes(lock.online) || (lock.batteryPercent !== null && (typeof lock.batteryPercent !== 'number' || !Number.isFinite(lock.batteryPercent) || lock.batteryPercent < 0 || lock.batteryPercent > 100))) throw Error('Invalid lock values.');
      return { listingId: lock.listingId, batteryPercent: lock.batteryPercent, online: lock.online };
    });
    if (!collectorKey) throw Error('Save EXTENSION_KEY in the extension settings first.');
    const response = await fetch(endpoint, {
      method: 'POST', headers: { Authorization: 'Bearer ' + collectorKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ complete: true, capturedAt: message.capturedAt, locks }), signal: AbortSignal.timeout(45000)
    });
    if (!response.ok) {
      const details = await response.json().catch(() => ({}));
      const safeErrors = new Set([
        'Use unique known Guesty listing IDs.',
        'A complete lock collection is required.',
        'Collection is too old.',
        'Collection does not match the configured test properties.',
        'Incomplete lock collection. Previous readings were kept.',
        'Lock access key not accepted.',
        'Origin not allowed.',
        'Older readings were rejected.',
        'Battery must be between 0 and 100, or null.',
        'Connectivity must be true, false, or null.',
        'Invalid lock collection.'
      ]);
      const reason = safeErrors.has(details.error) ? ' ' + details.error : '';
      throw Error('Upload failed (HTTP ' + response.status + ', ' + locks.length + ' readings).' + reason);
    }
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
