# ADAR Sursangam (Android) — First Submission, All Commands

This is a **first submission** — unlike iOS, nothing has shipped on Android
yet, so there's no legacy "Geetabitan" name or install base to carry. It
launches directly as "ADAR Sursangam," covering both Rabindra Sangeet and
Nazrul Geeti from day one.

Already done for you this session (verified on your Mac):
- `android/` scaffolded via `npx expo prebuild --platform android` from the
  current `app.json` — `applicationId 'com.agomoniai.adargeetabitan'`
  (same package as the API backend expects), `versionCode 1`,
  `versionName "1.1.0"` (matches the iOS marketing version so both
  platforms stay in step going forward).
- App name, icon (`ic_launcher`/`ic_launcher_round`/adaptive icon), and
  splash/icon background color (`#8B1A1A`) all generated from the same
  `app.json` + `assets/icon.png` + `assets/adaptive-icon.png` used for
  iOS — confirmed the adaptive icon composites correctly with the
  "সুরসঙ্গম" wordmark.
- `android/` is intentionally **not** committed to git — the root
  `.gitignore`'s `android/` rule covers it, same as every other app in
  this monorepo (arcl, docintel). It's a disposable, regenerable build
  artifact; re-run `npx expo prebuild --platform android` any time you
  need to pick up an `app.json` change.
- No local Android SDK is set up in my sandbox, and this monorepo's other
  apps (see their `build-*.apk` files under `apps/arcl/`) were built via
  **EAS Build** (Expo's cloud build service), not local Gradle — so Android
  builds for this app should go the same route. The commands below assume
  that.

---

## 0. One-time manual setup (web UI — can't be scripted)

**a) Create the Play Console app listing:**
play.google.com/console → Create app
- App name: `ADAR Sursangam`
- Default language: Bengali (বাংলা) or English, your call — the app itself
  is Bangla-first
- App or game: App: Free
- Package name gets set automatically from your first upload
  (`com.agomoniai.adargeetabitan`)

**b) Create a Google Play Android Developer service account** (used by
`eas submit` instead of manual console uploads):
Play Console → Setup → API access → **Create new service account** (links
out to Google Cloud Console) → create a key → download the JSON → grant it
at least "Release manager" access to this app in Play Console.

Save it as:
```bash
cp ~/Downloads/<downloaded-key>.json \
  ~/project/adar-mobile/apps/geetabitan/play-store-service-account.json
```
`eas.json` already points `submit.production.android.serviceAccountKeyPath`
at this exact filename — don't rename it. The repo root `.gitignore`
already excludes `play-store-service-account.json` everywhere, so this
stays out of git automatically.

**c) Log in to EAS** (skip if already logged in from another app in this
monorepo):
```bash
cd ~/project/adar-mobile
npx eas login
```

---

## 1. Build the release bundle via EAS

```bash
cd ~/project/adar-mobile/apps/geetabitan
npx eas build --platform android --profile production
```
This uploads your project to Expo's build servers and produces an
`.aab` (Android App Bundle) — `eas.json`'s `production` profile is already
set to `buildType: "app-bundle"`, which is what Play Console requires for
new apps. Takes several minutes; EAS prints a build URL you can watch, and
a download link when it finishes.

## 2. Submit to Play Console

```bash
npx eas submit --platform android --profile production --latest
```
Uses `play-store-service-account.json` from step 0b to upload the `.aab`
straight to Play Console's **internal testing** track (`eas.json`'s
`submit.production.android.track: "internal"`). Promote it to a higher
track (closed/open testing, then production) from the Play Console UI once
you've smoke-tested it.

## 3. Fill in the Play Console listing (web UI — reference values)

On the app's **Store presence → Main store listing** page:
- **App name**: `ADAR Sursangam`
- **Short description** (80 chars max): "Explore Rabindra Sangeet and
  Nazrul Geeti in Bangla, by text or voice."
- **Full description**: expand on song/raag/taal/paryay search, voice
  conversation, no account needed — mirror `adar-web/sursangam.html`'s
  copy, mentioning both Tagore and Nazrul Islam
- **App icon**: `assets/icon.png` (512×512 required — scale up or re-export
  from the 1024×1024 source)
- **Feature graphic** (1024×500): doesn't exist yet — needs its own design
  pass, separate from the app icon
- **Screenshots**: at least 2, phone size, from an emulator or your device
  running the EAS build — show chat, voice recording, a Nazrul Geeti
  example
- **Category**: Music & Audio
- **Privacy Policy URL**: `https://labs.agomoniai.com/sursangam-privacy`
  (same page as iOS — deploy `adar-web` first if you haven't, see its own
  deploy step)
- **Data safety form**: declare Audio data (voice recordings) and User
  content (chat text) collected, purpose "App functionality," not shared
  with third parties for ads, matching the iOS App Privacy answers already
  on file for the iOS app
- **Content rating questionnaire**: expect "Everyone"/"PEGI 3" — no
  mature content

Once internal testing passes, use **Publishing overview** to promote
through testing tracks to production at your own pace — Play Console
doesn't require an App-Review-style submit-and-wait the way Apple does for
subsequent track promotions, but the first production release does go
through a review.
