# adar-mobile: manual build walkthrough

Run every step below by hand, in your own Mac Terminal, one at a time,
before wiring any of this into CI/CD. Nothing here is automated — the
point is to see exactly what each command does and confirm it works, app
by app. Once you're comfortable with the full sequence for one app, the
other two are identical.

Do all of this for **`arcl` first**, end to end, before touching
`geetabitan` or `frontdesk` — that way if something's wrong, you're
debugging one app's setup, not three at once.

## Step 0 — check what's already on your Mac

Run these and note the output. Nothing to fix yet, just see where you stand:

```bash
node -v          # need 18+ (repo's using Expo SDK 51 / RN 0.74.5)
npm -v
java -version    # need a JDK for Android (Gradle) builds
xcodebuild -version   # only relevant if/when you build iOS
pod --version         # CocoaPods — only relevant for iOS
```

If `java -version` or `xcodebuild` are missing, that's fine for now —
you'll only hit that wall when you get to the platform that needs it.

## Step 1 — install the EAS CLI and log in

```bash
npm install -g eas-cli
eas --version
eas login
```

`eas login` opens a browser (or prompts for username/password) against
your Expo account. This is the account that will own your build history
and (later) your submissions — if you don't have one yet, `eas login`
will offer to create one.

## Step 2 — install monorepo dependencies

From the repo root (not inside an app folder — this is an npm workspaces
monorepo, so this one command installs for all three apps + shared-auth):

```bash
cd adar-mobile
npm install
```

Confirm it worked: `ls node_modules/@adar/shared-auth` should exist (the
workspace symlink), and `apps/arcl/node_modules` should exist too.

## Step 3 — link `arcl` to an EAS project

```bash
cd apps/arcl
eas build:configure
```

This asks which platforms (choose both) and then writes an `extra.eas.projectId`
into `apps/arcl/app.json` — that's the one file this step changes. Open
that file afterward and confirm the new `extra` block is there. This is
what ties local builds to your Expo account/project; it needs to happen
once per app, not once per repo.

## Step 4 — first real build: Android, local, preview profile

```bash
eas build --platform android --local --profile preview
```

What this does: runs the actual Gradle build **on your machine** (no
Expo cloud build minutes used), producing an installable `.apk` — the
`preview` profile builds an apk (not the Play-Store `.aab` format)
specifically so you can sideload it and look at it before caring about
store submission at all.

If Java/Android SDK aren't set up, this will fail with a specific error
naming what's missing (e.g. `ANDROID_HOME` not set) — install just that
piece and re-run. Don't provision anything preemptively; let the error
tell you what's actually needed.

When it succeeds, it prints the path to the built `.apk`. Install it on
a real device or emulator:

```bash
adb install path/to/build.apk
```

Open the app, sign in, confirm you land on the (still placeholder) home
screen. That's your Android toolchain proven end to end.

## Step 5 — first real iOS build: simulator, no Apple account needed

```bash
eas build --platform ios --local --profile ios-simulator
```

This builds for the iOS **Simulator**, which needs Xcode + CocoaPods
locally but — unlike a device build — needs no Apple Developer account,
no signing certificate, no provisioning profile. It's the cheapest way
to prove your Mac can build this app's iOS side at all before you touch
any Apple credentials.

When it finishes, drag the resulting `.app`/`.tar.gz` onto a running
iOS Simulator, or:

```bash
xcrun simctl install booted path/to/build.app
```

## Step 6 — repeat for `geetabitan` and `frontdesk`

Same four commands (`eas build:configure`, Android local build, iOS
simulator build), just `cd apps/geetabitan` / `cd apps/frontdesk`
instead. `npm install` at the root in Step 2 already covered all three.

## What's deliberately NOT covered yet

- **Real device iOS builds** (need an Apple Developer account + signing
  — `eas build --platform ios --local --profile preview`, which sets
  `simulator: false`).
- **Store submission** (`eas submit`) — needs the Play Console service
  account key and Apple/App Store Connect IDs filled into each app's
  `eas.json` under `submit.production`. Do this only once you've built
  and manually verified all three apps locally.
- **Any CI/CD automation.** This file intentionally stays manual-only
  for now — revisit once every step above is familiar and reliable by
  hand.
