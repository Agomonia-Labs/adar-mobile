# ADAR Front Desk — End-to-End Testing & Deployment

## 0. Redeploy the backend first (needed either way)

Chat/voice for Front Desk and the Geetabitan narration fix both live in
`adar-core`. Nothing in the app will work end-to-end until these are live:

```bash
cd ~/project/adar-core
bash infra/deploy-scheduling.sh   # ships /api/scheduling/guest/chat|tts|stt
bash infra/deploy-geetabitan.sh   # ships the "> " blockquote TTS fix
```

`deploy-scheduling.sh` now also ships: booking creation/listing/cancelling
requiring a real signed-in account (same email+password+OTP login as
scheduling.adar.agomoniai.com), a required+validated email on the booking
form, and confirmation emails to the customer, the provider (if it has an
email on file), and the practice admin (falls back to `ADMIN_EMAIL`). Re-run
the provider seed too, so the new `email` field exists on each provider doc:
```bash
DOMAIN=scheduling python -m domains.scheduling.ingestion.seed_front_desk_demo
```

Note: the 6 sample practices' 30 providers are fictional, so their `email`
field is blank by default -- provider- and admin-facing emails both land on
`ADMIN_EMAIL` until you set real addresses (edit `notification_email` on
the practice doc, or `email` on a provider doc, in Firestore).


Optional (publishes the new privacy policy page the consent screen links to):
```bash
cd ~/project/adar-web
firebase deploy --only hosting:labs
```

Also needed once (adds 5 providers per practice so "First available" and
the provider-picker actually have real choices -- each demo practice
previously shipped with only 2-3 providers):
```bash
cd ~/project/adar-core
DOMAIN=scheduling python -m domains.scheduling.ingestion.seed_front_desk_demo
```
This is idempotent (merge=True on every field) -- safe to re-run any time
`domains/scheduling/ingestion/front_desk_demo.json` changes. It needs your
usual Firestore credentials (the same `gcloud auth application-default
login` / service-account setup you already use for `infra/deploy-*.sh`) --
I couldn't run it myself this session because this shell has no `gcloud`
or Application Default Credentials configured.

---

## 1. End-to-end testing — no Xcode needed

Unlike Geetabitan, Front Desk uses no native modules outside what Expo Go
already supports (`expo-av`, `expo-file-system`, `expo-secure-store` are all
fine in Expo Go for SDK 51). You can test the whole app on your phone without
building anything:

```bash
cd ~/project/adar-mobile/apps/frontdesk
npx expo start
```

Scan the QR code with the **Expo Go** app on your iPhone/Android. Walk through:

- **Consent screen** — appears once; accept it.
- **Language picker** (header) — switch between English/Spanish/Bangla/Hindi
  and confirm the UI text changes; Arabic should keep English text (by design
  — see the app's privacy notice for why).
- **Practice picker** (header) — switch between the 6 demo verticals
  (health/salon/finance/legal/real estate/tutoring) and confirm services/
  providers change.
- **Sign in** — tapping Book or My Appointments without an account now shows
  a sign-in/create-account screen (same backend login as
  scheduling.adar.agomoniai.com). Create a test account, then:
- **Book tab** — walk the full wizard: Service → Provider → Time → Details →
  Confirm. Try booking the *same* slot twice from two devices/sessions to see
  the "that time was just taken" (409) handling.
- **Ask ADAR tab** — type a question, then try voice (tap mic, speak, tap
  again). Tap "Listen" on a reply twice quickly — should no longer overlap.
- **My Appointments tab** — confirm your booking shows up, and cancel it.

If something 404s or 503s here, it's almost always because step 0's
`deploy-scheduling.sh` hasn't been run yet (guest chat/voice are gated behind
`SCHEDULING_GUEST_ACCESS_ENABLED`/`SCHEDULING_GUEST_VOICE_ENABLED`).

---

## 2. Production build & App Store submission (same free pipeline as Geetabitan)

Current state (confirmed):
- `apps/frontdesk/ios/` already exists (`ADARFrontDesk.xcodeproj` /
  `ADARFrontDesk.xcworkspace`), and `pod install` has already been run
  (`Pods/` and `Podfile.lock` are present) -- step (b) below is a no-op
  unless you've changed native dependencies since.
- Bundle ID `com.agomoniai.adarfrontdesk`, version `1.0.0` / build `1` --
  no Bangla-name workaround needed (the app name is already plain ASCII).
- No archive has been produced yet (no `build/` directory, no
  `ExportOptions.plist`) -- this will be a first upload, so version 1.0.0 /
  build 1 is fine as-is. For any resubmission after this one, bump
  `ios.buildNumber` in `app.json` (and re-run `expo prebuild` if you change
  it there) before archiving again -- Apple rejects a re-upload with an
  unchanged build number.
