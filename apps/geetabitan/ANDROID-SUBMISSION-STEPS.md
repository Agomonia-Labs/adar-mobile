# আদর সুর সংকলন (ADAR Sur Sankalan) — Android / Google Play First Submission

This is a **first submission** — nothing has ever shipped on Android for
this app, so there's no legacy name or install base to carry. It launches
directly as "আদর সুর সংকলন," covering all five composers (Rabindra Sangeet,
Nazrul Geeti, Rajanikanta Sangeet, Atulprasad Sangeet, Dwijendra Sangeet)
from day one.

> ⚠️ **This doc replaces the old `ANDROID-SUBMISSION-STEPS.md`**, which was
> written when the app was still "ADAR Sursangam" and only had two
> composers. That doc's branding, composer list, and privacy URL
> (`sursangam-privacy`, now `sursankalan-privacy`) were stale.

## Already done for you this session

- Re-ran `npx expo prebuild --platform android` (no `--clean` — the
  Mac blocks plain `rm` inside your connected folder, and a clean wipe
  needs that first, but prebuild without `--clean` still re-synced
  everything from the current `app.json`/`assets/*`):
  - `android/app/build.gradle`'s `versionName` was stale at `"1.1.0"`;
    now matches the current `"1.2.0"` (same version you just bumped for
    the iOS "Pre-Release Train" fix).
  - The Android launcher icon (`mipmap-*/ic_launcher*.png`, adaptive icon)
    was stale too — still had old artwork from before the Nov 3 "আদর সুর
    সংকলন" icon update. Regenerated from the current `assets/icon.png` /
    `assets/adaptive-icon.png` — verified visually, now shows the correct
    tree/ektara mark with "আদর সুর সংকলন".
- `android/` stays intentionally **not committed to git** (root
  `.gitignore`'s `android/` rule) — disposable, regenerable any time via
  `npx expo prebuild --platform android`.

## 🚫 Critical blocker — read this before building

**Google Play will not accept this build as-is.** Two hard requirements
are currently unmet by this project's Expo/React Native version:

1. **Target API level 36 (Android 16) is mandatory for every new app and
   every update, effective 31 August 2026** (extension window ran to
   1 November 2026 — already passed). [Google's own requirements
   page](https://support.google.com/googleplay/android-developer/answer/11926878)
   is explicit that new apps get no grace period. This project's
   `android/build.gradle` defaults to **API 34** (`compileSdkVersion`/
   `targetSdkVersion` both 34), inherited from Expo SDK ~51 (mid-2024).
2. **16 KB memory page size support** for native libraries is also now
   required for apps shipping native `.so` code (which this app does,
   via Hermes/RN's native modules) — needs NDK r27+. This project pins
   **NDK 26.1.10909125** (r26), too old.

Both of these trace back to the same root cause: **this app is pinned to
Expo SDK ~51.0.0 / React Native 0.74.5**, which bundles **Android Gradle
Plugin 8.2.1** — a toolchain from before API 36 existed. Bumping
`compileSdkVersion`/`targetSdkVersion` by hand (e.g. via the
`expo-build-properties` plugin, already a dependency in this monorepo)
will likely **not** build cleanly on this stack: AGP 8.2.1 predates
reliable API 36 support, and the bundled NDK can't satisfy the 16 KB
requirement either.

**The real fix is upgrading Expo SDK** — Expo is now at SDK 58 (this
project is 7 major versions behind), and a current SDK brings API 36 +
16 KB support by default. That's a genuine migration project (breaking
changes across RN/Expo APIs, worth testing both iOS and Android after),
not a one-line config change — and since `apps/geetabitan` is shared
between iOS and Android, it would touch the app you're actively
submitting to the App Store right now too. I did **not** start this
upgrade — it needs a deliberate go/no-go from you given the size and the
risk to the in-flight iOS submission.

**Everything below this point — Play Console setup, listing content,
build/submit commands — is accurate and ready regardless of when the SDK
upgrade happens.** You can do the one-time manual Play Console setup
(step 0) any time; the `eas build` in step 1 is what will fail on target
API level until the SDK is upgraded.

---

## 0. One-time manual setup (web UI — can't be scripted)

**a) Create the Play Console app listing:**
play.google.com/console → Create app
- App name: `আদর সুর সংকলন` (or `ADAR Sur Sankalan` — your call; see note
  on listing language below)
- Default language: Bengali (বাংলা) or English — the app itself is
  Bangla-first, same choice you made for the App Store listing
- App or game: **App**, Free
- Package name gets set automatically from your first upload
  (`com.agomoniai.adargeetabitan` — same as iOS's bundle ID pattern, and
  what the API backend already expects)
- Declarations: you'll confirm Play's Developer Program Policies and
  US export laws checkboxes — standard, nothing app-specific here

**b) Create a Google Play Android Developer service account** (lets `eas
submit` upload automatically instead of manual console uploads):
Play Console → Setup → API access → **Create new service account**
(links out to Google Cloud Console) → create a key → download the JSON →
back in Play Console, grant that service account at least **"Release
manager"** access to this app.

