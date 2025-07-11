# SonicVote

A shared music queue. A host creates a Space and shares the link. Listeners join with a nickname, search Spotify, add songs and vote. The host's browser plays the most-voted song next, and every change shows up live for everyone.

- `client/`: React 19, Vite, TypeScript, Tailwind CSS, TanStack Query, Socket.IO client
- `server/`: Express 5, TypeScript, Prisma 7 (PostgreSQL), Socket.IO, Zod
- [PLAN.md](PLAN.md): the build plan and the decisions behind it

## How it works

| Who | Needs | Can do |
|---|---|---|
| Host | Spotify **Premium**, on the app's tester list (see below) | Create spaces, play music in the browser, skip, remove songs, clear the queue |
| Listener | Just the link and a nickname | Search, add songs, vote |

- **Votes:** upvote or downvote songs. Each song's score = upvotes − downvotes, except that downvotes on a **Pro** member's song count 0.4 (`PRO_DOWNVOTE_WEIGHT` in `server/src/config.ts`). Highest score plays next; ties go to the song added first.
- **Vote limit:** 5 votes (up or down) per space, then a 5-minute cooldown (4 minutes for Pro). Removing a vote doesn't give it back.
- **Queue:** up to 20 songs. The same song can't be queued twice. "Recently played" lets anyone add a past song again.
- **Vote to skip:** if more than half the people present (and at least 2) vote to skip the song playing, it's skipped. Pro protection doesn't apply here.
- **Host tools:** see who's here, remove (ban) people, and change settings per space: queue size, votes per person, and locking the queue so only the host adds songs.
- **Live:** every change reaches everyone in the space over Socket.IO: the queue, the host's playback progress, who's here, and emoji reactions.
- **Invite:** a QR code, with a full-screen mode for a TV at the party.
- **Host insights** at `/insights`: every host sees songs played and peak crowd per party for free. **Pro Host** unlocks top and most-downvoted songs, skips (by host or by the room), reactions, top requesters, and crowd and votes over time. Nobody's individual votes are ever shown.
- **Admin dashboard** at `/admin`, for accounts listed in `ADMIN_SPOTIFY_IDS`: live spaces and listeners, totals, revenue and 30-day charts.
- **Player:** Spotify's Web Playback SDK only works in **desktop** browsers (Chrome, Edge, Firefox). Listeners can use phones.

## Requirements

- Node.js 22+
- Docker (for PostgreSQL)
- A Spotify account with Premium (for hosting)

## Run locally

```sh
# 1. Database (Postgres on port 5433, so it won't clash with another local Postgres)
docker compose up -d

# 2. Server
cd server
cp .env.example .env    # then fill it in (see below)
npm install             # also generates the Prisma client
npm run db:migrate      # creates the tables
npm run dev             # http://127.0.0.1:4000

# 3. Client (new terminal)
cd client
npm install
npm run dev             # http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173**, not `localhost`. The session cookie is tied to the host name, and Spotify only accepts `127.0.0.1` redirect URIs.

The client needs no `.env`: in development Vite forwards `/api` and `/socket.io` to the server.

## Fill in `server/.env`

| Variable | Where it comes from |
|---|---|
| `JWT_SECRET`, `TOKEN_ENCRYPTION_KEY` | Run `openssl rand -hex 32` once for each |
| `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET` | Spotify setup, below |
| `RAZORPAY_*` | Optional. Razorpay setup, below. Leave empty to turn payments off. |
| `ADMIN_SPOTIFY_IDS` | Optional. Your Spotify user id, to open `/admin`. See "Admin dashboard" below. |

The server checks every value on startup and stops with a clear message if one is missing or malformed.

## Spotify setup

1. Go to [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) and **Create app**.
2. **Redirect URI:** `http://127.0.0.1:4000/api/auth/spotify/callback` (exactly this; Spotify rejects `localhost`).
3. **APIs used:** tick **Web API** and **Web Playback SDK**.
4. Open the app's **Settings**, copy the **Client ID** and **Client secret** into `server/.env`.
5. **User Management:** add the Spotify email of **every host**, including yourself.

**Development mode.** New Spotify apps are in development mode: only accounts on the User Management list can log in. Everyone else gets sent back with "This Spotify account isn't on the app's tester list". Spotify only gives public access (extended quota) to registered organisations, so plan on staying in development mode. This is why **listeners never log in with Spotify**: they join as guests, so the tester limit only applies to hosts.

**Playback needs Premium.** A host without Premium sees "Playback needs Spotify Premium"; search and voting still work for everyone.

