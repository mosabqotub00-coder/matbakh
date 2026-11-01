# مطبخي (Matbakh) — PRD

## Original problem
Analyze the uploaded files, run the site, fix any errors, and keep the site exactly as it is. Added later: phone app notifications that keep working in the background after leaving the app. Then: build an installable Android app with notifications that arrive while it is closed.

## Architecture (as run here)
- /app/matbakh: original site (React/Vite + Express/tRPC, pnpm). Built with `pnpm build` and served by `node dist/index.js` on :3000. Started by /app/scripts/matbakh-start.sh, which is the frontend supervisor `yarn start` and also boots MariaDB.
- /app/backend/server.py: thin FastAPI proxy /api/* → 127.0.0.1:3000 (MATBAKH_UPSTREAM_URL).
- DB: local MariaDB 10.11, data in /app/.mysql-data, db `matbakh` (snapshot of 2026-10-30 + migration 0008 native_push_devices).
- /app/matbakh-mobile: Expo app (WebView shell). EAS project @mosabqotub00/matbakh (id b9def632-…). Package com.matbakh.app. Firebase project matbakh-6b694, FCM V1 key uploaded to EAS.

## Implemented (2026-10-31)
- Site runs unchanged; login without reload fixed (AuthViews onSuccess cache bug); trust proxy so the login rate limit works per client IP.
- Reset all 37 passwords (same ids/usernames) to temporary ones → /app/matbakh-private/staff-passwords.csv. The owner has already changed the manager password.
- Native push: nativePush tRPC router (status/register/unregister/acknowledge/test). Sends through the Expo push API with high priority on channel matbakh-orders-v1. Delivery runs on every emitNotification and is bound to a live staff session.
- Website posts MATBAKH_AUTH_CHANGED to the WebView (NativeAppBridge).
- Mobile: configurable site URL (EXPO_PUBLIC_MATBAKH_URL), fixed pnpm hoisting (.npmrc node-linker=hoisted, react-native-css-interop), and built the APK (preview profile).
- APK: https://expo.dev/artifacts/eas/WWVGPk_RNmh-8NSMNqHAOpnJjsKcSghJdiZFMJJkny8.apk

## 2026-11-01 — Standalone auth (Manus OAuth removed)
- Removed Manus OAuth/SDK/forge modules, /api/oauth/callback, /api/platform/config.js, Manus vite plugins, the jose dependency, and the Manus `users` login path. Unknown /api/* now returns 404 JSON.
- staff_users gains `email` (nullable unique) and `approval_status` (approved|pending), added by migration 0009. Existing 38 accounts stay approved and unchanged.
- Login accepts a username or an email. Email signup creates a pending account; a system admin approves it (role + branch) or rejects it in الإدارة العامة → طلبات التسجيل.
- Staff can link an optional email (with their current password) on /notifications. First admin: `node scripts/promote-admin.mjs <email>` on the server.
- Cookies are HttpOnly + Secure, SameSite from COOKIE_SAME_SITE (default lax; preview uses none).
- Verified in a clean-room VPS-style run (fresh copy, empty DB, migrate, bootstrap, signup, promote). Testing agent iteration 2 passed everything.

- 2026-11-01: owner asked to drop self-signup. Removed the signup API/UI and the approvals tab; accounts are created by admins/branch managers as before. Added owner admin account `admin`.

- 2026-11-01 (b): An order is late as soon as its prep time runs out (no grace wait) — server deadlinePhase, ready/extend everOverdue, client isOverdue. Station archive shows a كان متأخرًا badge. Ready column is now ordered last on mobile. The developer-note button shows its label on mobile. Developer nav shows all pages.
- New /reports page (system_admin + developer): reports.analytics with filters for period, branch and shift (morning/evening, taken from the creator usualShift or the hour). KPIs, recharts charts, branch/product/order tables, PDF via print, CSV export.
- APK 1.0.1 (versionCode 2) points to https://www.matbakh.click. Download links are served by FastAPI /api/dl/<name> from /app/downloads (gitignored).

## Backlog
- P0: permanent hosting. MATBAKH_DATABASE_URL points at localhost, so it is not an external DB yet. Needs a real cloud MySQL (e.g. TiDB) plus hosting for the Node server. Then rebuild the APK with the permanent URL.
- P1: push test button in the site UI; Expo receipts cleanup.
- P2: migrate history from www.matbakh.click; owner's future feature ideas.
