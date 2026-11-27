window.addEventListener('message', event => {
  if (event.source !== window || event.origin !== 'https://app.guesty.com' || event.data?.type !== 'OV_LOCK_HEALTH_V1') return;
  chrome.runtime.sendMessage({ type: 'readings', capturedAt: event.data.capturedAt, locks: event.data.locks }).catch(() => {});
});
