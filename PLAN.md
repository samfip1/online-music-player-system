# SonicVote: Implementation Plan

## Check these before you build

1. **Premium for playback is correct.** The Web Playback SDK only works for Premium users. Spotify also removed `preview_url` for new apps in Nov 2024, so 30-second previews aren't an option. **Settled: you have Premium, so full playback works when you host.** Keep the Premium message for other people who host on a free account.
2. **The tester cap is correct, and it's stricter than it sounds.** Since 2025, Spotify only grants extended quota (public access) to registered organizations with a large user base. A solo developer should expect to stay in development mode permanently. Check the current user cap in your dashboard, because Spotify has lowered it before. In practice this is a demo or friends-only app. **Settled: only the host logs in with Spotify. Listeners join as guests with a nickname**, so the tester cap applies only to hosts, and there's no limit on listeners.
3. **The vote limit contradicts itself.** One description says "up to 5 votes *counted at once*", but the spec says removing a vote doesn't refund it. Those are two different rules. This plan uses the spec's version: 5 votes cast per cooldown window, with no refunds.
4. **Payments: Razorpay instead of Stripe.** Spotify's Developer Terms restrict charging for apps built on their content, and selling faster voting is a grey area. Payments stay last in the plan so they're easy to cut. Razorpay test mode works right away; live mode needs KYC (business or individual verification) in the Razorpay dashboard.
5. **Pro price: ₹30 or ₹40 a month (recommendation: ₹39).** The price is set on the Razorpay Plan in the dashboard, not in code, so it can change without a deploy. Razorpay keeps about 2% plus GST per payment, so ₹39 nets about ₹38. Pro perks: 4-minute vote cooldown, Pro badge, and downvote protection (phase 16).
6. **Pro downvote protection: settled at 0.4.** Each downvote on a song added by a Pro user counts as `PRO_DOWNVOTE_WEIGHT = 0.4` instead of 1, so it takes about 2.5 downvotes to cancel one upvote. That's clear protection for people who pay, while a whole room can still push a bad song down. (0.2 was considered: 5 downvotes per upvote made Pro songs close to impossible to sink.) It's one config value, so adjust after watching real parties.

---

## Phase 0: Setup (about half a day)
- [x] Create `/client` (Vite React TS + Tailwind + React Router + TanStack Query) and `/server` (Express TS, tsx for dev, Vitest).
- [x] Add a `docker-compose.yml` with only Postgres.
- [x] Add `server/src/config.ts`: read env once and validate it with Zod. Put `VOTE_LIMIT`, `COOLDOWN_FREE_MS` and `COOLDOWN_PAID_MS` here.
- [x] Add `.env.example` files and a README skeleton.
- **Skip:** a monorepo tool (Turborepo, workspaces), a shared types package (copy the few types you need), ESLint config work.

