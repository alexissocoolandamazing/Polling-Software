# PulsePoll

PulsePoll is a mobile-first, real-time polling platform for live events. This repository contains a working vertical slice: authenticated poll administration, anonymous participant joins, transactional voting, live aggregate results, a projector presentation view, and a Cloudflare WebSocket relay for participant session-state notifications.

The architecture is designed with the product target of 600+ connected participants and burst voting in mind. **That capacity is not yet proven**; run the documented load profiles against a production-like Supabase/Vercel environment before using it for a large event.

## Stack

- Next.js App Router, React, strict TypeScript and Tailwind CSS
- Supabase PostgreSQL, Auth and Realtime for authoritative data, votes, admin metrics and presentation updates
- Cloudflare Worker + one hibernating Durable Object per live session for participant notifications
- Zod validation and PostgreSQL constraints/RLS
- Vitest for domain tests and k6 for load-test scenarios

## Local setup

Requirements: Node.js 22+, npm, a Supabase project, a Cloudflare account on the Workers Free plan, and optionally the Supabase CLI and k6.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy `.env.example` to `.env.local` and fill in the values from the Supabase project Connect/API settings.

3. Apply the committed migration. With a linked Supabase CLI project:

   ```bash
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push
   ```

   Alternatively, run `supabase/migrations/202609160001_initial_polling_schema.sql` once in the Supabase SQL editor. No other manual schema changes are required.

4. In Supabase Auth, create each administrator under **Authentication → Users**. Public self-registration is intentionally not exposed by the app. The database trigger creates the matching `profiles` row.

5. In **Realtime → Settings**, keep public channel access enabled for the presentation view. Participant phones do not subscribe to Supabase Realtime. Public broadcasts contain only session state and already-revealed aggregate invalidations; participant tokens, responses and hidden results are never broadcast. The migration also adds protected admin counter tables to the Realtime publication.

6. Configure the Cloudflare relay using the deployment section below. For local relay development, copy `relay-worker/.dev.vars.example` to `relay-worker/.dev.vars`, use the same secret in `.env.local`, set `NEXT_PUBLIC_REALTIME_RELAY_URL=http://localhost:8787`, then run `npm run dev:relay` in a second terminal.

7. Start the app:

   ```bash
   npm run dev
   ```

Open `http://localhost:3000`. Sign in at `/login`, create a poll and at least one question, add choice options, then launch a session.

## Environment variables

| Variable | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser + server | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser + server | Browser-safe publishable key |
| `SUPABASE_SECRET_KEY` | Server only | Privileged key for narrow join/state/vote APIs and the vote RPC |
| `NEXT_PUBLIC_SITE_URL` | Browser + server | Canonical origin used in QR codes, e.g. `https://poll.example.com` |
| `NEXT_PUBLIC_REALTIME_RELAY_URL` | Browser + server | Cloudflare Worker base URL; the client converts HTTPS to WSS |
| `REALTIME_RELAY_SECRET` | Server only | Shared secret used only by Vercel to authenticate relay notifications |

Never expose `SUPABASE_SECRET_KEY` or `REALTIME_RELAY_SECRET` through a `NEXT_PUBLIC_` variable or commit `.env.local`/`.dev.vars`.

## Routes

| Route | Purpose |
| --- | --- |
| `/` | Enter a six-character join code |
| `/login` | Supabase administrator sign-in |
| `/admin` | Poll list and creation |
| `/admin/polls/[id]` | Poll settings, questions, answer options and session launch |
| `/admin/sessions/[id]` | Live controls, QR code, participant/response metrics and results |
| `/session/[code]` | Anonymous mobile voting experience |
| `/session/[code]/present` | Full-screen presentation view |
| `/api/sessions/[code]/join` | Issues an opaque participant cookie and creates one session participant |
| `/api/sessions/[code]/state` | Returns sanitized current public state |
| `/api/sessions/[code]/vote` | Validates and submits a vote through the atomic database function |

## Architecture and integrity

- A 256-bit random participant token is stored only in an HttpOnly, SameSite cookie; PostgreSQL stores its SHA-256 hash.
- `submit_vote` checks session state, participant identity, active question, option ownership, answer shape, rate limit, duplicate rules and idempotency in one transaction.
- `responses(session_id, participant_id, question_id)` is unique. A repeated request ID returns the prior success; a new response is rejected unless the poll permits changes.
- Incremental `session_stats`, `question_stats`, `option_counts` and `rating_counts` tables make live result reads proportional to answer options rather than total votes.
- Participant phones open a receive-only WebSocket to the Durable Object for their six-character session code. The relay sends only a narrow `session_state` invalidation; the phone then fetches authoritative state from the existing Next.js state API.
- Host controls first commit to Supabase through the authenticated, RLS-protected admin path, then Vercel posts to the Worker with a server-only shared secret. Relay failure never changes or weakens the committed Supabase state.
- Participant sockets use Cloudflare's WebSocket Hibernation API. They reconnect with capped exponential backoff and temporarily poll the state endpoint every five seconds only while the relay is unavailable or unconfigured.
- Admin metrics continue using protected Supabase Postgres Changes. The presentation view continues using narrow Supabase Broadcast invalidations and fetches authoritative state. Participant browsers no longer consume Supabase Realtime connections.
- Admin tables remain behind owner-based RLS. Anonymous browser clients receive data only through the explicit server routes and public broadcast payloads.
- The privileged Supabase key is imported only by server-only modules.