- All of this session's JS/backend changes (real bookings, cancellation
  emails, multi-language chat, the Providers tab, layout fixes) are already
  in the code that this build will pick up -- no extra prebuild needed for
  any of that, since none of it touched native config.

As before, my shell here is a sandboxed Linux VM — it can edit code and run
`expo prebuild`, but not CocoaPods/Xcode/`xcodebuild`. Everything below runs
on your Mac in Terminal.app.

### a) One-time setup (if you haven't already, for this specific app)

**Create the Front Desk App Store Connect app record** (this is a *separate*
app from ARCL/Geetabitan — it needs its own numeric Apple ID, same lesson as
last time):
appstoreconnect.apple.com → My Apps → **+** → **New App**
- Platform: iOS
- Name: `ADAR Front Desk`
- Bundle ID: `com.agomoniai.adarfrontdesk`
- SKU: `adar-frontdesk`

**Reuse your existing Admin-role API key** from the Geetabitan submission
(the one that fixed the "Cloud signing permission error") — no need to
generate a new one. If you don't have it handy anymore, App Store Connect →
Users and Access → Integrations → App Store Connect API, and confirm its
**Access** column says **Admin** (App Manager/Developer roles fail
cloud-managed signing, as we found out last time).

### b) Install CocoaPods dependencies

```bash
cd ~/project/adar-mobile/apps/frontdesk/ios
pod install
cd ..
```

### c) Confirm the scheme name

```bash
xcodebuild -workspace ios/ADARFrontDesk.xcworkspace -list
```
Should print `ADARFrontDesk` under "Schemes:".

### d) Create the export options file

```bash
cd ~/project/adar-mobile/apps/frontdesk
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
cd ~/project/adar-mobile/apps/frontdesk
xcodebuild archive \
  -workspace ios/ADARFrontDesk.xcworkspace \
  -scheme ADARFrontDesk \
  -configuration Release \
  -archivePath build/ADARFrontDesk.xcarchive \
  -allowProvisioningUpdates \
  DEVELOPMENT_TEAM=2B484T222R \
  -authenticationKeyPath ~/keys/AuthKey_PH8RDXQ8ZN.p8 \
  -authenticationKeyID PH8RDXQ8ZN \
  -authenticationKeyIssuerID e758a981-f6ef-47b3-8128-2a20633619fd
```
Same Admin-role API key as the Geetabitan submission (reused, per step (a)
above) -- only `-workspace`, `-scheme`, and `-archivePath` change between
apps. Watch for `** ARCHIVE SUCCEEDED **`.

### f) Export + upload directly to App Store Connect

```bash
xcodebuild -exportArchive \
  -archivePath build/ADARFrontDesk.xcarchive \
  -exportOptionsPlist ExportOptions.plist \
  -exportPath build/export \
  -allowProvisioningUpdates \
  -authenticationKeyPath ~/keys/AuthKey_PH8RDXQ8ZN.p8 \
  -authenticationKeyID PH8RDXQ8ZN \
  -authenticationKeyIssuerID e758a981-f6ef-47b3-8128-2a20633619fd
```
Look for `Upload succeeded`. If it fails because no matching app exists in
App Store Connect, finish step (a) first.

### g) Create a reviewer demo account (required -- the app now requires sign-in)

Front Desk is sign-in-only (email + password + OTP, same login as
scheduling.adar.agomoniai.com) -- there is no guest/no-login mode any more.
Apple's reviewer needs a working login they can actually use, and they have
no access to any inbox to receive a one-time code, so:

1. In the app (or at scheduling.adar.agomoniai.com), create a dedicated
   account for review, e.g. `applereview@agomoniai.com` with a password you
   choose. Log in with it once normally (you'll receive the OTP at that
   inbox) to confirm the account is active.
2. `infra/deploy-scheduling.sh` already whitelists `applereview@agomoniai.com`
   in `MFA_BYPASS_EMAILS` (durably, through the script itself, not a
   one-off `gcloud run services update` -- see the note by that variable in
   the script) -- so running step 0's redeploy is all that's needed for the
   bypass to take effect. Pass a different value only if you used a
   different reviewer email:
   ```bash
   MFA_BYPASS_EMAILS=someone-else@agomoniai.com bash infra/deploy-scheduling.sh
   ```
   (Pipe-separate multiple emails via the same env var if you ever need
   more than one -- comma still works too since the value itself is just
   read as a comma-split list server-side. This only affects the listed
   emails -- every other account still goes through the normal OTP flow.)
3. Confirm it worked: log out and back in with that account in the app --
   it should skip straight past the OTP screen.

Keep that email/password to hand for step (h) below (App Review notes).

### h) App Store Connect listing (ready-to-paste values)

**App Information**
- **Name**: `ADAR Front Desk`
- **Subtitle** (30 char max): `AI Appointment Scheduling` -- the earlier
  draft ("AI appointment scheduling, in action") was 36 characters and
  would have been rejected by the field's limit; this one is 25.