## Razorpay setup (optional)

Two monthly plans: **Pro (₹39)** for a 4-minute vote cooldown, downvote protection (0.4×) and a Pro badge; and **Pro Host (₹49)** for everything in Pro plus host insights. Prices live on the Razorpay Plans, not in code. Payments stay off until `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_PLAN_ID` and `RAZORPAY_WEBHOOK_SECRET` are set; Pro Host also needs `RAZORPAY_HOST_PLAN_ID`. Upgrading from Pro to Pro Host cancels the Pro subscription once Pro Host is active (no proration).

1. Create a [Razorpay](https://dashboard.razorpay.com) account and switch to **Test Mode**.
2. **API keys:** Account & Settings → API Keys → generate. Put them in `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
3. **Plans:** Subscriptions → Plans → create two monthly plans (Pro and Pro Host). Put their ids (`plan_…`) in `RAZORPAY_PLAN_ID` and `RAZORPAY_HOST_PLAN_ID`.
4. **Webhook:** Razorpay can't reach `127.0.0.1`, so expose the server with a tunnel:

   ```sh
   cloudflared tunnel --url http://127.0.0.1:4000     # or: ngrok http 4000
   ```

   In Account & Settings → Webhooks, add `https://<your-tunnel>/api/billing/webhook`, pick a secret (put it in `RAZORPAY_WEBHOOK_SECRET`), and enable the events `subscription.activated`, `subscription.charged`, `subscription.cancelled`, `subscription.halted`, `subscription.completed` and `refund.processed` (for net revenue in the admin dashboard).
5. Restart the server. A "Go Pro" button appears for Spotify users.
6. **Paying in test mode:** a subscription needs permission to charge every month. In our test run, the test card was refused ("This card is not eligible for recurring payments") and test UPI made only a one-time payment, so the subscription never started. **eMandate** worked: pick any test bank and choose Success. If nothing works, ask Razorpay support to enable recurring payments on the account.

If Razorpay activates a subscription late (it can take a minute or two after paying), the app still finds out without the webhook: while a checkout is pending, the page asks the server to check Razorpay directly (`/api/billing/sync`).

How paid status is set: right after checkout the browser sends Razorpay's signed payment details to `/api/billing/verify`. The server checks the signature and asks Razorpay for the subscription's status itself. Renewals and cancellations arrive by webhook, and each webhook's signature is checked against the raw request body. Nothing the browser says is trusted on its own.

Live mode needs KYC in the Razorpay dashboard. Note that Spotify's Developer Terms restrict charging for apps built on Spotify content, so check them before taking real payments.

## Admin dashboard

1. Find your Spotify user id: in the Spotify app, open your profile → ⋯ → Share → Copy link to profile. The id is the part after `/user/`.
2. Put it in `server/.env` as `ADMIN_SPOTIFY_IDS=<your id>` (comma-separate several admins) and restart the server.
3. Log in with Spotify. "Admin dashboard" appears in your account menu.

Anyone else, including guests, gets a plain "not found" for `/admin` and its API. Days in the charts are counted in India time (`REPORT_TIMEZONE` in `server/src/config.ts`). MRR needs Razorpay set up, since the plan price comes from Razorpay.

## Tests

```sh
cd server
npm test
```

Needs the Docker database running. Tests use a separate `sonicvote_test` database (created automatically) and never read `server/.env`. They cover the vote limit (including parallel requests), Pro-weighted downvotes, queue rules, host settings, bans, vote to skip, recently played, host-only access, "play next", realtime events (presence, reactions, removal), the Razorpay webhook and payments, the admin dashboard and the login redirect.

## Project layout

```
server/src/
  app.ts        Express app and routes
  index.ts      HTTP server + Socket.IO
  config.ts     env validation, vote limits
  auth.ts       Spotify login, guest join, sessions
  spotify.ts    all Spotify Web API calls
  spaces.ts     spaces, queue, votes, play next
  votes.ts      the vote-limit rule
  queue.ts      ranking (weighted score) and "play next"
  realtime.ts   Socket.IO rooms, presence, reactions
  player.ts     host's player token
  billing.ts    Razorpay, payment records
  admin.ts      admin dashboard API
  insights.ts   host insights API
client/src/
  pages/        Landing, Home (your spaces), Space (listener + host view), Insights, Admin
  components/   UI kit, top bar, billing, space/ (queue, search, player, …)
  lib/          API client, hooks (socket, FLIP animation, debounce)
```
