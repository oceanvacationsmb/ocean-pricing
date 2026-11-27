(() => {
  const isLocks = value => {
    try {
      const url = new URL(value, location.href);
      return url.origin === 'https://app.guesty.com' && url.pathname === '/api/sl-service/locks' && url.searchParams.get('linked') === 'true';
    } catch { return false; }
  };
  const emit = data => {
    if (!Array.isArray(data?.data) || data.cursor?.hasMore !== false || !data.data.length) return;
    const locks = data.data.flatMap(lock => {
      const level = lock.batteryLevel;
      const batteryPercent = typeof level === 'number' && Number.isFinite(level) && level >= 0 && level <= 1 ? Math.round(level * 100) : null;
      return Array.isArray(lock.listings) ? lock.listings.map(listing => ({
        listingId: listing.id || listing._id,
        batteryPercent,
        online: typeof lock.online === 'boolean' ? lock.online : null
      })) : [];
    });
    if (locks.length !== data.data.length || locks.some(lock => typeof lock.listingId !== 'string') || new Set(locks.map(lock => lock.listingId)).size !== locks.length) return;
    window.postMessage({ type: 'OV_LOCK_HEALTH_V1', capturedAt: new Date().toISOString(), locks }, location.origin);
  };
  // Observe responses only. Never inspect request headers, credentials, or codes.
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    const response = await Reflect.apply(originalFetch, this, args);
    if (response.ok && isLocks(args[0] instanceof Request ? args[0].url : args[0])) response.clone().json().then(emit).catch(() => {});
    return response;
  };
  const open = XMLHttpRequest.prototype.open;
  const urls = new WeakMap();
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    urls.set(this, method.toUpperCase() === 'GET' && isLocks(url));
    return Reflect.apply(open, this, [method, url, ...rest]);
  };
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    if (urls.get(this)) this.addEventListener('load', () => {
      if (this.status !== 200) return;
      try { emit(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch {}
    }, { once: true });
    return Reflect.apply(send, this, args);
  };
})();
