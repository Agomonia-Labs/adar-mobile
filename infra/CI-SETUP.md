# adar-mobile CI/CD setup

Self-hosted Android builds (on a GCP VM in `bdas-493785`) + cloud iOS builds
(via EAS, since GCE can't run Xcode) for all three apps: `arcl`,
`geetabitan`, `frontdesk`.

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

## 2. Create the CI VM

```bash
cd adar-mobile/infra
./create-ci-vm.sh
```

This provisions `adar-mobile-ci` in `bdas-493785` (us-central1-a) with
Node 20, Java 17, the Android SDK, and `eas-cli` — see `startup-ci-vm.sh`
for exactly what it installs. Takes ~5-10 minutes after the VM boots.

## 3. On the VM: clone and build Android

```bash
gcloud compute ssh adar-mobile-ci --project=bdas-493785 --zone=us-central1-a

git clone git@github.com:Agomonia-Labs/adar-mobile.git
cd adar-mobile
npm install

cd apps/arcl        # repeat for geetabitan, frontdesk
eas build --platform android --local --profile production
eas submit --platform android --profile production   # pushes to Play Store "internal" track
```

`--local` runs the actual build on the VM itself (no Expo cloud build
minutes spent) — that's the "self-hosted" piece.

## 4. iOS builds (cloud, run from anywhere — the VM or your Mac)

```bash
cd apps/arcl         # repeat for geetabitan, frontdesk
eas build --platform ios --profile production
eas submit --platform ios --profile production        # pushes to TestFlight
```

This runs on Expo's infrastructure since no Linux box can build iOS.

## Notes

- Android build profile currently targets `app-bundle` (.aab) for
  production, `apk` for `preview`/`development` — see each app's
  `eas.json`.
- Bump `MACHINE_TYPE` in `create-ci-vm.sh` (e2-standard-4 → e2-standard-8)
  if Gradle builds feel slow.
- Stop the VM (`gcloud compute instances stop adar-mobile-ci ...`) between
  build runs if you want to avoid idle compute cost — it's not needed
  running 24/7 for occasional builds.