- **Category**: Business (no secondary category needed)
- **Content Rights**: "No" to containing third-party content, unless you
  consider the AI-generated replies themselves third-party content (most
  apps in this category answer No here).
- **Age Rating**: run the questionnaire -- answer "None" to every content
  descriptor (violence, mature themes, gambling, etc.); expect **4+**.

**Pricing and Availability**
- **Price**: Free
- **Availability**: all territories, unless you want to restrict it

**Version Information (1.0.0)**
- **Promotional text** (optional, 170 char max, editable without re-review):
  `Now booking real appointments across six sample business types -- try
  Ask ADAR's voice assistant in English, Spanish, Bangla, or Hindi.`
- **Description**:
  ```
  ADAR Front Desk is an AI-powered appointment scheduling assistant for
  small practices and businesses -- shown here across six sample
  verticals: health, salon, finance, legal, real estate, and tutoring.

  - Book appointments in a few taps: pick a service, a provider, and a
    time that works.
  - Ask ADAR: chat or talk to a conversational AI assistant that can
    check availability, answer questions about a practice's services and
    hours, and book an appointment for you -- in English, Spanish,
    Bangla, or Hindi.
  - Manage what you've booked: see every upcoming appointment under My
    Calendar, and cancel in one tap when plans change.
  - Browse each practice's providers, their roles, and their working
    hours before you book.

  This is a live product preview across a curated set of sample
  practices, so every business and provider you see is illustrative.
  Create a free account to try booking, chatting, and managing a real
  appointment end-to-end.
  ```
- **Keywords** (100 char max, comma-separated, no spaces after commas):
  `scheduling,appointment,booking,AI assistant,chatbot,voice,calendar,front desk,business,practice`
- **Support URL**: `https://labs.agomoniai.com/contact` (confirmed live --
  adar-web's Firebase Hosting target `labs` serves `contact.html` at this
  clean URL, same pattern as the privacy policy below)
- **Marketing URL**: optional -- `https://labs.agomoniai.com/front-desk` if
  you want one
- **Privacy Policy URL**: `https://labs.agomoniai.com/frontdesk-privacy`
- **Copyright**: `2026 Agomonia Labs`
- **Build**: pick the build you uploaded in step (f)

**Export Compliance**: already handled -- `apps/frontdesk/app.json` sets
`ITSAppUsesNonExemptEncryption: false` in `infoPlist`, so this is baked into
the binary and App Store Connect should *not* prompt you for it during
processing.

**App Privacy questionnaire**: declare "Contact Info" (name/phone/email --
account signup and booking details), "User Content" (Ask ADAR chat text),
"Audio Data" (voice input/output, if used) -- purpose "App Functionality,"
tracking = No. Since accounts and bookings are now real (not demo/seeded
data with a TTL), also declare data is linked to the user's identity where
the questionnaire asks.

**App Review Information**
- **Sign-In required**: **Yes** -- this is what triggers Apple to ask for
  demo credentials; without it filled in correctly, review can stall.
- **App Review demo account**: email/password from step (g) above.
- **Contact info** (first/last name, phone, email): your own -- Apple needs
  a way to reach you if review has questions.
- **Notes**: something like -- "Sign in with the demo account above (no
  OTP/2FA needed for this account). The app is a real appointment-booking
  product for small practices/businesses across a few sample verticals
  (health, salon, legal, etc.) -- Book a real appointment, ask ADAR
  (chat/voice) to book one instead, see it under My Calendar, and cancel
  it. Bookings made during review are real and can be cancelled afterward
  from My Calendar. The Account button in the header also has a
  self-service 'Delete my account' option (password-confirmed) -- please
  don't use it on the shared demo account, since that would remove Apple's
  own ability to sign back in for future reviews; create a separate
  throwaway account first if you want to test deletion."

**Account deletion (Guideline 5.1.1(v))**: the Account button in the
header opens a modal with "Delete my account" -- password re-entry,
permanently deletes the Firestore team profile AND the customer's own
bookings (see the `DOMAIN == "scheduling"` cascade in
`adar-core/api/routes/auth.py`'s `POST /api/auth/delete-account`), and
sends a confirmation email. This ships in the same build as everything
else above -- no extra step needed, but the backend redeploy in step 0
below is what actually serves the new endpoint.

**Screenshots (required before you can submit)**: at least one set at
6.9" (iPhone 16 Pro Max or similar simulator/device) is mandatory; since
`ios.supportsTablet` is `true` in app.json, App Store Connect will also
ask for a 13" iPad set. Easiest source: run the app in the iOS Simulator
on those device sizes (Simulator → Device → pick the size → Cmd+S to
save a screenshot) for the header/practice picker, Book wizard, Ask ADAR
chat, and My Calendar screens.
