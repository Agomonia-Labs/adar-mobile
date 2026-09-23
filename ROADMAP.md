# adar-mobile build roadmap

Status as of 2026-09-23. This tracks what's built vs. what's left across the
three Expo apps (`arcl`, `geetabitan`, `frontdesk`) and the shared packages
they sit on.

## Where things stand today

- **Auth is done and shared.** `@adar/shared-auth` implements the full
  login → OTP/MFA → session flow against `adar-core`'s real
  `/api/auth/*` endpoints, and all three apps already use it.
- **Zero product screens exist.** Every app's post-login screen is the same
  placeholder (`HomeScreen.tsx`: "Build the real product UI here." + a
  sign-out button).
- **No splash screen** — each `App.tsx` renders `null` while loading.
- Dependency versions are consistent across all three apps (Expo ~51,
  RN 0.74.5, React 18.2.0). No drift to worry about.
- Icons: only Geetabitan has a real app icon wired into `app.json`. ARCL and
  Front Desk still ship the default Expo icon.
- Git: this repo is now initialized locally (see README/setup note below) —
  it wasn't before.

## Key leverage point: a shared chat package

`adar-core`'s `/api/chat`, `/api/stt`, and `/api/demo/tts` endpoints are
**domain-generic** — same request/response shape regardless of whether
`DOMAIN=arcl`, `geetabitan`, or `scheduling`. That means "Ask ADAR" chat
(with optional voice) doesn't need to be built three times.

**Recommended next package: `packages/shared-chat`**, mirroring how
`shared-auth` already works — one `ChatProvider`/`useChat` hook + a
`ChatScreen` component, parameterized by tenant (brand color, suggested
questions, voice on/off), reused by all three apps. This alone probably
covers a third of each app's total screen count.

## Per-app screen roadmap (grounded in what the backend already supports)

### ADAR ARCL (team-scoped — session already carries `teamName`)

Backend tools already exist for all of these (`domains/arcl/tools/`):

1. **Home / team dashboard** — replace the placeholder with team snapshot:
   current standings position, next match, umpiring duty (now correctly
   scanning all divisions per the recent `get_team_schedule` fix).
2. **Schedule** — played / upcoming / umpiring matches
   (`get_team_schedule`), with the new "Division" column since a team's
   umpiring duty can span divisions.
3. **Standings** — `get_team_standings`, per division.
4. **Roster / players** — `get_team_players_live`, tap through to a player
   detail screen (`get_player_stats`, `get_player_season_stats`,
   `get_player_dismissals`).
5. **Live scorecard** — `get_match_scorecard`.
6. **Top performers / season records** — `get_top_performers_live`,
   `get_player_season_records`.
7. **Rules & FAQ** — `vector_search_rules`, `get_faq_answer` — good first
   use of `shared-chat`, since it's pure Q&A.
8. **Ask ADAR** — general chat via `shared-chat`.

### ADAR Geetabitan (content/tutoring-flavored, Bengali)

Backend tools already exist (`domains/geetabitan/tools/`):

1. **Song search & browse** — `vector_search_songs`, browse by raag/taal
   (`get_songs_by_raag`, `get_songs_by_taal`, `get_songs_by_paryay`).
2. **Song detail** — full lyrics (`get_full_song`), stanza-by-stanza
   (`get_song_stanza`), notation link + OCR'd notation text
   (`get_notation_link`, `get_notation_text`), YouTube link
   (`get_youtube_url` / `play_youtube_song`).
3. **Raag / Taal explorer** — `describe_raag`, `describe_taal`,
   `list_raags`, `list_taals`.
4. **Ask ADAR (voice-first)** — `shared-chat` with voice mode on; the
   backend already supports Bengali STT/TTS for this domain per the
   existing web demo.

### ADAR Front Desk (practice-scoped — session already carries `practiceId`)

Backend tools already exist (`domains/scheduling/tools/availability_tools.py`),
covering a full booking flow:

1. **Practice / provider picker** — `find_practice`, `list_providers`,
   `list_appointment_types`.
2. **Availability & booking** — `check_availability`,
   `get_weekly_availability`, `hold_slot` → `confirm_booking`.
3. **My appointments** — `list_my_appointments`, with
   `cancel_appointment` / `reschedule_appointment`.
4. **Ask ADAR** — `shared-chat` as a fallback for anything outside the
   structured booking flow.

## Suggested phasing

1. **`shared-chat` package** — build once, unlocks "Ask ADAR" + rules/FAQ
   screens in all three apps immediately.
2. **One real home screen per app** — replace the placeholder with the
   dashboard/landing screen listed first under each app above. This is the
   moment each app stops looking like a login demo.
3. **Core flows per app** — ARCL: schedule + standings + roster. Geetabitan:
   song search + detail. Front Desk: the booking flow end-to-end (this one
   has real business value — it's the only app with a transactional flow).
4. **Polish** — real splash screens (replace the `return null` TODOs), app
   icons for ARCL and Front Desk (Geetabitan already has one — same process
   can be reused), push notifications (match reminders / appointment
   reminders) as a stretch goal.

## Not yet decided / needs your input before building

- Push notification requirements (ARCL match alerts? appointment reminders?)
  — out of scope until you want it.
- Whether Front Desk's booking flow needs offline/poor-connectivity
  handling (clinic wifi, etc.) given it's the one app with real
  transactions.
- App Store / Play Store release plan — deliberately not addressed here;
  that was the other option on the table.
