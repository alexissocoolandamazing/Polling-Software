# Product Specification

## Objective

Create a production-ready real-time polling web application that is simple enough for participants to join in seconds and reliable enough for a live audience of at least 600 concurrent users.

The system must be designed for burst traffic, including the case where hundreds of users submit votes within a few seconds.

## Participant flow

1. Participant opens the public site.
2. Participant enters a short session code or follows a session-specific link/QR code.
3. No participant account is required.
4. Participant sees the active question.
5. Participant submits a response.
6. Server validates and records the response.
7. Participant sees a clear success state.
8. When the administrator changes the active question or closes voting, participant screens update automatically.

The participant UI must be extremely lightweight and mobile-first.

## Admin flow

Administrators authenticate securely and access a dashboard where they can:

- Create, edit, duplicate and delete polls.
- Add, remove and reorder questions.
- Add, remove and reorder answer options.
- Configure question type.
- Create/open a live polling session.
- Generate a short join code, QR code and shareable URL.
- Start and stop voting.
- Select the current question.
- Move to next/previous question.
- Hide or reveal results.
- See live participant count.
- See responses received and response percentage.
- Reset responses for a question when required.
- End a session.
- View previous sessions/results.
- Export results as CSV.

## Question types

Initial supported types:

- Single choice
- Multiple choice
- Yes / No
- Rating scale
- Free text

The schema should be extensible so more question types can be added later.

## Presentation mode

Provide a separate full-screen presentation route suitable for a projector or large display.

It should support:

- Current question.
- Live response count.
- Bar chart/visual results for choice questions.
- Percentages and counts.
- A results-hidden state controlled by the administrator.
- Automatic realtime updates.

## Voting integrity

Participant voting must not depend only on frontend validation.

Requirements:

- Issue/store an anonymous participant/session token.
- Validate session, question and answer option server-side.
- Reject votes when voting is closed.
- Prevent invalid option/question combinations.
- Support one-response-per-participant by default.
- Allow administrators to configure whether participants may change their response.
- Use database uniqueness constraints where appropriate.
- Do not identify anonymous participants unnecessarily.

This is not intended to be a cryptographically secure government-election system; it is a reliable live-event polling product.

## Realtime architecture

Avoid continuous client-side database polling.

Use realtime subscriptions/WebSockets for:

- Session state changes.
- Active question changes.
- Voting open/closed state.
- Results visibility changes.
- Live result updates where appropriate.

Participant clients should perform minimal work and minimal database queries.

## Performance requirements

Target:

- At least 600 simultaneous connected participants.
- Around 600 vote submissions arriving in a short burst.
- Headroom beyond expected usage.
- Load testing at 1,000 simultaneous participants minimum before considering the application ready for a real event.

Important implementation goals:

- Efficient PostgreSQL indexes.
- No N+1 query patterns in hot paths.
- Avoid having each results viewer repeatedly recalculate the full vote table.
- Use efficient aggregation/counters where appropriate.
- Keep public pages and payloads lightweight.
- Handle duplicate/retried HTTP submissions safely.

## Suggested implementation stack

- Next.js using the App Router.
- TypeScript with strict settings.
- Tailwind CSS.
- Supabase PostgreSQL.
- Supabase Auth for administrators.
- Supabase Realtime.
- Vercel hosting.

If Codex identifies a materially better implementation for the stated reliability/performance goals, it may change a component, but it should document the reason before doing so.

## Database concepts

Likely entities include:

- admin profiles
- polls
- questions
- answer options
- live sessions
- participants
- responses/votes

Use proper foreign keys, uniqueness constraints, timestamps and indexes.

Create migrations rather than relying on undocumented manual database changes.

## Security

Implement:

- Supabase Row Level Security.
- Admin-only management operations.
- Server-side validation.
- Input validation with a typed validation library.
- Reasonable rate limiting on public write endpoints.
- No service-role/database secrets shipped to the browser.
- Environment variables documented in `.env.example`.

## Testing

Include:

- Unit tests for important domain/voting logic.
- Integration tests around vote submission and session state.
- Basic end-to-end tests for participant and admin flows when practical.
- A k6 or equivalent load-test script.

Load-test scenarios should include:

1. 600 users joining and remaining connected.
2. 600 users submitting votes within a short burst.
3. 1,000-user stress/headroom test.
4. Repeated duplicate submission attempts.

Document commands and expected metrics in the README.

## Delivery approach

Do not try to build the entire system blindly in one unreviewed change.

Work in logical phases and keep the repository runnable after each phase:

1. Foundation and database architecture.
2. Admin authentication and basic poll management.
3. Participant join/session flow.
4. Voting path and integrity controls.
5. Realtime session updates.
6. Live admin results and presentation mode.
7. Security hardening.
8. Automated tests and load testing.
9. Performance fixes based on results.
10. Deployment documentation.

For every phase:

- inspect existing code before changing it;
- keep changes focused;
- run relevant lint/typecheck/tests;
- describe architectural decisions;
- do not claim scale targets are met until supported by load-test results.