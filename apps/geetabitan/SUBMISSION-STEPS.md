# ADAR Sur Sankalan (iOS) — Next Version Submission, All Commands

> **⚠️ Renamed again since this doc was first written.** The sections
> below originally described the Geetabitan → "ADAR Sursangam" rename.
> `app.json`'s `name` has since moved on to **"আদর সুর সংকলন" (ADAR Sur
> Sankalan)** — matching the live web branding at labs.agomoniai.com/
> sursankalan — and the app now covers **five** composers (Rabindra
> Sangeet, Nazrul Geeti, Rajanikanta Sangeet, Atulprasad Sangeet, and
> Dwijendra Sangeet), not just the first two. The reference values in
> step 8 below have been corrected to match; the narrative text
> elsewhere in this file describing the *original* Sursangam rename is
> left as-is for history, but don't copy a "Sursangam" name or the old
> `sursangam-privacy` URL into App Store Connect — use the step 8 values.
>
> `ios/` is still the project generated for the *previous* rename
> (`ios/ADARSursangam.xcworkspace`/`.xcodeproj`) — it still builds and
> uploads fine as-is (bundle ID and team are unchanged, and the on-device
> display name comes from `app.json`'s `ios.infoPlist.CFBundleDisplayName`
> override, which is already correct), so regenerating it is **not**
> required just because `name` changed again. If you do want a clean
> regenerate (step 1), know that `app.json`'s `name` is now pure Bengali
> with no ASCII characters — Expo's `prebuild` may not be able to derive
> a sane Xcode project/scheme name from it the way it did for the ASCII
> "ADAR Sursangam" string last time. Check what it actually produces
> (`ls ios/`) before assuming it's called `ADARSurSankalan` or similar,
> and don't be surprised if it's safer to just keep using the existing
> `ADARSursangam` project.
>
> Also worth deciding before you submit: `app.json` still has
> `"version": "1.1.0"` / `ios.buildNumber: "1"` — the same values this
> doc originally set for the Sursangam release. If that build was never
> actually submitted, those values are still fine to use as-is; if it
> *was* submitted, Apple requires a new, unique build number (and
> typically a bumped version) for this next upload.

This is an **update** to the app already live in App Store Connect as "ADAR
Geetabitan" (bundle ID `com.agomoniai.adargeetabitan`) — not a new app. The
bundle ID, Apple Team ID, and App Store Connect app record (`ascAppId`
`6815705035`) all stay exactly the same; only the public-facing **name**,
icon, splash color, and in-app copy change to "ADAR Sursangam" to reflect
that the app (and the shared `geetabitan` backend tenant behind it) now
covers both Rabindra Sangeet and Nazrul Geeti.

Already done for you this session (verified on your Mac):
- `app.json`: `name` → `"ADAR Sursangam"`, `version` bumped `1.0.0` →
  `1.1.0`, `ios.buildNumber` set to `"1"` (build numbers restart under a new
  marketing version), `ios.infoPlist.CFBundleDisplayName` → `"আদর সুরসঙ্গম"`,
  mic-usage description updated, splash/adaptive-icon background recolored
  to `#8B1A1A` (matches the new web brand). `bundleIdentifier`,
  `android.package`, `slug`, and `scheme` are **unchanged** — same app
  record, same deployment target, same deep-link scheme.
- `assets/icon.png`, `assets/adaptive-icon.png`, `assets/logo-mark.png`:
  wordmark repainted from "গীতবিতান" to "সুরসঙ্গম" in place (same tree/tanpura
  mark, same bronze color).
- In-app copy (`src/GuestHomeScreen.tsx`, `src/AiConsentScreen.tsx`,
  `src/HomeScreen.tsx`, `App.tsx`): header title, welcome message, footer,
  AI-consent disclosure text, and brand color all updated to Sursangam.
  Two Nazrul Geeti example questions were added to the guest chip list
  (previously 100% Rabindra Sangeet) — the backend (`domains/geetabitan/`)
  already answers Nazrul questions when a user types "নজরুল", it just wasn't
  surfaced in the app before.
- Privacy policy page moved: `adar-web/geetabitan-privacy.html` →
  `adar-web/sursangam-privacy.html` (brand text updated throughout), with a
  301 redirect from the old path so the URL already on file with Apple
  keeps working.

