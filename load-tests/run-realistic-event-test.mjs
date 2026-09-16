import { performance } from "node:perf_hooks";

const BASE_URL = process.env.BASE_URL || "https://polling-software.vercel.app";
const CODE = process.argv[2] || process.env.SESSION_CODE;
const ATTENDEES = Number(process.argv[3] || process.env.ATTENDEES || 400);
const VOTERS = Number(process.argv[4] || process.env.VOTERS || 300);
const JOIN_WINDOW_SECONDS = Number(process.argv[5] || process.env.JOIN_WINDOW_SECONDS || 60);
const VOTE_WINDOW_SECONDS = Number(process.argv[6] || process.env.VOTE_WINDOW_SECONDS || 10);

if (!CODE) {
  console.error("Usage: node load-tests/run-realistic-event-test.mjs SESSION_CODE [ATTENDEES] [VOTERS] [JOIN_WINDOW_SECONDS] [VOTE_WINDOW_SECONDS]");
  process.exit(1);
}
if (VOTERS > ATTENDEES) throw new Error("VOTERS cannot exceed ATTENDEES");

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summarise(label, rows) {
  const durations = rows.map((row) => row.ms);
  const ok = rows.filter((row) => row.ok).length;
  const statuses = {};
  for (const row of rows) statuses[row.status] = (statuses[row.status] || 0) + 1;
  const result = {
    label,
    total: rows.length,
    ok,
    successRate: Number(((ok / rows.length) * 100).toFixed(2)),
    p50Ms: Math.round(percentile(durations, 50)),
    p95Ms: Math.round(percentile(durations, 95)),
    p99Ms: Math.round(percentile(durations, 99)),
    maxMs: Math.round(Math.max(...durations)),
    statuses,
  };
  console.log(result);
  return result;
}

function summariseMetric(label, values) {
  const clean = values.filter(Number.isFinite);
  if (!clean.length) return null;
  const result = {
    label,
    samples: clean.length,
    p50Ms: Math.round(percentile(clean, 50)),
    p95Ms: Math.round(percentile(clean, 95)),
    p99Ms: Math.round(percentile(clean, 99)),
    maxMs: Math.round(Math.max(...clean)),
  };
  console.log(result);
  return result;
}

async function timedFetch(url, options) {
  const start = performance.now();
  try {
    const response = await fetch(url, options);
    return { response, ms: performance.now() - start, error: null };
  } catch (error) {
    return { response: null, ms: performance.now() - start, error: String(error) };
  }
}

function participantCookie(response) {
  if (!response) return "";
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie")].filter(Boolean);
  return cookies[0]?.split(";")[0] || "";
}

function numericHeader(response, name) {
  if (!response) return Number.NaN;
  const value = Number(response.headers.get(name));
  return Number.isFinite(value) ? value : Number.NaN;
}

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

console.log("PulsePoll realistic audience load test");
console.log(`Target: ${BASE_URL}`);
console.log(`Session: ${CODE}`);
console.log(`Attendees: ${ATTENDEES}`);
console.log(`Voters: ${VOTERS}`);
console.log(`Join window: ${JOIN_WINDOW_SECONDS}s`);
console.log(`Vote window: ${VOTE_WINDOW_SECONDS}s\n`);

const stateResponse = await fetch(`${BASE_URL}/api/sessions/${CODE}/state`, { cache: "no-store" });
if (!stateResponse.ok) throw new Error(`State endpoint returned ${stateResponse.status}`);
const state = await stateResponse.json();
if (!state.question) throw new Error("The session has no active question.");
if (!state.votingOpen) throw new Error("Voting is closed. Open voting before running the test.");
const question = state.question;

const joinStart = performance.now();
const joinSpacingMs = (JOIN_WINDOW_SECONDS * 1000) / Math.max(1, ATTENDEES);
const joins = await Promise.all(Array.from({ length: ATTENDEES }, async (_, i) => {
  const waitMs = joinStart + i * joinSpacingMs - performance.now();
  if (waitMs > 0) await sleep(waitMs);
  const result = await timedFetch(`${BASE_URL}/api/sessions/${CODE}/join`, { method: "POST" });
  const status = result.response?.status ?? 0;
  return { index: i, ok: status === 200 || status === 201, status, ms: result.ms, cookie: participantCookie(result.response), error: result.error };
}));

console.log("\n========== GRADUAL JOIN RESULTS ==========");
const joinResult = summarise(`join-${ATTENDEES}-over-${JOIN_WINDOW_SECONDS}s`, joins);
const successful = joins.filter((join) => join.ok && join.cookie);
console.log(`Successful participants: ${successful.length}/${ATTENDEES}`);
if (joinResult.successRate < 98 || successful.length < VOTERS) {
  console.error("Not enough healthy joins to run requested voting pattern.");
  process.exit(2);
}

const voters = successful.slice(0, VOTERS);
console.log(`\nReleasing ${VOTERS} votes across ${VOTE_WINDOW_SECONDS} seconds...`);
const voteStart = performance.now();
const voteSpacingMs = (VOTE_WINDOW_SECONDS * 1000) / Math.max(1, VOTERS);
const votes = await Promise.all(voters.map(async (join, i) => {
  const waitMs = voteStart + i * voteSpacingMs - performance.now();
  if (waitMs > 0) await sleep(waitMs);
  const body = {
    questionId: question.id,
    requestId: crypto.randomUUID(),
    optionIds: question.options?.length ? [question.options[i % question.options.length].id] : [],
    textAnswer: question.type === "free_text" ? `Realistic load response ${i}` : null,
    ratingAnswer: question.type === "rating" ? (question.settings?.min ?? 1) : null,
  };
  const result = await timedFetch(`${BASE_URL}/api/sessions/${CODE}/vote`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: join.cookie },
    body: JSON.stringify(body),
  });
  const status = result.response?.status ?? 0;
  const rpcMs = numericHeader(result.response, "x-pulsepoll-rpc-ms");
  const appMs = numericHeader(result.response, "x-pulsepoll-app-ms");
  return {
    ok: status === 200,
    status,
    ms: result.ms,
    rpcMs,
    appMs,
    outsideAppMs: Number.isFinite(appMs) ? Math.max(0, result.ms - appMs) : Number.NaN,
    error: result.error,
  };
}));

console.log("\n========== REALISTIC VOTE RESULTS ==========");
const voteResult = summarise(`vote-${VOTERS}-over-${VOTE_WINDOW_SECONDS}s`, votes);
console.log("\n========== SERVER-SIDE VOTE TIMING ==========");
summariseMetric("vercel-to-supabase-rpc", votes.map((row) => row.rpcMs));
summariseMetric("vercel-app-total", votes.map((row) => row.appMs));
summariseMetric("client/network-or-upstream-queue", votes.map((row) => row.outsideAppMs));

console.log("\n========== VERDICT ==========");
console.log({
  attendees: ATTENDEES,
  voters: VOTERS,
  joinWindowSeconds: JOIN_WINDOW_SECONDS,
  voteWindowSeconds: VOTE_WINDOW_SECONDS,
  joinHealthy: joinResult.successRate >= 98 && joinResult.p95Ms <= 5000,
  voteHealthy: voteResult.successRate >= 98 && voteResult.p95Ms <= 5000,
});

if (voteResult.successRate < 98 || voteResult.p95Ms > 5000) process.exitCode = 3;