## Validation commands

```bash
npm run typecheck
npm run typecheck:relay
npm run lint
npm test
npm run test:relay
npm run build
npm run build:relay
```

## Cloudflare relay deployment

The relay uses only a Worker and Durable Objects, with no paid add-ons. Keep the Cloudflare account on the Workers Free plan; do not enable a paid Workers plan for this setup.

1. Authenticate Wrangler with the intended Cloudflare account:

   ```bash
   npx wrangler login
   ```

2. Generate a long random secret locally. Do not paste it into chat or commit it:

   ```bash
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

3. Store that value as the Worker's encrypted secret:

   ```bash
   npx wrangler secret put RELAY_SHARED_SECRET --config relay-worker/wrangler.jsonc
   ```

4. Deploy the Worker and its Durable Object migration:

   ```bash
   npm run deploy:relay
   ```

5. Copy the deployed `https://...workers.dev` URL into Vercel as `NEXT_PUBLIC_REALTIME_RELAY_URL`. Add the same random value to Vercel as the server-only `REALTIME_RELAY_SECRET`, then redeploy the Next.js app so the public URL is included in the browser bundle.

`ALLOWED_ORIGINS` defaults to `*` because the participant socket is intentionally public and receive-only, and it carries invalidations rather than poll data. It can be narrowed to comma-separated exact site origins in `relay-worker/wrangler.jsonc` before deployment. The host notification endpoint is independently protected by the encrypted shared secret and a timing-safe comparison.

If the relay is not configured or is temporarily unavailable, participants fall back to five-second state polling. Voting still uses the existing secure Next.js API and atomic Supabase RPC; the relay never receives votes or participant tokens.

## Load-test harness

Install [k6](https://grafana.com/docs/k6/latest/set-up/install-k6/), create a dedicated poll session, select a question and open voting. Use a fresh session for each profile because normal polls reject a second response from the same participant.

```bash
k6 run -e BASE_URL=https://your-preview.example -e SESSION_CODE=ABC234 -e PROFILE=join load-tests/poll-session.js
k6 run -e BASE_URL=https://your-preview.example -e SESSION_CODE=ABC234 -e PROFILE=burst load-tests/poll-session.js
k6 run -e BASE_URL=https://your-preview.example -e SESSION_CODE=ABC234 -e PROFILE=stress load-tests/poll-session.js
k6 run -e BASE_URL=https://your-preview.example -e SESSION_CODE=ABC234 -e PROFILE=duplicate load-tests/poll-session.js
```

Profiles cover 600 joins, a 600-vote burst, 1,000-user headroom, and repeated idempotent submissions. The join profile measures HTTP join capacity, not 600 persistent Realtime WebSockets. Capture p95/p99 latency, failure rate, database CPU/IO, connection utilization and Realtime disconnects in a production-like environment before making capacity claims.

## Vercel deployment

Import the repository into Vercel, add all six environment variables for each desired environment, and redeploy after setting them. Set `NEXT_PUBLIC_SITE_URL` to the production domain so generated QR codes are correct. Set `NEXT_PUBLIC_REALTIME_RELAY_URL` to the deployed Worker URL and keep `REALTIME_RELAY_SECRET` server-only. Keep the Vercel function region close to the Supabase project region. Apply migrations before sending traffic to a deployment.

## Current limitations / next phase

- No CSV export, poll duplication, response reset, previous-session detail view, or free-text moderation/export yet.
- Question content is referenced from the poll rather than snapshotted per session; avoid editing a poll while one of its sessions is live.
- The simple participant cooldown is transactional and per participant, but join-route abuse still needs infrastructure-level rate limiting (for example, a Vercel WAF rule) before public exposure.
- A sustained Cloudflare outage would move participants to fallback polling, increasing Vercel/Supabase state-read traffic until WebSockets reconnect.
- Automated tests currently cover pure vote/realtime logic. A disposable Supabase project should be added to CI for database RPC/RLS integration tests and browser end-to-end tests.
- Relay reconnect/resynchronization is covered in client logic and Worker integration tests, but still needs browser network-chaos and 600-socket load testing in a production-like environment.

Recommended next phase: deploy the free relay, add database/RLS integration tests and Playwright flows, then run the k6 vote profiles plus a dedicated 600-WebSocket soak test against a production-like environment. Tune from measured latency, database load, Worker metrics and disconnect data before making a 600-user production claim.