**Important — `ios/` must be regenerated, not patched.** Expo derives the
Xcode project name from `app.json`'s `name` field at `prebuild` time. Since
that changed from "ADAR Geetabitan" to "ADAR Sursangam", the existing
`ios/ADARGeetabitan.xcodeproj` is stale and needs to be rebuilt — it will
likely come out as `ios/ADARSursangam.xcodeproj` this time. The bundle ID
inside it stays `com.agomoniai.adargeetabitan` either way, so this does not
create a new App Store Connect app. My shell tools run inside a sandboxed
Linux VM bridged to your files — it can edit code/JSON but cannot run
CocoaPods, Xcode, the iOS Simulator, or `expo prebuild`'s native steps, so
every command below needs to run on your Mac in Terminal.app.

---

## 0. One-time manual steps for this release (web UI — can't be scripted)

**a) Rename the app in App Store Connect:**
appstoreconnect.apple.com → My Apps → ADAR Geetabitan → **App Information**
→ change **Name** to `ADAR Sursangam` (or `আদর সুরসঙ্গম`) → Save. This is a
metadata change on the same app record — it does not affect the bundle ID,
existing reviews, install base, or ratings history. It gets a normal review
pass like any other metadata edit.

**b) Update the version page's Subtitle, Privacy Policy URL, and
screenshots** once the new build is attached (see step 8 below for the
actual values) — do this after the archive uploads so you're not editing
a version page twice.

**c) Confirm your Apple ID / API key are still set up** (skip if unchanged
since the last submission): Xcode → Settings → Accounts, and the `.p8` key
at `~/keys/` from your prior submission (Key ID `72GVQS9485`) — reusable if
you still have it. If not, generate a new one in App Store Connect → Users
and Access → Integrations → App Store Connect API (role "App Manager").

---

## 1. Regenerate the iOS project

```bash
cd ~/project/adar-mobile/apps/geetabitan
rm -rf ios ios.bak-* build
npx expo prebuild --platform ios
cd ios
pod install
cd ..
```

This creates a fresh `ios/<Something>.xcworkspace` reflecting the new
app name. Note whatever it's actually called — you'll need it for every
step from here on.

## 2. Test locally in the iOS Simulator — do this before archiving

```bash
cd ~/project/adar-mobile/apps/geetabitan
npx expo run:ios
```
This compiles the native project (using the `ios/` folder from step 1) and
launches it straight into the Simulator — the most faithful local test
since it exercises the actual Xcode build, not just the JS bundle. First
run takes a few minutes (full native compile); subsequent runs are fast.

Check on the simulator:
- Home screen icon and splash show the new "সুরসঙ্গম" wordmark and maroon
  (`#8B1A1A`) background, not the old icon
- App name under the icon reads "ADAR Sursangam"
- The AI-consent screen (first launch only — delete the app from the
  simulator and reinstall to see it again) says "ADAR Sursangam"
- Chat welcome message mentions both রবীন্দ্রনাথ ঠাকুর and কাজী নজরুল ইসলাম
- The two new Nazrul Geeti example chips appear and return real answers
  (e.g. tap "কারার ঐ লৌহকপাট গানটি খুঁজুন")
- Voice (mic button) and "Listen" playback still work

To target a specific simulator instead of whatever's booted:
```bash
npx expo run:ios --device "iPhone 16 Pro"
```
To test on your own iPhone over USB: plug it in, trust the computer, then
`npx expo run:ios --device` and pick it from the list (needs your Apple ID
added in Xcode → Settings → Accounts, same as step 0c).

If `expo run:ios` ever misbehaves (stale derived data, odd native errors),
`rm -rf ios/build ~/Library/Developer/Xcode/DerivedData/ADARSursangam-*`
and rerun it.

## 3. Confirm the scheme name (needed for archiving)

```bash
xcodebuild -workspace ios/*.xcworkspace -list
```
Look under "Schemes:" — likely `ADARSursangam`, but use whatever it
actually prints in every command below (`<SCHEME>` placeholders).

## 4. Create the export options file

```bash
cd ~/project/adar-mobile/apps/geetabitan
cat > ExportOptions.plist <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>method</key>
    <string>app-store-connect</string>
    <key>destination</key>
    <string>upload</string>
    <key>teamID</key>
    <string>2B484T222R</string>
    <key>signingStyle</key>
    <string>automatic</string>
</dict>
</plist>
EOF
```

## 5. Build: Archive

```bash
cd ~/project/adar-mobile/apps/geetabitan
xcodebuild archive \
  -workspace ios/<SCHEME>.xcworkspace \
  -scheme <SCHEME> \
  -configuration Release \
  -archivePath build/<SCHEME>.xcarchive \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=2B484T222R \
  -authenticationKeyPath ~/keys/AuthKey_XXXXXXXXXX.p8 \
  -authenticationKeyID XXXXXXXXXX \
  -authenticationKeyIssuerID XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```
