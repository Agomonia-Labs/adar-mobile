# adar-mobile build & submit setup

Builds run locally — on your own Mac, with whatever Android/iOS build
tooling you already have set up there — rather than on any cloud VM. No
GCP instance is used for this.

## One-time account setup (do this yourself — needs your own logins)

1. **Expo/EAS account.** `npm install -g eas-cli` locally, then `eas login`.
   Repeat inside each `apps/<name>` directory: `eas build:configure` — this
   creates/links an EAS project and writes a `projectId` into that app's
   `app.json` under `extra.eas`. Do this once per app (3 times total).
2. **Apple Developer account** (for iOS/TestFlight): you need an active
   Apple Developer Program membership and an App Store Connect app record
   for each bundle ID already set in `app.json`
   (`com.agomoniai.adararcl`, `com.agomoniai.adargeetabitan`,
   `com.agomoniai.adarfrontdesk`). Fill in `appleId` / `ascAppId` /
   `appleTeamId` in each app's `eas.json` under `submit.production.ios`.
3. **Google Play Console service account** (for Android submission): in
   Play Console → Setup → API access, create a service account with
   "Release Manager" access, download its JSON key, and place it at
   `apps/<name>/play-store-service-account.json` (already gitignored — do
   NOT commit it). Needed once per app that you'll auto-submit.

None of this can be done from an automated script — they're your account
credentials.

## Build locally

`eas build --local` runs the real build (Gradle for Android, Xcode for
iOS) right on your own machine, using whatever toolchain is already
installed there — no cloud build minutes, no separate VM.

```bash
cd apps/arcl         # repeat for geetabitan, frontdesk

eas build --platform android --local --profile production
eas build --platform ios --local --profile production
```

If a platform's local toolchain isn't already set up on your Mac
(Android SDK/Java for Android, Xcode/CocoaPods for iOS), `eas build
--local` will fail with a clear message naming what's missing — install
just that piece rather than provisioning a whole new environment.

## Submit

```bash
cd apps/arcl         # repeat for geetabitan, frontdesk

eas submit --platform android --profile production   # → Play Store "internal" track
eas submit --platform ios --profile production        # → TestFlight
```

## Notes

- Android build profile targets `app-bundle` (.aab) for production, `apk`
  for `preview`/`development` — see each app's `eas.json`.
- Repeat the build/submit commands for each of the three apps
  (`arcl`, `geetabitan`, `frontdesk`) — they're independent Expo projects
  under one monorepo, each with its own `eas.json`.
