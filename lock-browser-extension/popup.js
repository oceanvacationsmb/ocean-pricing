const $ = id => document.getElementById(id);
async function load() {
  const state = await chrome.storage.local.get(['collectorKey', 'listingId', 'enabled', 'status', 'lastSuccess', 'allLocks']);
  $('key').value = state.collectorKey || '';
  $('listing').value = state.listingId || '68db1a47ccc0790022ab80c6';
  $('enabled').checked = Boolean(state.enabled);
  $('allLocks').checked = Boolean(state.allLocks);
  $('listing').disabled = Boolean(state.allLocks);
  $('status').textContent = state.status || 'Not connected.';
  $('last').textContent = state.lastSuccess ? 'Last upload: ' + new Date(state.lastSuccess).toLocaleString() : 'No successful upload yet.';
}
$('settings').addEventListener('submit', async event => {
  event.preventDefault();
  await chrome.storage.local.set({ collectorKey: $('key').value.trim(), listingId: $('listing').value.trim(), enabled: $('enabled').checked, allLocks: $('allLocks').checked });
  $('status').textContent = 'Settings saved.';
});
$('refresh').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ type: 'refresh' });
  await load();
});
load();
$('allLocks').addEventListener('change', () => { $('listing').disabled = $('allLocks').checked; });
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.status) $('status').textContent = changes.status.newValue || 'Not connected.';
  if (changes.lastSuccess) $('last').textContent = 'Last upload: ' + new Date(changes.lastSuccess.newValue).toLocaleString();
});
