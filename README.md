# PulsePoll

PulsePoll is a mobile-first live polling platform for events. It supports anonymous participant joins, authenticated poll administration, transactional voting, live results, presentation mode, and a Cloudflare WebSocket relay for participant session-state updates.

## Live app

- **Participant app:** https://polling-software.vercel.app/
- **Admin login:** https://polling-software.vercel.app/login
- **Repository:** https://github.com/alexissocoolandamazing/Polling-Software

### For friends testing the app

1. Open https://polling-software.vercel.app/ on your phone or laptop.
2. Enter the current six-character session code supplied by the host.
3. Join anonymously and vote when voting opens.
4. Try normal participant actions such as voting, waiting for results, changing a response when allowed, and moving between questions.
5. If something breaks, report the device, browser, what you clicked, and a screenshot if possible.

A direct participant URL also works in this format:

```text
https://polling-software.vercel.app/session/ABC234
```

Replace `ABC234` with the current live session code.

## Current production validation

The production deployment has been exercised with event-style load tests rather than only local/unit tests.

- 400 participants joining gradually over 60 seconds: **400/400 successful**
- 300 votes spread across 10 seconds: **300/300 successful**
- realistic vote p95 latency: **~1.0 s**
- realistic vote p99 latency: **~1.14 s**
- a dedicated Cloudflare WebSocket relay load-test harness is included for large concurrent realtime connection testing

The more extreme synthetic case where hundreds of users submit at essentially the exact same instant is intentionally harsher than the expected event pattern and produces higher latency, while still preserving vote correctness.

## Stack

- Next.js 16 App Router, React 19, TypeScript and Tailwind CSS
- Supabase PostgreSQL and Auth for authoritative data, sessions and votes
- sharded PostgreSQL aggregate counters for burst-vote contention reduction
- Cloudflare Worker + Durable Object per live session for participant realtime notifications
- Supabase Realtime for protected admin/presentation updates
- Zod validation, PostgreSQL constraints/RLS and server-only privileged access
- Vitest, k6 and custom Node load-test scripts

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Enter a six-character join code |
| `/login` | Administrator sign-in |
| `/admin` | Poll list and creation |
| `/admin/polls/[id]` | Poll settings, questions and session launch |
| `/admin/sessions/[id]` | Live controls, QR code, metrics and results |
| `/session/[code]` | Anonymous participant voting experience |
| `/session/[code]/present` | Full-screen presentation view |
| `/api/sessions/[code]/join` | Create an anonymous session participant |
| `/api/sessions/[code]/state` | Return sanitized authoritative public state |
| `/api/sessions/[code]/vote` | Validate and atomically submit a vote |

## Architecture and vote integrity

- Participants receive a cryptographically random token in an HttpOnly cookie; only its SHA-256 hash is stored in PostgreSQL.
- `submit_vote` validates the session, participant, active question, answer shape, option ownership, rate limit, duplicate rules and request idempotency in one database transaction.
- Responses are uniquely constrained by session, participant and question.
- Vote aggregates are written into 32 counter shards and summed for reads, reducing contention during vote bursts.
- Participant phones use a receive-only Cloudflare WebSocket relay. The relay carries narrow state invalidations, not votes, participant tokens or hidden poll data.
- After a relay notification, the participant fetches authoritative state from the Next.js state API.
- If the relay is temporarily unavailable, participant clients reconnect with backoff and fall back to periodic state polling.
- Admin data stays behind authenticated owner-based RLS.

## Local setup

Requirements: Node.js 22+, npm, Supabase and Cloudflare Workers.

```bash
npm install
```

Copy `.env.example` to `.env.local` and configure:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_REALTIME_RELAY_URL=
REALTIME_RELAY_SECRET=
```

Never expose `SUPABASE_SECRET_KEY` or `REALTIME_RELAY_SECRET` through a `NEXT_PUBLIC_` variable, and never commit `.env.local` or relay secret files.

Apply the committed Supabase migrations, then start the app:

```bash
npm run dev
```

For local Cloudflare relay development:

```bash
npm run dev:relay
```

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

## Production-style load tests

### Realistic event profile

```bash
node load-tests/run-realistic-event-test.mjs SESSION_CODE 400 300 60 10
```

This models 400 attendees joining over 60 seconds, with 300 of them voting across a 10-second window.

### Worst-case simultaneous vote burst

```bash
node load-tests/run-event-pattern-test.mjs SESSION_CODE 400 60
```

This deliberately releases all successful participants into one simultaneous vote burst.

### Cloudflare realtime relay test

```bash
node load-tests/run-realtime-relay-test.mjs SESSION_CODE 400 20
```

This opens 400 persistent WebSocket connections to one live session. Once all test sockets are listening, use one admin control such as Open voting, Close voting, Reveal results or Next. The script reports connection success, delivery rate and delivery latency.

## Cloudflare relay deployment

Authenticate Wrangler, configure the relay secret, then deploy:

```bash
npx wrangler login
npx wrangler secret put RELAY_SHARED_SECRET --config relay-worker/wrangler.jsonc
npm run deploy:relay
```

Use the deployed Worker URL as `NEXT_PUBLIC_REALTIME_RELAY_URL` in Vercel. Use the same random secret as Vercel's server-only `REALTIME_RELAY_SECRET`.

## Vercel deployment

The production deployment is hosted at:

https://polling-software.vercel.app/

Vercel requires the six environment variables listed above. `NEXT_PUBLIC_SITE_URL` should point to the production domain so QR codes resolve correctly. Apply Supabase migrations before sending traffic to a deployment.

## Current limitations

- No CSV export, poll duplication, response reset or free-text moderation/export yet.
- Question content is referenced from the poll rather than snapshotted per session, so avoid editing a poll while that session is live.
- Join-route abuse still needs infrastructure-level rate limiting before broad public exposure.
- A sustained Cloudflare outage moves participants to fallback state polling and increases Vercel/Supabase read traffic.
- Broader browser end-to-end coverage and database/RLS integration tests are still worthwhile before treating the project as fully finished.
