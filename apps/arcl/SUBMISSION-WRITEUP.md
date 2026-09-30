# ADAR ARCL — New Submission Writeup

## Summary

This submission replaces ARCL's previous guest-access model with a real
account system, adds in-app self-service account deletion, and fixes a
layout/keyboard bug on the Ask ADAR ARCL screen. The changes were driven by
the same App Store review requirements that ADAR Front Desk was flagged on
(Guideline 2.1 — app completeness/testability, and Guideline 5.1.1(v) —
account deletion), applied to ARCL proactively before submitting rather than
after a rejection.

## What was added

**Account creation, sign-in, and deletion (no more guest mode)**
The app previously let users in without an account ("Continue as guest").
That path has been removed entirely — sign-in is now required to reach
Home or Ask ADAR ARCL. New users create an account with email + password,
confirm a one-time code (OTP), and are signed in. A single "Profile" button
in the header opens a modal with two actions: **Sign out**, and **Delete my
account** (password-confirmed, permanently removes the account and its
Firestore data immediately, and sends a deletion-confirmation email).

**Apple reviewer access without live MFA**
A domain-agnostic MFA-bypass mechanism already used for Front Desk now
covers ARCL too — a reviewer account's email is placed in the
`MFA_BYPASS_EMAILS` backend setting, so App Review can sign in with a fixed
one-time code instead of needing live email/SMS delivery during review.

**Mobile signups made free**
ARCL is the one ADAR domain with real Stripe billing wired up on the web
app. To avoid triggering Apple's In-App Purchase requirement (Guideline
3.1.1) for a digital subscription created outside Apple's payment system,
new accounts created from the mobile app are set to `active` status
directly rather than `pending_payment` — mobile signup itself stays free;
existing web billing is untouched.

**Ask ADAR ARCL layout fix**
The question box no longer leaves a large gap to the footer, and the
on-screen keyboard no longer pushes the text input too far up or shrinks
the visible conversation. (Root cause was a keyboard-avoidance sibling/
offset bug in the shared chat component — same fix already verified on
Front Desk.)

## Why this round, proactively

ARCL's App Store Connect app record already exists (previously submitted
via EAS), so this isn't a first-time listing — but the guest-mode / no
in-app-deletion pattern was the same shape of issue that got Front Desk
rejected under Guideline 2.1. Rather than wait for the same rejection on
ARCL, the account and deletion workflow were rebuilt ahead of submission,
mirroring the fix already proven out on Front Desk.

## Testing performed this session

- TypeScript compiles clean (`tsc --noEmit`) across every file touched.
- Manual code review of the register → OTP → sign-in → delete flow against
  the existing shared-auth package (same pattern Front Desk uses).
- Layout fix ported from Front Desk, where it was confirmed against three
  rounds of real user-reported symptoms before landing on the correct root
  cause (keyboard-avoidance offset double-counting).

## Testing still needed (on your device, once the backend is live)

- [ ] Redeploy `adar-core` backend (`bash infra/deploy.sh`) — currently
      blocked by the `MFA_BYPASS_EMAILS` Cloud Run env-var type conflict.
- [ ] Register the reviewer account (`applereview@agomoniai.com`) in the
      live app once deployed.
- [ ] End-to-end on phone via Expo Go: create account → OTP → Home → sign
      out → sign back in → Profile → Delete my account → confirm the
      account is actually gone (re-register with the same email, confirm
      old password now fails).
- [ ] Confirm no path reaches Home/Ask without signing in first.
- [ ] Ask ADAR ARCL tab: text + voice, confirm the layout fix looks right.
- [ ] One internal TestFlight pass (Xcode archive → Organizer → Distribute
      App → TestFlight) before full submission — cheap insurance, same as
      the DocIntel pipeline.

## Copy for App Store Connect

**What's New in This Version**
```
- Account creation and sign-in now required to use the app (guest mode removed)
- Self-service account deletion — Profile > Delete my account
- Improved layout and keyboard behavior on the Ask ADAR ARCL screen
```

**App Review Notes**
```
Sign in with the demo account below to test the app. Account creation and
sign-in are now required — there is no guest/demo mode.

Account deletion (Guideline 5.1.1v): Profile > "Delete my account", confirm
with the account password. This permanently deletes the account and its
data immediately.

Reviewer account: applereview@agomoniai.com uses a fixed one-time code and
does not require live MFA/email delivery during review.
```

**Sign-In Information**: `applereview@agomoniai.com` + the password you set
when registering that account in the live app.

## Open item

The `MFA_BYPASS_EMAILS` Cloud Run deploy error is the one thing standing
between this writeup and an actual testable build. Once `infra/deploy.sh`
succeeds, everything else in this doc is ready to execute in order.
