(() => {
  if (window !== window.top) return;
  let lastRefresh = 0;
  window.addEventListener('message', async event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.type !== 'OV_REQUEST_LOCK_REFRESH' || typeof data.requestId !== 'string') return;
    if (Date.now() - lastRefresh < 10000) return;
    lastRefresh = Date.now();
    let result;
    try { result = await chrome.runtime.sendMessage({ type: 'refresh' }); }
    catch { result = { ok: false, error: 'Reload the Lock Reader extension and calendar tab.' }; }
    window.postMessage({ type: 'OV_LOCK_REFRESH_ACK', requestId: data.requestId, ok: result?.ok === true,
      error: result?.error || 'The browser collector could not start.' }, location.origin);
  });
})();
