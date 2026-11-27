# Backend-hosted staff calendar

Open `/staff-calendar/` on the Ocean Pricing service. Existing dashboard authentication protects the page, its assets, and session-based read-only lock access. Unauthenticated visitors are returned here after signing into the normal dashboard login. There is no calendar key prompt, stored browser key, or embedded secret.

The extension still uploads health data using EXTENSION_KEY. Existing CALENDAR_KEY access remains available for the older GitHub-hosted calendar. Sessions use the existing Secure, HttpOnly, SameSite=Strict cookie and expire after 12 hours or a service restart; no changes were made to session lifetime or credential persistence.

Calendar layout, task endpoints, settings, and gap controls were copied from shared-calendar commit a764e6a without changing task/pricing behavior. Lock reads use same-origin `/api/lock-feed` and the signed-in session. Source files here are a hosted copy; future calendar layout updates must be synchronized explicitly. The old GitHub calendar is not redirected or removed.
