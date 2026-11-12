# Ocean Pricing

A local pricing calendar for comparing saved Guesty accommodation rates with selected Airbnb competitors using AirROI. Guesty rate updates are disabled.

## Run

Install Node.js 20 or newer, then double-click **Start.cmd**. There are no package dependencies to install. The app opens at http://127.0.0.1:8772/ and runs on your computer only.

## Use

- Enter Guesty Open API credentials and an AirROI key in **Connections**. Keys remain in process memory and must be re-entered after restarting the service.
- **Import Guesty** reads active listing metadata. The import allows studios and 1, 3, 4, 5, or 6 bedrooms, with a specific two-bedroom exception for 204-2D.
- In **Settings**, select properties, drag them into your preferred order, and assign up to five comps per property. Property gear icons open the relevant comp settings.
- Link similar properties to a master to reuse its assignments and saved results. Followers have no separate comp scan controls. Linking preserves previous independent assignments; unlinking restores them.
- **Refresh Guesty · 12 months** requests and saves rates, availability and minimum stays from today through the same date next year. The refresh icon in a property row refreshes only that property's Guesty calendar. Requests are spaced and do not automatically retry failures. Guesty's own limits still apply.
- Saved Guesty rates display in the overview. Click a property to work in a focused comparison view; **All properties** returns to the overview.
- **COMP RATES** lets you choose a property and all its comps or one comp. The estimated cost appears automatically. Clicking Scan requests fresh full calendars, with rates, minimum stays, cleaning fees and availability. Standard AirROI pricing is estimated at $0.20 per unique listing. Listing IDs are deduplicated within each scan.
- The scan window closes when the local server accepts the job. Progress appears under the master property, while other property controls remain usable. Only one paid scan job runs at a time.
- Suggestions use the median of available comp prices, with optional single-comp comparisons. Green means INCREASE and red means DECREASE relative to your saved Guesty accommodation rate. One- or two-comp suggestions have limited supporting data. Unavailable and locked own nights are skipped. Gray prices with a marker are booked or blocked, not proof of availability.
- Airbnb titles are requested directly from the canonical listing page and cached. Airbnb may deny that request; manual names remain supported. Title lookup does not use AirROI.

## Saved data and credentials

Settings, assignments, master links, Guesty calendars, AirROI snapshots and an estimated request ledger are stored in **.local/data.json**. Existing results remain until a manually confirmed refresh replaces them. Opening, scrolling, editing settings and reading saved results do not contact Guesty or AirROI.

The Git repository excludes **.local/**, environment files, logs, node_modules and local preview screenshots. API keys are not included in repository files or data backups. This repository contains application code, not your saved account data.

The server binds to loopback only and protects local API routes with a same-site session and request header. GitHub Pages alone cannot run this app or save edits. Remote hosting requires a hosted backend, authentication, protected API credentials and persistent shared storage; this local server should not be exposed publicly as-is.

## Data limitations

AirROI rates are provider estimates, not guaranteed checkout quotes or achieved ADR. Cleaning fees are separate from nightly accommodation rates, and a short-stay fee may differ. Guesty's displayed default cleaning fee may differ from channel overrides. Missing values are not assumed to be zero. Comparison does not account for every stay-specific discount or difference between properties. No automated schedule or Guesty write operation is enabled.

## Tests

Run:

    node --test tests/core.test.cjs tests/pricing.test.cjs

Tests use simulated providers and temporary data. Browser QA fixtures also use simulated providers and must not be confused with a live scan. Real API availability, limits, account permissions and response coverage depend on your provider account.

Provider documentation: [Guesty Open API](https://open-api-docs.guesty.com/) and [AirROI](https://www.airroi.com/api/documentation).

## Render deployment

Use Node, branch main, build command `npm install`, start command `npm start`.
Attach a persistent disk to a paid service, mounted at `/var/data`.
Set `DATA_DIR=/var/data/ocean-pricing` and `ADMIN_PASSWORD` (at least 12 characters).
Render supplies `RENDER_EXTERNAL_URL` and `PORT`. If using a custom domain, set `APP_ORIGIN` to its HTTPS origin.
Use `/healthz` as the health check path. The browser login username is `admin`.
Optional secret environment variables: `GUESTY_CLIENT_ID`, `GUESTY_CLIENT_SECRET`, `AIRROI_API_KEY`.
Keys entered only in Connections still live in memory; environment variables survive restarts.
The hosted app requires authentication for both pages and API, enforces the configured host/origin, and uses a Secure session cookie.
Existing computer data is not uploaded with source code: migrate `.local/data.json` privately to the disk before using the hosted app with existing settings. Never commit this file to GitHub.
Run only one instance with this file-based store. Do not deploy with ephemeral storage for real saved data.
