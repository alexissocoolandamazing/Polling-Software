# PulsePoll

PulsePoll is a mobile-first, real-time polling platform for live events. This repository contains a working vertical slice: authenticated poll administration, anonymous participant joins, transactional voting, live aggregate results, and a projector presentation view.

The architecture is designed with the product target of 600+ connected participants and burst voting in mind. **That capacity is not yet proven**; run the documented load profiles against a production-like Supabase/Vercel environment before using it for a large event.

## Stack

- Next.js App Router, React, strict TypeScript and Tailwind CSS
- Supabase PostgreSQL, Auth and Realtime
- Zod validation and PostgreSQL constraints/RLS
- Vitest for domain tests and k6 for load-test scenarios

## Local setup

Requirements: Node.js 20.9+, npm, a Supabase project, and optionally the Supabase CLI and k6.

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

5. In **Realtime → Settings**, keep public channel access enabled. Public channels contain only session state and already-revealed aggregate counts; participant tokens, responses and hidden results are never broadcast. The migration adds protected admin counter tables to the Realtime publication.

6. Start the app:

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

Never expose `SUPABASE_SECRET_KEY` through a `NEXT_PUBLIC_` variable or commit `.env.local`.

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
- Database triggers emit narrow Supabase Broadcast invalidations. Participants refetch only on infrequent session-state changes; presentation screens coalesce result invalidations and fetch authoritative counter rows. Clients do not poll or scan raw votes.
- Admin tables remain behind owner-based RLS. Anonymous browser clients receive data only through the explicit server routes and public broadcast payloads.
- The privileged Supabase key is imported only by server-only modules.

## Validation commands

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

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

Import the repository into Vercel, add all four environment variables for each desired environment, and redeploy after setting them. Set `NEXT_PUBLIC_SITE_URL` to the production domain so generated QR codes are correct. Keep the Vercel function region close to the Supabase project region. Apply migrations before sending traffic to a deployment.

## Current limitations / next phase

- No CSV export, poll duplication, response reset, previous-session detail view, or free-text moderation/export yet.
- Question content is referenced from the poll rather than snapshotted per session; avoid editing a poll while one of its sessions is live.
- The simple participant cooldown is transactional and per participant, but join-route abuse still needs infrastructure-level rate limiting (for example, a Vercel WAF rule) before public exposure.
- Audience Broadcast topics are public so account-free participants can subscribe. Clients treat messages only as invalidations and fetch authoritative state, but deliberate broadcast spam could still create refresh traffic; private-channel authorization or a trusted realtime gateway is a hardening item for hostile public deployments.
- Automated tests currently cover pure vote/realtime logic. A disposable Supabase project should be added to CI for database RPC/RLS integration tests and browser end-to-end tests.
- Realtime reconnect/resynchronization is handled by state refresh on session events, but should receive network-chaos testing.

Recommended next phase: add database/RLS integration tests and Playwright flows, then run the k6 profiles against a production-like environment and tune indexes, Supabase compute, Realtime quotas and serverless concurrency from observed metrics. After that, add session snapshots, reset/export/history and operational monitoring.
