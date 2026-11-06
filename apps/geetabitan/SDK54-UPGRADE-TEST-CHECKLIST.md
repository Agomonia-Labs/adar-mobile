# Geetabitan Expo SDK 51 → 54 upgrade — what changed, and what to test

## What I did

Pinned `apps/geetabitan` to the same Expo SDK 54 / React Native 0.81.5 /
React 19.1.0 stack that `docintel` and `eats` already run in this monorepo
(matched their exact dependency versions for consistency), then:

1. **`app.json`**: added the `expo-build-properties` plugin
   (`android.compileSdkVersion`/`targetSdkVersion` = 36, `buildToolsVersion`
   = 36.0.0 — satisfies Google Play's mandatory target-API requirement) and
   `newArchEnabled: true`, matching docintel/eats.
2. **`package.json`**: bumped `expo`, `react`, `react-native`,
   `expo-av`, `expo-file-system`, `expo-secure-store`, `expo-status-bar`,
   `react-native-safe-area-context`, `react-native-webview`, and dev deps
   to the exact versions docintel/eats already use. Added
   `expo-build-properties` as a direct dependency (needed by the app.json
   plugin above).
3. **Two real code fixes found while validating** (not cosmetic):
   - `expo-file-system`'s new default export dropped `documentDirectory`/
     `cacheDirectory`/`EncodingType` (moved to `expo-file-system/legacy`).
     `src/useAiConsent.ts` and `src/useVoiceChat.ts` used these — switched
     both to import from `'expo-file-system/legacy'`, same as docintel
     already does. Caught this via `tsc --noEmit`, not by guessing.
   - `src/GuestHomeScreen.tsx` and `src/HomeScreen.tsx` imported
     `SafeAreaView` from **core `react-native`**, which does not apply
     Android edge-to-edge insets (Android 15+/API 35+ now enforces
     edge-to-edge by default, and API 36 makes it unavoidable). Switched
     both to `SafeAreaView` from `react-native-safe-area-context` instead
     — same pattern every other screen in docintel/eats already uses.
     **Without this fix, content in both screens would likely render
     under the status bar/notch on Android with this SDK.**
   - **`metro.config.js`**: ported the monorepo dependency-resolution fix
     from `eats`'s metro.config.js verbatim (adapted comments). This
     monorepo mixes Expo SDK 54 apps (docintel, eats, now geetabitan) with
     SDK 51 apps (arcl, frontdesk) sharing hoisted `@adar/*` packages —
     without this fix, `@adar/shared-auth`/`@adar/shared-chat` (which this
     app's screens use directly) resolve `react`/`react-native`/`expo-*`
     from the monorepo root's OLDER copies instead of geetabitan's own,
     which is exactly what crashed docintel with "PlatformConstants could
     not be found" the first time this was hit in this repo. This is not
     theoretical — `expo-doctor` flagged the exact duplicate-dependency
     pattern (`expo@54.0.38` nested vs `expo@51.0.39` at the monorepo
     root) that causes it.
4. **Regenerated `android/` and `ios/`** from the new SDK (both
   gitignored, disposable — not in your diff). Verified afterward:
   - Android: `compileSdkVersion`/`targetSdkVersion` = 36,
     `versionName` = `1.2.0`, package icons correctly show the current
     "আদর সুর সংকলন" artwork.
   - iOS: Xcode project is still correctly named
     `ADARSursangam.xcodeproj`/`.xcworkspace` (there's a real risk here —
     app.json's `name` field is pure Bengali text, and Expo's Xcode
     project-naming logic silently falls back to a generic `app.xcodeproj`
     on non-ASCII input; I caught this, worked around it by temporarily
     swapping `name` to the ASCII `"ADAR Sursangam"` for just the
     regeneration step, then reverted — the actual on-device app name
     comes from `ios.infoPlist.CFBundleDisplayName`, which was never
     touched and is still correctly Bengali). Also verified:
     `IPHONEOS_DEPLOYMENT_TARGET` bumped to 15.1 (matches docintel/eats,
     required for RN 0.81), `MARKETING_VERSION`/`CFBundleShortVersionString`
     = `1.2.0`, bundle ID unchanged, AppIcon correct, AppDelegate is now
     Swift (new template default, was Objective-C before — this is
     expected and not something you need to act on).
5. **Validated**: `tsc --noEmit` passes clean across the app. `expo-doctor`
   ran 18 checks — 13 passed; the other 5 either need network this sandbox
   doesn't have (Expo API / React Native Directory connectivity checks —
   will simply pass when you run it from your Mac) or are the
   by-design dual-Expo-version situation described above, now mitigated by
   the metro.config.js fix.

**Nothing has been committed.** Everything above is sitting as uncommitted
changes in your working tree (`git status`/`git diff` in `adar-mobile`
shows exactly these files) — review before committing whenever you're
ready. `android/` and `ios/` are gitignored as before, so they won't show
in the diff, but they're regenerated on disk right now.

## What you need to do before testing (can't be done from here)

- **iOS: run CocoaPods.** The regenerated `ios/` folder has no `Pods/` or
  `.xcworkspace` yet — pod installation needs an actual Mac/Xcode
  toolchain, which isn't available in this session. On your Mac:
  ```bash
  cd ~/project/adar-mobile/apps/geetabitan/ios
  pod install
  ```
  Then open `ADARSursangam.xcworkspace` (not `.xcodeproj`) in Xcode.
- **Android: nothing extra needed** — EAS Build / local Gradle builds pull
  dependencies automatically.

## End-to-end test checklist

### iOS
- [ ] `pod install` completes without errors
- [ ] Opens and builds in Xcode (`ADARSursangam.xcworkspace`) for
      Simulator, no red errors
- [ ] App launches on a real device without crashing (specifically:
      no "PlatformConstants could not be found" or similar startup crash
      — this is the exact symptom the metro.config.js fix prevents, so
      it's the most important thing to confirm)
- [ ] AI consent screen appears on first launch, Accept proceeds to chat
- [ ] Type a question, get a response for each composer: রবীন্দ্রসঙ্গীত,
      নজরুলগীতি, রজনীকান্ত, অতুলপ্রসাদ, দ্বিজেন্দ্রলাল
- [ ] Tap voice/mic button, ask a question by voice, get a spoken response
- [ ] Ask something with a long answer — confirm the "Listen" button plays
      the **entire** response across multiple TTS chunks without stopping
      partway (this was this session's earlier voice-playback fix; make
      sure the SDK upgrade didn't regress it)
- [ ] Home screen logo in the header (top-left) displays correctly, no
      stray centered logo
- [ ] App icon on the home screen shows current "আদর সুর সংকলন" artwork
- [ ] `xcodebuild archive` + `exportArchive` succeed with the commands from
      `SUBMISSION-STEPS.md` (version is already at `1.2.0`, should upload
      cleanly to a fresh Pre-Release Train)

### Android
- [ ] `npx eas build --platform android --profile preview` (or
      `expo run:android` if you have an emulator/device set up) completes
      without a build failure
- [ ] App installs and launches without crashing (same
      "PlatformConstants"-style check as iOS)
- [ ] **Specifically check status bar/notch area** on both the consent
      screen and the chat screen — content should NOT render underneath
      the system status bar (this is the edge-to-edge risk the
      SafeAreaView fix addresses; worth a deliberate look since Android
      15+/16 enforce this by default now)
- [ ] Same chat/voice/multi-chunk-playback checks as iOS above, for all 5
      composers
- [ ] App icon on the home screen/app drawer shows current artwork
- [ ] `npx eas build --platform android --profile production` produces an
      `.aab`, and `npx eas submit --platform android --profile production
      --latest` uploads to Play Console's internal testing track without
      a target-API-level rejection (this was the original blocker —
      confirming it's gone is the actual point of this whole upgrade)

### Both platforms — regression watch
Since this is a 3-year SDK jump (RN 0.74 → 0.81, React 18 → 19, old
architecture → New Architecture), also keep an eye out generally for
anything that looks subtly different even if it doesn't crash outright —
text input focus/keyboard behavior, scroll behavior in the chat list, and
WebView-rendered content (if any) are the usual places New Architecture
changes surface in apps that otherwise look the same.
