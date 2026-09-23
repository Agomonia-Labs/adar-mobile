# ADAR Mobile

Three React Native (Expo) apps — one per ADAR product, each talking to
its own `adar-core` deployment — sharing a single auth screen
implementation (`packages/shared-auth`).

```
adar-mobile/
├── packages/
│   └── shared-auth/       ← login + email-OTP MFA screens, API client, secure token storage
└── apps/
    ├── arcl/               ← ADAR ARCL   → https://api.arcl.tigers.agomoniai.com
    ├── geetabitan/          ← ADAR Geetabitan → https://api.geetabitan.adar.agomoniai.com
    └── frontdesk/           ← ADAR Front Desk → https://api.scheduling.adar.agomoniai.com
```

## Why this shape

`adar-core` is deployed as three separate backends (one per `DOMAIN`
env value: `arcl`, `geetabitan`, `scheduling`), each with its own
Firestore data, Stripe config, and users. The three apps mirror that:
separate App Store / Play listings, separate bundle IDs, separate
backend, but **one** auth implementation so the login + MFA flow only
has to be built and fixed once.

The auth contract in `packages/shared-auth` is a direct port of
`adar-core/ui/src/Login.jsx` (the real, working web login) — same
endpoints, same request/response shapes, same field names:

- `POST /api/auth/login` — email + password. Returns either
  `{ mfa_required: true, mfa_token, email_hint }` or a full session.
- `POST /api/auth/verify-otp` — `{ mfa_token, otp }` → full session
  (`access_token`, `team_id`, `team_name`, `role`, `status`, `practice_id?`).
- `POST /api/auth/resend-otp` — `{ mfa_token }`.
- `POST /api/auth/forgot-password` — `{ email }`.

The JWT (`access_token`) and session fields are stored with
`expo-secure-store` under the same key names the web app uses in
`localStorage` (`adar_token`, `adar_team_id`, etc.) — see
`packages/shared-auth/src/storage.ts`.

## Getting started

```bash
npm install          # installs and links all three apps + shared-auth via npm workspaces
npm run arcl          # or: npm run geetabitan / npm run frontdesk
```

Each command runs `expo start` for that app; scan the QR code with
Expo Go, or press `i` / `a` for a simulator.

## Before this ships to TestFlight / Play

1. **App icons & splash images** — `app.json` in each app references
   brand colors only; add `assets/icon.png` (1024×1024) and a splash
   image per app, then wire them into `app.json`'s `icon` /
   `splash.image` fields. The wicket-and-ball mark from `adar-web`
   (`arcl.js` / the SVG badge) is a natural starting point for ARCL's icon.
2. **API keys** — ARCL's production deployment expects an
   `X-API-Key` header (see `adar-core/ui/.env.production`). Each app
   reads its key from an env var at build time
   (`EXPO_PUBLIC_ARCL_API_KEY`, etc.) rather than hardcoding it — set
   these via `eas secret` or a `.env` file, never commit real keys.
3. **Reviewer accounts** — `adar-core`'s `MFA_BYPASS_EMAILS` env var
   (comma-separated allowlist) already exists for skipping OTP. Add an
   App Store / Play reviewer email to each deployment's allowlist so
   automated review doesn't get stuck waiting on an email code.
4. **Real product screens** — `src/HomeScreen.tsx` in each app is a
   placeholder that only proves the auth round-trip works. Replace it
   with the actual product UI (ARCL's assistant chat, Geetabitan's
   assistant, Front Desk's scheduling views).
5. **Navigation** — no router is wired in yet (deliberately, to keep
   the auth scaffold minimal). Add `@react-navigation/native` once
   there's more than one post-login screen per app.
6. **Expo/RN versions** — the versions pinned in each `package.json`
   were current as of this scaffold. Run `npx expo install --fix` in
   each app before your first real build to align them to whatever
   Expo SDK is current then.
7. **Apple / Google accounts** — Apple Developer Program ($99/yr,
   needs a D-U-N-S number + company website for an org account) and a
   Google Play Console account ($25 one-time; new personal accounts
   need ~12 testers for 14 days of closed testing before going to
   production).

## Adding a screen that needs the session

```tsx
import { useAuth } from '@adar/shared-auth';

function SomeScreen() {
  const { session, client, signOut } = useAuth();
  // `client` is a pre-configured axios instance (baseURL + API key already set).
  // Attach the bearer token yourself for authenticated calls:
  //   client.get('/api/whatever', { headers: { Authorization: `Bearer ${session.accessToken}` } })
}
```
