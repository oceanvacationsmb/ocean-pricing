# Ocean Vacations lock reader: one-property pilot

## All-lock rollout (0.2.0)

After verifying the pilot, change Render `LOCK_EXPECTED_LISTING_IDS` to `all`. The server requires at least 26 unique known properties (override with `LOCK_EXPECTED_COUNT` only after verifying inventory) and rejects collections missing previously seen properties. Reload this unpacked extension, enable All linked locks, Save, and Refresh now. Existing upload/view keys remain unchanged. Automatic collection continues every 15 minutes while the signed-in Guesty tab and Chrome are open. Removal of a linked property requires an intentional server configuration/restart; incomplete refreshes do not erase last good readings.

This extension observes successful lock-list responses in your signed-in Guesty tab. It never reads Authorization headers, cookies, passwords, or access codes. It forwards only listing ID, battery percentage, device online status, and collection time. No lock or Guesty write operation is implemented.

## Server setup (required before installation testing)

Deploy the accompanying ocean-pricing server change, then add these variables to that Render service:

- `LOCK_COLLECTOR_KEY`: a new random secret used only for lock uploads. Do not reuse a Guesty token, dashboard password, or Dot write key.
- `LOCK_VIEW_KEY`: a DIFFERENT random secret for staff to read the lock feed.
- `LOCK_EXPECTED_LISTING_IDS`: `68db1a47ccc0790022ab80c6` for the 113B-13N pilot.
- `CALENDAR_ORIGIN`: `https://oceanvacationsmb.github.io` (keep any other existing required origins, comma separated).

Generate each secret separately in PowerShell: `[Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(32))`. Enter secrets directly into Render and the extension/calendar, never source files or chat.

The dedicated `/api/lock-feed` endpoint uses separate upload and viewing credentials. It does not call Guesty, change prices/tasks/codes, or publish readings to GitHub. Readings are held in server memory for this pilot. A server restart clears them until the next successful collection; the calendar retains its last displayed reading in memory and marks failed refreshes stale. Multiple Render instances are not supported in this pilot.

## Install in Chrome

1. Open `chrome://extensions`, enable Developer mode, click Load unpacked, and select this folder.
2. Open the extension popup. Enter `LOCK_COLLECTOR_KEY`, keep the prefilled test listing ID, enable collection, and Save.
3. Open Guesty Locks Manager and sign in normally. Click Refresh now in the popup.
4. Check that the popup reports one successful upload. If Guesty redirected to login, sign in, reopen Locks Manager, and refresh again.
5. Deploy the calendar changes. Click Staff lock access and enter `LOCK_VIEW_KEY`. Compare 113B-13N against Guesty. This is the latest Guesty response, not a direct poll of the physical lock.

When enabled, the extension reloads one open Locks Manager tab every 15 minutes. Leave a dedicated Guesty lock tab open; reloading may interrupt use of that tab. It does not open tabs or bypass login/MFA. Chrome must be running and the computer awake. There is no guaranteed weekly sign-in schedule: Guesty decides session expiry. Popup timestamps indicate successful uploads, not merely successful page loads.

Disable collection in the popup or remove the extension to stop it. Rotate the upload key in Render if the browser profile is lost. Keys are stored in Chrome local extension storage, NOT synced, restricted to trusted extension contexts. A person with access to the unlocked browser profile may retrieve them. Calendar staff keys are memory-only and must be entered again after reload. This is shared-key access, not individual staff accounts.

The shared calendar no longer downloads the public GitHub snapshot in this version. Old previously published snapshots are not removed from Git history by this change. No all-lock rollout until the pilot is verified. To expand later, explicitly set the server expected-ID list and update extension filtering; never infer a missing lock is offline.
