# ADAR ARCL — Local Xcode Build, Test & Rebuild (replaces EAS)

This mirrors the Front Desk / DocIntel pipeline: no more `eas build` /
`eas submit` — everything runs locally via `xcodebuild`, uploading straight
to App Store Connect.

## 0. Current state (confirmed)

- `apps/arcl/ios/` already exists (`ADARARCL.xcodeproj` / `ADARARCL.xcworkspace`),
  and `pod install` has already been run (`Pods/` and `Podfile.lock` present,
  both dated Sep 24). Re-run `pod install` only if you've changed native
  dependencies (added/removed an Expo module with native code) since then —
  otherwise step (b) below is a no-op.
- Bundle ID `com.agomoniai.adararcl`, scheme `ADARARCL`, version `1.0.0` /
  build `1`.
- **The App Store Connect app record already exists** — `eas.json` shows
  `ascAppId: "6815705035"`, `appleTeamId: "2B484T222R"` (same team as Front
  Desk/DocIntel), `appleId: bkd_108@yahoo.com`. Unlike Front Desk's first
  submission, there's no "create a new app" step to do first.
- No archive has ever been produced locally yet (no `build/` directory, no
  `ExportOptions.plist`) — this session's build will be the first local one.
  If this is a *resubmission* (ARCL was previously submitted via EAS), bump
  `ios.buildNumber` in `app.json` before archiving, since Apple rejects a
  re-upload with an unchanged build number; if this is the first-ever binary
  for ARCL, build `1` is fine as-is.
- This session's changes (real account creation/login, in-app self-service
  account deletion, Apple-reviewer MFA bypass, free mobile signups) are
  already in the code this build will pick up — none of it touched native
  config, so no extra prebuild is needed for any of that.

My shell here is a sandboxed Linux VM — it can edit JS/Python code, but not
run CocoaPods/Xcode/`xcodebuild`. **Everything below runs on your Mac in
Terminal.app.**

---

## 1. End-to-end testing — no Xcode needed (Expo Go)

Like Front Desk, ARCL uses no native modules outside what Expo Go already
supports, so you can test the whole account flow on your phone without
building anything:

```bash
cd ~/project/adar-mobile/apps/arcl
npx expo start
```

Scan the QR code with the **Expo Go** app. Walk through:

- **Create account** — register with a new email/password, complete the OTP
  step, confirm you land on the Home tab signed in.
- **Sign out / sign back in** — from the Profile button on Home, confirm
  both round-trip correctly.
- **Delete account** — Profile → "Delete my account" → confirm with
  password → confirm the account is actually gone (a fresh register with
  the same email should work again, and sign-in with the old password
  should fail).
- **Ask ADAR ARCL tab** — type a question, try voice; confirm no layout gap
  appears between the text box and the (now-hidden-while-on-this-tab)
  footer, and that the keyboard doesn't push the input row too far up.
- **No guest mode** — confirm there is no way to reach Home/Ask without
  signing in first (the old "Continue as guest" path is gone).

If registration/login/delete 404s or errors out, it's almost always because
the backend redeploy (with the account-deletion endpoint, `BILLING_ENABLED`,
and `MFA_BYPASS_EMAILS`) hasn't gone out yet — see `adar-core/infra/deploy.sh`.

---

## 2. Production build & App Store submission

### a) One-time setup

Nothing to create in App Store Connect — the ARCL app record already exists
(`ascAppId 6815705035`). Reuse the same Admin-role App Store Connect API key
already used for Front Desk/DocIntel/Geetabitan (same Apple Developer Team,
`2B484T222R`):

- Key ID: `PH8RDXQ8ZN`
- Issuer ID: `e758a981-f6ef-47b3-8128-2a20633619fd`
- File: `~/keys/AuthKey_PH8RDXQ8ZN.p8`

**Please confirm that file still exists at that path on your Mac before
running step (e)** — I can't check it myself from this shell since `~/keys`
isn't inside a folder I have access to. If it's missing, re-download it from
App Store Connect → Users and Access → Integrations (you can only download an
API key's `.p8` once per key, so if it's truly gone you'll need to generate a
new key there instead).

### b) Install CocoaPods dependencies

```bash
cd ~/project/adar-mobile/apps/arcl/ios
pod install
cd ..
```

### c) Confirm the scheme name

```bash
cd ~/project/adar-mobile/apps/arcl
xcodebuild -workspace ios/ADARARCL.xcworkspace -list
```
Should print `ADARARCL` under "Schemes:".

### d) Create the export options file

```bash
cd ~/project/adar-mobile/apps/arcl
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

### e) Archive

```bash
cd ~/project/adar-mobile/apps/arcl
xcodebuild archive \
  -workspace ios/ADARARCL.xcworkspace \
  -scheme ADARARCL \
  -configuration Release \
  -archivePath build/ADARARCL.xcarchive \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=2B484T222R \
  -authenticationKeyPath ~/keys/AuthKey_PH8RDXQ8ZN.p8 \
  -authenticationKeyID PH8RDXQ8ZN \
  -authenticationKeyIssuerID e758a981-f6ef-47b3-8128-2a20633619fd
```
Watch for `** ARCHIVE SUCCEEDED **`.

### f) Export + upload directly to App Store Connect

```bash
xcodebuild -exportArchive \
  -archivePath build/ADARARCL.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/keys/AuthKey_PH8RDXQ8ZN.p8 \
  -authenticationKeyID PH8RDXQ8ZN \
  -authenticationKeyIssuerID e758a981-f6ef-47b3-8128-2a20633619fd
```
Look for `Upload succeeded`. Then in App Store Connect, wait for the build to
finish processing, attach it to a version, fill in the App Review notes
(reviewer login: create it with `applereview@agomoniai.com` once
`MFA_BYPASS_EMAILS` is live on `adar-arcl-api`, same as Front Desk), and
submit for review.

---

## 3. Rebuilding after a code change

Every time you change JS/TS code (no native config change), just repeat
steps (e) and (f) — no need to redo `pod install` or the scheme check. If you
bump `ios.buildNumber` in `app.json` for a resubmission, run
`npx expo prebuild --platform ios` first so the native project picks up the
new build number, then (e) and (f).