## Phase 1: Database (about half a day)
- [x] Write the Prisma schema from the spec, then run `prisma migrate dev`, with these changes:
  - `User.spotifyId` becomes **optional** (guests don't have one), and `User` gets `isGuest Boolean @default(false)`.
  - Use generic track columns on `QueueItem`: `trackId`, `trackUri` instead of `spotifyTrackId`, `spotifyUri`. Only search and the host player know the data comes from Spotify (see "Mobile app later").
- [x] Put `currentItemId` and `currentStartedAt` directly on `Space` instead of a separate `CurrentTrack` table. It's always one row per space, so a table adds a join for nothing. Keep the table only if you want the spec followed exactly.
- [x] Add indexes on `QueueItem(spaceId, played)` and on the `Vote` unique pair.
- **Skip:** `Space.isActive` until something reads it.

## Phase 2: Auth (about 1 day)
- [x] `GET /auth/spotify/login`: redirect to Spotify with a `state` value stored in a short-lived cookie, and check it in the callback (CSRF protection).
- [x] `GET /auth/spotify/callback`: exchange the code, call `/v1/me`, upsert the User, and encrypt the refresh token with AES-256-GCM (Node `crypto`, no extra library). Set the JWT as an httpOnly, SameSite=Lax cookie.
- [x] `POST /auth/guest` with body `{ displayName }` (Zod-validated, 1–30 characters): create a guest User and set the same JWT cookie. Guests can search, add songs and vote, but can't create Spaces or host.
- [x] Add `requireAuth` middleware, `GET /auth/me` and `POST /auth/logout`.
- [x] `POST /spaces` and all host-only routes reject guests. Only Spotify-logged-in users can host.
- [x] Set up CORS with `origin: CLIENT_URL, credentials: true`.
- **Skip:** Passport and session stores. `jsonwebtoken` plus `cookie-parser` is enough.

## Phase 3: Spotify search proxy (about half a day)
- [x] A `getAppToken()` function that caches a Client Credentials token in memory until about 60 seconds before it expires.
- [x] `GET /search?q=`: validate `q` with Zod, return a trimmed track shape (id, uri, title, artists, art, durationMs).
- [x] `getTrack(id)`: used by the add-to-queue endpoint, so the server never trusts metadata sent by the client.
- **Skip:** Redis or any cache library. One variable holds the token.

## Phase 4: Spaces and queue (about 1 day)
- [x] Spaces CRUD. `DELETE` checks `space.hostId === req.user.id`.
- [x] A shared `requireHost` helper used by every host-only route.
- [x] `POST /queue`: inside a transaction, reject when there are already 20 unplayed items or the track is already in the unplayed queue. Return 409 or 422.
- [x] `GET /queue`: queue items with vote counts, sorted by votes descending then `createdAt` ascending, plus now playing, the user's own vote ids and their quota.
- [x] Host-only remove-item and clear-queue endpoints.
- [x] `POST /next`: in a transaction, pick the top item, set `played=true` and `playedAt`, and update the space's current track. Two quick "next" calls must not skip two songs: lock the space row (`SELECT ... FOR UPDATE`), and the client sends `{ currentItemId }` (the song it thinks is playing); if that's no longer current, the call changes nothing.

## Phase 5: Vote limit (about 1 day, the most important part)
- [x] In one transaction:
  1. Upsert the `VoteQuota` row, then lock it with `SELECT ... FOR UPDATE`.
  2. If `lockedUntil > now`, return **429** with `{ lockedUntil }`.
  3. If `lockedUntil <= now` (the cooldown has passed), reset `votesUsed=0` and `lockedUntil=null`.
  4. Insert the Vote. A unique-constraint error returns 409.
  5. Increment `votesUsed`. If it reaches `VOTE_LIMIT`, set `lockedUntil = now + (isPaid && paidUntil > now ? PAID : FREE)`.
- [x] Unvote deletes the Vote and leaves the quota alone (no refund).
- [x] Tests (Vitest + Supertest against a real test database, with a fake clock via `vi.useFakeTimers` or an injected `now()`):
  - 5 votes, then locked
  - 429 while locked
  - reset after the cooldown
  - 4-minute cooldown for paid users
  - unvoting doesn't refund
  - 6 parallel votes → exactly 5 succeed
- **Skip:** a cron job to reset cooldowns. Step 3 handles the reset lazily when the user next votes.

## Phase 6: Realtime (about half a day)
- [x] Socket.IO on the same HTTP server, authenticated with the same JWT cookie. A client joins the room `space:<id>`.
- [x] After every mutation, emit **one** event: `io.to(room).emit('queue:changed')`.
- [x] The client handles it with `queryClient.invalidateQueries(['queue', id])`.
- [x] Added: `player:state`, the host's playback position, relayed only from the verified host. The server keeps the last state so late joiners get it immediately. Listeners use it for a live progress bar.
- Why not push the full queue state? The response contains per-user fields (my votes, my quota), so a single broadcast payload would be wrong for everyone except one user. Invalidating and refetching is simpler and correct. Only socket events trigger a refetch, so this is not polling.

## Phase 7: Frontend (about 2 to 3 days)
- [x] `/`: a landing page with the login button.
- [x] `/home`: a list of my spaces and a create form.
- [x] `/space/:id`:
  - if the viewer isn't logged in, show a "Join" form asking for a nickname (calls `/auth/guest`), with a small "Host? Login with Spotify" link
  - a debounced search (300 ms, a small `useDebounce` hook with no library) with results and an Add button
  - the queue with vote toggles
  - a now-playing card
  - "Votes left N/5" with a countdown computed from `lockedUntil` using a 1-second interval
- [x] `/space/:id/host`: the same view plus the player and host controls. Redirect to the listener view if `me.id !== space.hostId`.
- [x] Dark Tailwind theme with a mobile-first layout.
- **Skip:** a component library, Redux or Zustand (TanStack Query holds the server state), optimistic updates in the first version.

## Phase 8: Web Playback SDK (about 1 to 2 days, the trickiest part)
- [x] `GET /spotify/player-token` (host only): refresh the access token from the stored refresh token and cache it until it expires.
- [x] Load the SDK script. Its `getOAuthToken` callback calls that endpoint.
- [x] On `ready`, get the `device_id`, then call `PUT /me/player/play?device_id=…` with the current track's URI.
- [x] Handle `account_error`: show "Playback needs Spotify Premium" and keep the rest of the page working.
- [x] Send `{ currentItemId }` with every `/next` call (see phase 4), so a song-end and a skip firing together only advance once.
- [x] Detect the end of a track. `player_state_changed` has no "ended" event: look for `paused && position === 0` right after the track was playing. It fires several times, so guard it with a ref to avoid double-calling `/next`.
- [x] Add a Skip button that calls `/next`.

## Phase 9: Razorpay (about 1 day, cut or postpone this)
- [x] In the Razorpay dashboard (test mode): enable Subscriptions and create a monthly Plan. Put `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID` and `RAZORPAY_WEBHOOK_SECRET` in the server `.env`.
- [x] `POST /billing/checkout` (Spotify users only, not guests): call `razorpay.subscriptions.create({ plan_id, total_count: 12, notes: { userId } })` and return `{ subscriptionId, keyId }`.
- [x] The client loads `https://checkout.razorpay.com/v1/checkout.js` and opens the Razorpay checkout with `subscription_id`.
- [x] `POST /billing/verify`: right after checkout, the browser sends Razorpay's signed payment details. The server checks the signature, then fetches the subscription from Razorpay itself, so Pro turns on at once. The browser's word alone is never trusted.
- [x] `POST /billing/webhook` handles renewals and cancellations:
  - Use `express.raw()` for this route **before** `express.json()`.
  - Verify the `X-Razorpay-Signature` header: HMAC-SHA256 of the raw body with `RAZORPAY_WEBHOOK_SECRET`, compared with `crypto.timingSafeEqual`.
  - Find the user from `subscription.notes.userId`.
  - `subscription.charged`: set `isPaid = true` and `paidUntil = current_end * 1000`.
  - `subscription.cancelled`, `subscription.halted`, `subscription.completed`: set `isPaid = false`.
  - Razorpay can send the same event more than once, so the handler must be safe to run twice (it is, since it only sets values).
- [x] Store `razorpaySubscriptionId` on User so a cancel button can call `razorpay.subscriptions.cancel(id)` later.
- [x] Show a Pro badge. `isPaid` is included with users in the queue response.
- Until this is built, a manual `isPaid` flag in the database is enough to test the vote-limit logic.

**Tested with real Razorpay test keys on 2026-09-22:** checkout → eMandate payment → Pro turned on at once through `/billing/verify` → payment stored → 4-minute cooldown and downvote protection active → admin MRR ₹39 → cancel renewal (Pro kept until the paid period ends). The webhook wasn't tested end to end (it needs a tunnel and a webhook added in the Razorpay dashboard); it's covered by automated tests with signed payloads.

## Phase 10: README
- [x] Spotify dashboard setup: redirect URI `http://127.0.0.1:4000/api/auth/spotify/callback`. Spotify no longer accepts `localhost`; use the loopback IP. Explain that only **hosts** must be added as test users; listeners join as guests.
- [x] Razorpay test mode: creating the Plan, adding the webhook in the dashboard, and test cards/UPI. Razorpay has no CLI for local webhooks, so expose the server with a tunnel (`cloudflared tunnel --url http://127.0.0.1:4000` or ngrok) and use that URL as the webhook address.
- [x] How to run: `docker compose up`, `prisma migrate`, then `npm run dev` in both apps.

---

## Rules for the whole build
- The frontend never calls Spotify directly, except the SDK on the host page.
- Never trust a user id or track metadata sent by the client.
- No polling. No 30-second preview fallback.
- No microservices, job queue, Redis, or shared-types package.
- Tests: one focused file per server feature (currently votes, queue, realtime, billing). No frontend test suite.

## Mobile app later
- On mobile, hosts would still need Premium: Spotify's mobile SDK only lets free accounts shuffle, not pick a song.
- The bigger blocker is the tester cap. A public app store release needs Spotify's extended quota, which individual developers can't get. So a public mobile app where anyone can host isn't possible on Spotify today.
- Spotify is used in exactly two places: the search proxy (phase 3) and the host player (phase 8). Queue, votes, quota, realtime and billing don't depend on it. Switching to YouTube (IFrame player + Data API; free quota is about 100 searches a day, so cache searches) means rewriting only those two parts.
- Decide the music source when starting the mobile app. Don't build a provider abstraction now.
- Guest trade-off: a guest can open a private window, rejoin, and get 5 more votes. That's fine for a friends app. If it matters later, make Spotify login optional for listeners.

## Suggested order (phases 0–10)
0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8, then 9 → 10.

The app is usable after phase 8, so phase 9 (Razorpay) is optional.

---

# Next: new features

Phases 0–10 are built. What follows is the plan for the next round. Each phase lists what to build, what to skip, and how to check it.

## Phase 11: Test with real Spotify keys — passed on 2026-09-21 (login, search, playback, auto-next, double-skip, skip-at-song-end race, guest progress)
Everything below builds on the player, and the player has only been checked against fake data.
- [x] Create the Spotify app (see README), put the keys in `server/.env`, add yourself under User Management.
- [x] Log in as host, create a Space, search, add 3 songs, start the player.
- [x] Let a song end on its own: the next top-voted song must start by itself, exactly once.
- [x] Press Skip during a song, and press it twice quickly: it must advance one song only.
- [x] Open the Space on your phone as a guest: vote, and watch the progress bar move.
- [x] Fix whatever the end-of-song detection gets wrong. It's the riskiest part, since it relies on how Spotify reports player state.

## Phase 12: Recently played (about half a day)
"What was that song?" The data already exists: played songs have `played = true` and `playedAt`.
- [x] Add an index on `QueueItem(spaceId, playedAt)`.
- [x] `GET /spaces/:id/history`: the last 20 played songs, newest first, not counting the one playing now.
- [x] The client refetches it on the same `queue:changed` event (it already fires on every "next").
- [x] UI: a collapsible "Recently played" card under the queue, showing art, title, artists and "12 min ago".
- [x] "Add again" button on each row, using the existing `POST /queue`, so it gets the same limits and duplicate check.
- **Skip:** a full history page, stats, exporting to a Spotify playlist.
- **Check:** one test that history is ordered newest first and excludes the current song.

## Phase 13: Now-playing reactions 🔥 👏 (about half a day)
Makes it feel social. Nothing is stored.
- [x] A fixed list of about 6 emojis on the server. Any other value is ignored.
- [x] Socket event `reaction` `{ spaceId, emoji }`: the server only relays it if the socket has joined that room, then emits it to the room.
- [x] Limit each socket to about 5 reactions every 3 seconds (a counter on `socket.data`). Anything over is dropped silently.
- [x] UI: a row of emoji buttons under the now-playing card, and emojis float up and fade over the album art. Cap how many are on screen (about 30) so a spammer can't freeze phones.
- [x] Respect "reduced motion": show a small counter instead of the animation.
- **Skip:** saving reactions, reaction counts, reacting to queue songs.
- **Check:** a realtime test that the relay works, unknown emojis are dropped, and the rate limit drops extras.

## Phase 14: QR code invite (about 2 hours)
Parties happen in person.
- [x] Add the small `qrcode` package to the client (drawing a QR code by hand isn't worth it).
- [x] The "Invite" button opens a modal with a large QR code of `/space/:id`, the link, and a Copy button.
- [x] A "Show on big screen" button makes the QR code full-screen for a TV or laptop at the party.
- **Skip:** server-side QR images, custom QR styling.

## Phase 15: Who's here + kick/ban (about 1 day)
Guests are cheap to create, so the host needs a way to stop a troll. The skip vote (phase 17) and the admin dashboard (phase 19) need the head count too.
- [x] **Presence:** the server tracks which users have a socket in each Space's room (in memory, from join and disconnect). It emits `presence` `{ count, users: [{ id, displayName, isPro }] }` whenever someone joins or leaves.
- [x] UI: a "12 here" pill in the top bar. The host can tap it to see the list.
- [x] Add a `SpaceBan(spaceId, userId, createdAt)` table with `@@id([spaceId, userId])`.
- [x] `POST /spaces/:id/bans { userId }` and `DELETE /spaces/:id/bans/:userId`, both host-only. The host can't ban themselves.
- [x] On ban, in one transaction: save the ban, and delete that user's votes on unplayed songs (a troll's votes shouldn't keep counting). Their added songs stay; the host can remove those one by one.
- [x] Banned users get a 403 on GET queue, add song, vote and socket join. Their open sockets get a `removed` event and leave the room, and the page shows "The host removed you from this space".
- [x] Host UI: a "Remove person" action in the people list, with a "Removed" section and "Allow back".
- [ ] Not built: a "Remove person" button on queue rows. A second small button per row was too easy to confuse with "remove song"; add it if hosts ask.
- **Limit (write it in the UI help text):** a ban is per account. A guest can open a private window and rejoin under a new name. Stopping that needs Spotify login for listeners or device fingerprinting; skip both for a friends app.
- **Skip:** a separate "kick" (kick = ban; the host can unban), ban reasons, a global ban list.
- **Check:** tests that a banned user is blocked on every route and their votes are gone.

## Phase 16: Downvotes, with protection for Pro users (about 1½ days)
Lets the room push a bad song down, without letting a crowd bury someone who pays.
- [x] **Score, not count.** Each song's score = upvotes − downvotes × weight. The weight is 1 for songs added by free users and `PRO_DOWNVOTE_WEIGHT` (0.4) for songs added by Pro users (see point 6 at the top). Examples:

  | Song added by | Upvotes | Downvotes | Score |
  |---|---|---|---|
  | Free user | 2 | 4 | 2 − 4 = **−2** |
  | Pro user | 2 | 4 | 2 − 1.6 = **0.4** |
  | Pro user | 0 | 10 | 0 − 4 = **−4** |

- [x] Put `PRO_DOWNVOTE_WEIGHT = 0.4` in `config.ts` next to the vote limits.
- [x] Pro status is checked when the queue is ranked, not when the vote was cast. If a Pro subscription ends, their songs lose the protection from then on.
- [x] Protection applies to the **song's adder**, not the voter. A Pro user's downvote weighs the same as anyone's.
- [x] Database: add `value Int` (+1 or −1, default +1) to `Vote`. Keep `@@unique([userId, queueItemId])`: one vote per person per song, up or down. Changing from up to down is an update, not a second vote.
- [x] **Downvotes use the same 5-vote quota.** Otherwise people could downvote without limit. Switching an upvote to a downvote counts as a new vote, since removals aren't refunded.
- [x] Ranking: Prisma can't sort by a weighted score, so load the unplayed songs (20 at most) with their votes and sort in one shared `rankQueue()` function: score, then earliest added. Use it for both `GET /queue` and `/next`, so the display and "plays next" always agree.
- [x] The queue response adds `upvotes`, `downvotes`, `score`, and `myVote` per song (`1`, `-1` or `null`).
- [x] UI: ▲ score ▼ controls on each row. Songs with a negative score fade slightly. Pro songs show a small shield icon with the tooltip "Pro: downvotes count less".
- [x] Update the Pro upsell text: "4-minute cooldown, Pro badge, downvote protection".
- **Skip:** auto-removing songs below a score (the host can remove songs), downvoting the song that's playing (that's the skip vote, phase 17).
- **Check:** tests for the score math (free vs Pro, with the weight from config), that downvotes use the quota, that switching up→down counts as a vote, that expired Pro loses protection, and that `/next` picks the top score.

## Phase 17: Vote to skip (about 1 day)
Lets the room vote out the song that's playing. Downvotes (phase 16) only affect songs still waiting.
- [x] Add a `SkipVote(queueItemId, userId)` table, unique per pair, deleted along with its song.
- [x] `POST /spaces/:id/skip-vote`: votes to skip the song playing now. It doesn't use the normal vote quota.
- [x] Threshold: more than half of the people present (from phase 15), and at least 2 votes. The host's own skip button still works instantly.
- [x] When the threshold is reached, the server runs the same logic as `/next` (with `currentItemId`, so it can't double-skip). Move that logic out of the route into a function both can call. The host's player then plays the new song through the existing flow.
- [x] UI: a "Skip · 3/6" button on the now-playing card, and a toast for everyone: "The room skipped this song".
- [x] Pro protection doesn't apply to skip votes: if more than half the room wants a song gone, it goes, whoever added it. Otherwise one Pro user could force a song on a whole party.
- **Skip:** blocking a skipped song from being re-added.
- **Check:** tests that the threshold uses the head count, a user can't vote twice, and reaching it advances exactly one song.

## Phase 18: Host settings per Space (about 1 day)
Different parties need different rules.
- [x] New columns on `Space` with defaults matching today's values: `maxQueue` (20, allowed 5–50), `voteLimit` (5, allowed 1–20), `queueLocked` (false: when true, only the host can add songs).
- [x] `PATCH /spaces/:id`, host-only, validated with Zod. Emit `queue:changed` so everyone sees the new limits.
- [x] Replace the fixed `MAX_QUEUE` (in `spaces.ts` and the client) and `VOTE_LIMIT` (in `votes.ts`) with the Space's values. The quota response already sends `limit`, so the "N/5" display follows.
- [x] Rule for changes mid-party: a new vote limit applies from each person's next vote. A cooldown that's already running isn't shortened.
- [x] Cooldown lengths stay global: the Pro 4-minute cooldown is what people pay for.
- [x] UI: a "Settings" panel in the host view with two number steppers and a "Lock queue" switch.
- **Skip:** per-space cooldowns, saving settings as templates.
- **Check:** update the existing vote and queue tests to use per-space limits; add one test for a locked queue.

## Phase 19: Admin dashboard (about 2 days)
One page, visible only to you, showing everything live: spaces, hosts, listeners, activity and revenue.
- [x] **Decision: a built-in `/admin` page, not Grafana.** It reuses the same login, server and sockets, and needs no extra services. Grafana would need Prometheus (or Grafana Cloud), a `/metrics` endpoint and a separate login. Keep Grafana as a later option (see Skip).
- [x] **Who is admin:** an `ADMIN_SPOTIFY_IDS` env value (comma-separated Spotify ids, starting with yours). Checked on the server for every admin request and socket. Guests can never be admin. Non-admins get a 404 (not 403), so the page's existence isn't revealed.
- [x] **Store payments** (needed for revenue): a `Payment(id = Razorpay payment id, userId, amount in paise, currency, status, createdAt)` table. Fill it from the `subscription.charged` webhook (the event includes the payment) and from `/billing/verify`. The Razorpay payment id is the primary key, so repeated webhooks don't double-count. Also save refunds from the `refund.processed` webhook, so revenue shows net figures.
- [x] `GET /api/admin/stats` returns:
  - **Live now** (from the presence data in phase 15): spaces with people in them, the number of listeners and hosts online, and per live space: name, host, head count, song playing, queue length.
  - **Totals:** hosts, guests, spaces, songs played, votes cast (up/down), each for today, the last 7 days and all time.
  - **Revenue:** active Pro members, MRR (active Pro × plan price), collected this month and all time (net of refunds), and the latest 20 payments.
  - **Daily charts for the last 30 days:** new users, songs played, revenue.
- [x] **Live updates:** admin sockets join an `admin` room. The server pushes presence changes there at most once every 2 seconds, so the "live now" section moves on its own. Totals and charts reload every 30 seconds. That's a deliberate exception to the "no polling" rule: it's one admin, and those numbers change slowly.
- [x] **UI (`/admin`):**
  - A row of stat tiles: live listeners, live spaces, active Pro, MRR, revenue this month.
  - A "Live spaces" table.
  - Three small charts (users, plays, revenue).
  - A "Recent payments" table.
  - Load the admin page as a separate chunk (`React.lazy`), so normal users never download its code or chart library.
- [x] **Privacy:** show host emails only to the admin, never in public API responses (which already leave out email). No per-user activity log.
- **Skip:**
  - Grafana/Prometheus: add a `/metrics` endpoint (`prom-client`) later if you want server health (CPU, memory, response times) next to product numbers.
  - Admin actions (banning users app-wide, refunds): refunds happen in the Razorpay dashboard.
  - Several admin roles.
- **Check:** tests that non-admins and guests get 404 on every admin route and socket, that a repeated payment webhook is counted once, and that refunds are subtracted.

## Phase 22: Host insights + Pro Host plan — built and tested 2026-09-22 (real ₹49 test payment, insights unlocked)
A dashboard for hosts about their own parties. Decided: a **Pro Host bundle at ₹49/month** (Pro perks + insights) next to **Pro at ₹39/month**; one subscription per person; basic numbers free; names only as "top requesters".
- [x] **Plans:** a second Razorpay Plan (₹49) in `RAZORPAY_HOST_PLAN_ID`. The tier comes from the subscription's `plan_id` as reported by Razorpay, never from the browser. `User.proPlan` = `pro` or `pro_host`; Pro Host includes every Pro perk.
- [x] **Upgrading from Pro:** checkout for Pro Host notes the old subscription; when the new one is active, the old one is cancelled immediately so nobody pays twice. No proration: the rest of the ₹39 month isn't refunded (a small cost of keeping billing simple).
- [x] **New data, recorded from now on:**
  - `QueueItem.skipReason`: `host` (host pressed Skip) or `room` (vote to skip). A song that ends normally stays empty. The host's player now says whether a `/next` is a song end or a skip.
  - `QueueItem.reactions`: count of reactions while it was playing.
  - `Space.peakPeople`: the biggest crowd seen.
  - `PresenceSample(spaceId, at, people)`: head count once a minute while anyone is in a Space, for "crowd over time".
- [x] `GET /api/host/insights?spaceId=` (host's own Spaces only):
  - **Free:** per Space: songs played, peak crowd, created date.
  - **Pro Host only (enforced on the server):** top songs (score), most downvoted, most skipped (by host / by room), most reactions, top requesters (nickname, songs added, upvotes received), crowd over time, votes over time, totals (upvotes, downvotes, reactions, skips, unique participants).
- [x] **Privacy:** no record of who voted how is ever shown; only nicknames in "top requesters".
- [x] **UI:** `/insights` page (separate chunk) with a Space picker; locked sections show a blurred preview and "Upgrade to Pro Host ₹49". The Pro card offers both plans. Admin revenue counts both plans (MRR = Pro × ₹39 + Pro Host × ₹49).
- [x] Added while testing: **payment sync.** Checkout stores the subscription as *pending*; `/billing/sync` asks Razorpay directly and promotes it once active (plus stores the payment from its invoice). The client calls it after checkout and on page loads while a payment is pending. Razorpay activated the real ₹49 subscription about a minute after paying, and without a tunnel no webhook arrives, so this is what switched Pro Host on.
- **Skip:** exporting data, comparing Spaces side by side, per-guest history.
- **Check:** tests for tier from `plan_id`, free vs paid fields, only your own Spaces, skip reasons, peak crowd, top requesters, upgrade cancelling the old subscription, admin MRR with two plans.

## Phase 20: Deploy (about 1 day)
So friends can join from anywhere.
- [ ] **One service:** in production, Express serves `client/dist` plus a catch-all that returns `index.html` for app routes. One origin means no CORS or cookie issues. The `secure` cookie flag already switches on for `https`.
- [ ] The server listens on `0.0.0.0` in production (today it's `127.0.0.1`), using a `HOST` env value. Add `app.set('trust proxy', 1)` behind the host's proxy.
- [ ] Build: install and build the client, then `prisma generate` and `tsc` for the server. On each release, run `prisma migrate deploy`.
- [ ] Hosting: Railway or Render for the app, plus their managed Postgres (or Neon). Health check: `/api/health`.
- [ ] Production env: set `CLIENT_URL` to the public URL, set `SPOTIFY_REDIRECT_URI` to `https://<domain>/api/auth/spotify/callback` (and add it in the Spotify dashboard), and use new secrets, not the dev ones.
- [ ] Razorpay: point the webhook at the real URL (the tunnel is no longer needed), and add the `refund.processed` event for the admin revenue numbers.
- [ ] Set `ADMIN_SPOTIFY_IDS` in production to your Spotify id.
- [ ] **Before sharing publicly, add rate limits:** guest join (e.g. 10 per IP per hour) and search (e.g. 30 per user per minute). Use `express-rate-limit`.
- [ ] Run **one** server instance. Socket rooms, presence, player state and token caches are in memory (marked `ponytail:` in the code). More than one instance would need the Socket.IO Redis adapter; add that only if one instance isn't enough.
- **Check:** after deploying, repeat the phase 11 checklist on the real URL.

## Phase 21: Mobile app (later)
- See "Mobile app later" above. Hosting a public app on Spotify isn't possible for an individual developer today, so decide on the music source (probably YouTube) when this starts.
- Only search (`server/src/spotify.ts`) and the host player (`HostPlayer.tsx`) would change. The API, votes, realtime, billing and admin work as they are.

## Suggested order (new features)
11 → 12 → 13 → 14 → 15 → 16 → 17 → 18 → 19 → 20.

- 11 comes first: everything else relies on the player actually working.
- 12–14 are small, visible wins.
- 15 comes before 17 and 19: the skip vote and the admin "live now" section both need the head count.
- 16 (downvotes) changes how the queue is ranked, so do it before 18 (host settings), which touches the same code.
- 19 (admin) before 20 (deploy), so you can watch the app from day one. Payments have to be stored before real money comes in, or early revenue won't show up in the dashboard.
- 20 can move earlier if friends need to join from elsewhere sooner. If so, add its rate limits before sharing the link, and add the `Payment` table before switching Razorpay to live mode.
