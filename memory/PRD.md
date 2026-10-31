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

## Backlog
- P0: permanent hosting. MATBAKH_DATABASE_URL points at localhost, so it is not an external DB yet. Needs a real cloud MySQL (e.g. TiDB) plus hosting for the Node server. Then rebuild the APK with the permanent URL.
- P1: push test button in the site UI; Expo receipts cleanup.
- P2: migrate history from www.matbakh.click; owner's future feature ideas.