Replace `<SCHEME>` with whatever step 3 printed, and the three
`-authenticationKey...` values with your actual Key ID / path / Issuer ID.
`-allowProvisioningUpdates` renews signing automatically;
`DEVELOPMENT_TEAM=2B484T222R` is required alongside it since a fresh
`prebuild` never sets a team in the Xcode project.

Watch for `** ARCHIVE SUCCEEDED **`. This step alone takes several minutes.

## 6. Submit: Export + upload directly to App Store Connect

```bash
xcodebuild -exportArchive \
  -archivePath build/<SCHEME>.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/keys/AuthKey_XXXXXXXXXX.p8 \
  -authenticationKeyID XXXXXXXXXX \
  -authenticationKeyIssuerID XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```
Because `destination = upload` is set in `ExportOptions.plist`, this both
exports the `.ipa` **and** uploads it straight to App Store Connect. Look
for `Upload succeeded`. Since the bundle ID is unchanged, this attaches as
a new build on the existing "ADAR Geetabitan"/"ADAR Sursangam" app record —
no new App Store Connect app needed.

**Recommended before hitting Submit for Review**: once Apple finishes
processing the build (usually 10–30 min — you'll get an email, or watch
App Store Connect → TestFlight), add yourself as an internal tester and
install it via the TestFlight app on a real device. This catches
device-only issues (mic permission prompts, real network conditions) that
the simulator can't.

## 7. Deploy the web-side changes while the build processes on Apple's side

```bash
cd ~/project/adar-core
bash infra/deploy-geetabitan.sh
```
```bash
cd ~/project/adar-web
firebase deploy --only hosting:labs
```
The second makes `labs.agomoniai.com/sursangam` (and the `/geetabitan` →
`/sursangam` redirect, and the renamed privacy policy page) live — do this
*before* submitting for review so the Privacy Policy URL in step 8
resolves correctly when Apple checks it.

## 8. Update the App Store Connect listing (web UI — reference values)

**Current, verified values** (app.json / in-app constants as of this
session — supersede the Sursangam-era values that used to be here):

On the app's version page, before "Submit for Review":
- **Name**: `আদর সুর সংকলন` (ADAR Sur Sankalan) — matches `app.json`'s
  `name` and `ios.infoPlist.CFBundleDisplayName`
- **Subtitle** (30-char Apple limit — the old "Rabindra Sangeet & Nazrul
  Geeti, by voice" was already over it at 42 chars, and five composers
  won't fit anyway): something like `5 Bangla Composers, by Voice` (28
  chars) — pick your own wording, just stay under 30
- **Category**: Music
- **Privacy Policy URL**: `https://labs.agomoniai.com/sursankalan-privacy`
  (note: **not** `sursangam-privacy` — that path moved when the app was
  renamed again; confirm it's live before submitting, since Apple checks
  it)
- **Support URL**: your `adar-web/contact.html` live URL
- **What's New in This Version**: now covers five composers — Rabindra
  Sangeet, Nazrul Geeti, Rajanikanta Sangeet, Atulprasad Sangeet, and
  Dwijendra Sangeet (Rajanikanta/Atulprasad/Dwijendralal are new since
  the last "Sursangam" draft of this doc) — plus mention that voice
  playback ("Listen") now reads long replies in full instead of cutting
  off partway through, if that fix is in this build
- **Screenshots**: refresh to show the current "আদর সুর সংকলন" wordmark/
  icon and a non-Rabindra example in chat (e.g. a Dwijendralal or
  Atulprasad question) — grab these from the step 2 simulator run
- **App Review notes**: mention this is an update (same bundle ID, same
  app) adding Rajanikanta Sangeet, Atulprasad Sangeet, and Dwijendra
  Sangeet content to the existing Rabindra Sangeet / Nazrul Geeti
  assistant, guest mode needs no login, Bengali-language app

Once the build shows "Ready to Submit" under TestFlight/Build, select it
on the app version page and hit **Submit for Review**.

---

## Android (not yet submitted — first submission, separate task)

Since Android has never been submitted, it launches clean as "ADAR
Sursangam" with no legacy name to carry — no equivalent regeneration
concern. See `ANDROID-SUBMISSION-STEPS.md` — `android/` is already
scaffolded, `app.json` has `android.versionCode: 1` and the recolored
`adaptive-icon.png` ready.