Save it as:
```bash
cp ~/Downloads/<downloaded-key>.json \
  ~/project/adar-mobile/apps/geetabitan/play-store-service-account.json
```
`eas.json` already points `submit.production.android.serviceAccountKeyPath`
at this exact filename — don't rename it. This path is already excluded
from git via the repo root `.gitignore`, so the key stays local. (I
checked — this file does not exist yet; this step is still pending.)

**c) Log in to EAS** (skip if already logged in from the iOS work):
```bash
cd ~/project/adar-mobile
npx eas login
```

---

## 1. Resolve the target-API/16KB blocker (see above)

Decide how you want to handle the Expo SDK upgrade before running a real
build — a build targeting API 34 will be rejected on upload regardless of
how far you get in the steps below.

## 2. Build the release bundle via EAS

```bash
cd ~/project/adar-mobile/apps/geetabitan
npx eas build --platform android --profile production
```
Uploads the project to Expo's build servers and produces an `.aab`
(Android App Bundle) — `eas.json`'s `production` profile is already set to
`buildType: "app-bundle"`, which Play Console requires for new apps. EAS
will auto-generate and manage a signing keystore on first build (via
Google Play App Signing) since none exists yet in this project — just
confirm when prompted. Takes several minutes; EAS prints a build URL to
watch and a download link when done.

## 3. Submit to Play Console

```bash
npx eas submit --platform android --profile production --latest
```
Uses `play-store-service-account.json` from step 0b to upload the `.aab`
to Play Console's **internal testing** track (`eas.json`'s
`submit.production.android.track: "internal"`). Promote to closed/open
testing, then production, from the Play Console UI once you've
smoke-tested it — Play doesn't gate every track promotion behind a
full review the way Apple does, but the first production release does
go through one.

## 4. Fill in the Play Console listing (web UI — reference values)

On the app's **Store presence → Main store listing** page:

- **App name**: `আদর সুর সংকলন`
- **Short description** (80 chars max):
  `Explore 5 legendary Bangla composers by voice. Search songs, meanings, free.`
  (76 chars)
- **Full description** (4000 chars max) — mirrors the App Store
  description already drafted for all 5 composers:

  > আদর সুর সংকলন — your AI companion for Bengali music.
  >
  > Explore the timeless songs of five legendary Bengali composers —
  > Rabindra Sangeet, Nazrul Geeti, Rajanikanta Sangeet, Atulprasad
  > Sangeet, and Dwijendra Sangeet — through natural conversation, in
  > Bengali or English.
  >
  > Just ask, by typing or by voice:
  > • Find a song by its opening line, raag, taal, or paryay
  >   (theme/category)
  > • Understand the meaning and context behind the lyrics
  > • Discover songs about the seasons, devotion, patriotism, love, and
  >   more
  > • Listen to full lyrics read aloud in natural Bengali voice
  >
  > Whether you're a longtime listener of Tagore's songs, rediscovering
  > Nazrul's fiery verses, or exploring Rajanikanta, Atulprasad, and
  > Dwijendralal's compositions for the first time, আদর সুর সংকলন brings
  > this rich musical heritage to your fingertips — searchable,
  > explained, and spoken aloud.
  >
  > Free to download and use.

- **App icon**: needs a 512×512 PNG — export/scale down from
  `assets/icon.png` (currently 1024×1024)
- **Feature graphic** (1024×500): **doesn't exist yet** — needs its own
  design pass, separate from the app icon. Play Console requires this for
  every listing; there's no equivalent requirement on the App Store side,
  so this wasn't needed before.
- **Screenshots**: at least 2 phone screenshots required — capture from
  an emulator or a physical device running the EAS build once step 2
  succeeds (chat view, voice recording in progress, a search result for
  one of the 5 composers)
- **Category**: Music & Audio
- **Privacy Policy URL**: `https://labs.agomoniai.com/sursankalan-privacy`
  (same corrected URL now used for iOS — confirmed this page exists and
  is live on `adar-web`)
- **Data safety form**: declare Audio data (voice recordings) and User
  content (chat text) collected, purpose "App functionality," not shared
  with third parties for ads — matches the iOS App Privacy answers
  already on file
- **Content rating questionnaire**: expect "Everyone"/"PEGI 3" — no
  mature content, same as iOS's age rating

Once internal testing passes, use **Publishing overview** to promote
through testing tracks to production at your own pace.

---

## Note: Play Store has no separate "Keywords" field

Unlike App Store Connect, Google Play discoverability comes from your
title + short + full description text (Play's algorithm indexes those
directly) — there's no dedicated keywords field to fill in. The composer
names and feature words already woven into the description above (রাগ,
তাল, পর্যায়, গানের অর্থ, and all 5 composer names) are doing that job.
