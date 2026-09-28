# ADAR Geetabitan — iOS Submission, All Commands

Already done for you this session (verified on your Mac):
- `app.json`: `name` is back to `"ADAR Geetabitan"` (restores sane Xcode project naming), with `ios.infoPlist.CFBundleDisplayName` set to `"আদর গীতবিতান"` so the phone still shows the Bangla name on the home screen.
- `apps/geetabitan/ios/` regenerated → project is `ADARGeetabitan.xcodeproj` / will be `ADARGeetabitan.xcworkspace` once you run `pod install` below.

**One limitation to know:** my shell tools run inside a sandboxed Linux VM bridged to your files — it can edit code and JSON, but it cannot run CocoaPods, Xcode, or `xcodebuild`, since those need actual macOS. Every command below needs to be run by you, in Terminal.app, on your Mac.

---

## 0. One-time manual setup (web UI / Xcode UI — can't be scripted)

**a) Create the Geetabitan App Store Connect app record** (if you haven't already):
appstoreconnect.apple.com → My Apps → **+** → **New App**
- Platform: iOS
- Name: `ADAR Geetabitan` (or `আদর গীতবিতান`)
- Bundle ID: `com.agomoniai.adargeetabitan`
- SKU: `adar-geetabitan` (or anything unique)

**b) Sign in to Xcode with your Apple ID** (skip if already done):
Xcode → Settings → Accounts → **+** → Apple ID

**c) Get / reuse an App Store Connect API key** (used below instead of your Apple ID password — avoids 2FA prompts blocking the CLI):
App Store Connect → Users and Access → Integrations → App Store Connect API.
You may already have one from your earlier `eas submit` run (Key ID `72GVQS9485`) — if you still have that `.p8` file, reuse it and skip generating a new one. Otherwise: **Generate API Key** → role "App Manager" → download the `.p8` file (Apple only lets you download it once) → note the **Key ID** and **Issuer ID** shown on that page.

Save the key somewhere stable, e.g.:
```bash
mkdir -p ~/keys
mv ~/Downloads/AuthKey_XXXXXXXXXX.p8 ~/keys/
```

---

## 1. Install CocoaPods dependencies

```bash
cd ~/project/adar-mobile/apps/geetabitan/ios
pod install
cd ..
```

This creates `ios/ADARGeetabitan.xcworkspace` (my sandbox skipped this step since it isn't macOS).

## 2. Confirm the scheme name

```bash
xcodebuild -workspace ios/ADARGeetabitan.xcworkspace -list
```
Look for the scheme under "Schemes:" — it should be `ADARGeetabitan`. Use whatever it actually prints in the commands below.

## 3. Create the export options file

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

## 4. Archive

```bash
cd ~/project/adar-mobile/apps/geetabitan
xcodebuild archive \
  -workspace ios/ADARGeetabitan.xcworkspace \
  -scheme ADARGeetabitan \
  -configuration Release \
  -archivePath build/ADARGeetabitan.xcarchive \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=2B484T222R \
  -authenticationKeyPath ~/keys/AuthKey_XXXXXXXXXX.p8 \
  -authenticationKeyID XXXXXXXXXX \
  -authenticationKeyIssuerID XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```
Replace the three `-authenticationKey...` values with your actual Key ID / path / Issuer ID from step 0c. `-allowProvisioningUpdates` creates/renews the distribution certificate and provisioning profile automatically (this is the part that kept failing under `eas build --local`); `DEVELOPMENT_TEAM=2B484T222R` is required alongside it — a fresh `prebuild` never sets a team in the Xcode project, so without this override you'll hit `error: Signing for "ADARGeetabitan" requires a development team.`

Takes a few minutes. Watch for `** ARCHIVE SUCCEEDED **` at the end.

## 5. Export + upload directly to App Store Connect

```bash
xcodebuild -exportArchive \
  -archivePath build/ADARGeetabitan.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/keys/AuthKey_XXXXXXXXXX.p8 \
  -authenticationKeyID XXXXXXXXXX \
  -authenticationKeyIssuerID XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX
```
Because `destination = upload` is set in `ExportOptions.plist`, this both exports the `.ipa` **and** uploads it straight to App Store Connect — no Xcode Organizer clicking needed. Look for `Upload succeeded` at the end.

If this fails specifically because no matching app exists in App Store Connect, go back and finish step 0a first — the bundle ID `com.agomoniai.adargeetabitan` must already have an app record before a build can attach to it.

## 6. Deploy the other two pending fixes while the build processes on Apple's side (10–30 min)

```bash
cd ~/project/adar-core
bash infra/deploy-geetabitan.sh
```
```bash
cd ~/project/adar-web
firebase deploy --only hosting:labs
```
The first ships the TTS markdown-stripping fix to your backend; the second makes `labs.agomoniai.com/geetabitan-privacy` live — required before Apple will accept your Privacy Policy URL in the next step.

## 7. Fill in the App Store Connect listing (web UI — reference values)

On the Geetabitan app's page in App Store Connect, before "Submit for Review":
- **Subtitle**: "Rabindra Sangeet, by voice"
- **Category**: Music
- **Privacy Policy URL**: `https://labs.agomoniai.com/geetabitan-privacy`
- **Support URL**: your `adar-web/contact.html` live URL
- **App Privacy questionnaire**: declare "Audio Data" and "User Content" (chat text), purpose "App Functionality," tracking = No
- **Age rating questionnaire**: expect 4+
- **Screenshots**: 5–7 from a simulator, showing chat, voice recording, "Listen" playback, YouTube mini-player
- **App Review notes**: mention guest mode needs no login, and that this is a Bengali-language app

Once the build shows "Ready to Submit" under TestFlight/Build, select it on the app version page and hit **Submit for Review**.
