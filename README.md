# Polling Software

A fast, mobile-first real-time polling platform designed for live events and audiences of 600+ simultaneous participants.

## Goal

Build a production-ready alternative to paid live-polling tools, with a very simple participant experience and a secure administrator dashboard. The system should be designed for bursts where hundreds of people may submit a vote within a few seconds.

## Core experience

### Participants
- Join without an account using a short session code or QR code.
- See the current question immediately.
- Submit a vote from a phone with minimal latency.
- Receive confirmation that the vote was recorded.
- Automatically receive question/session state changes without refreshing.

### Administrators
- Secure admin authentication.
- Create, edit, duplicate and delete polls.
- Add and reorder questions and answer options.
- Open/close sessions and individual questions.
- Move between questions.
- Hide/reveal results.
- View live participant and response counts.
- Reset a question when required.
- Export results to CSV.
- Use a clean full-screen presentation/results view.

## Poll types
- Single choice
- Multiple choice
- Yes / No
- Rating scale
- Free text

## Performance target
- 600+ simultaneous connected participants.
- 600 votes may arrive within a short burst.
- Architecture should have headroom and be load-tested at approximately 1,000+ simulated participants.
- Do not use continuous browser polling for live state; use realtime events/WebSockets where appropriate.

## Suggested stack
- Next.js + TypeScript
- Tailwind CSS
- Supabase PostgreSQL
- Supabase Auth for administrators
- Supabase Realtime for live session/question/result updates
- Vercel deployment

## Reliability and security
- Server-side vote validation.
- Database constraints and transactions where needed to prevent invalid/duplicate voting.
- Participant/session token for anonymous users.
- Configurable once-only voting or vote changes.
- Supabase Row Level Security.
- Rate limiting and input validation.
- Efficient indexes and result aggregation.
- Load testing before real-world use.

See `PRODUCT_SPEC.md` for the implementation requirements.