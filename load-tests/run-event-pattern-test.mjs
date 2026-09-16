import { performance } from "node:perf_hooks";

const BASE_URL = process.env.BASE_URL || "https://polling-software.vercel.app";
const CODE = process.argv[2] || process.env.SESSION_CODE;
const USERS = Number(process.argv[3] || process.env.USERS || 600);
const JOIN_WINDOW_SECONDS = Number(process.argv[4] || process.env.JOIN_WINDOW_SECONDS || 60);

if (!CODE) {
  console.error("Usage: node load-tests/run-event-pattern-test.mjs SESSION_CODE [USERS] [JOIN_WINDOW_SECONDS]");
  process.exit(1);
}

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
  if (!clean.length) {
    console.log({ label, samples: 0, note: "Timing header unavailable; production may still be on an older build." });
    return null;
  }
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

console.log("PulsePoll realistic event-pattern load test");
console.log(`Target: ${BASE_URL}`);
console.log(`Session: ${CODE}`);
console.log(`Users: ${USERS}`);
console.log(`Join window: ${JOIN_WINDOW_SECONDS}s`);
console.log("Participants join gradually, then all successful participants vote in one simultaneous burst.\n");

const stateResponse = await fetch(`${BASE_URL}/api/sessions/${CODE}/state`, { cache: "no-store" });
if (!stateResponse.ok) throw new Error(`State endpoint returned ${stateResponse.status}`);
const state = await stateResponse.json();
if (!state.question) throw new Error("The session has no active question.");
if (!state.votingOpen) throw new Error("Voting is closed. Open voting before running the test.");
const question = state.question;

const start = performance.now();
const spacingMs = (JOIN_WINDOW_SECONDS * 1000) / Math.max(1, USERS);

const joins = await Promise.all(Array.from({ length: USERS }, async (_, i) => {
  const targetStart = start + i * spacingMs;
  const waitMs = targetStart - performance.now();
  if (waitMs > 0) await sleep(waitMs);

  const result = await timedFetch(`${BASE_URL}/api/sessions/${CODE}/join`, { method: "POST" });
  const status = result.response?.status ?? 0;
  return {
    index: i,
    ok: status === 200 || status === 201,
    status,
    ms: result.ms,
    cookie: participantCookie(result.response),
    error: result.error,
  };
}));

console.log("\n========== GRADUAL JOIN RESULTS ==========");
const joinResult = summarise(`join-${USERS}-over-${JOIN_WINDOW_SECONDS}s`, joins);
const successful = joins.filter((join) => join.ok && join.cookie);
console.log(`Successful participant cookies available for vote burst: ${successful.length}/${USERS}`);

if (joinResult.successRate < 98 || successful.length < Math.ceil(USERS * 0.98)) {
  console.error("Too many joins failed; not running the vote burst.");
  process.exit(2);
}

console.log("\nWaiting 2 seconds, then releasing all votes at once...");
await sleep(2000);

const votes = await Promise.all(successful.map(async (join, i) => {
  const body = {
    questionId: question.id,
    requestId: crypto.randomUUID(),
    optionIds: question.options?.length ? [question.options[i % question.options.length].id] : [],
    textAnswer: question.type === "free_text" ? `Event-pattern load response ${i}` : null,
    ratingAnswer: question.type === "rating" ? (question.settings?.min ?? 1) : null,
  };

  const result = await timedFetch(`${BASE_URL}/api/sessions/${CODE}/vote`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: join.cookie,
    },
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

console.log("\n========== SIMULTANEOUS VOTE BURST RESULTS ==========");
const voteResult = summarise(`vote-burst-${successful.length}`, votes);

console.log("\n========== SERVER-SIDE VOTE TIMING ==========");
summariseMetric("vercel-to-supabase-rpc", votes.map((row) => row.rpcMs));
summariseMetric("vercel-app-total", votes.map((row) => row.appMs));
summariseMetric("client/network-or-upstream-queue", votes.map((row) => row.outsideAppMs));

console.log("\n========== VERDICT ==========");
console.log({
  requestedUsers: USERS,
  joinWindowSeconds: JOIN_WINDOW_SECONDS,
  joinHealthy: joinResult.successRate >= 98 && joinResult.p95Ms <= 5000,
  voteHealthy: voteResult.successRate >= 98 && voteResult.p95Ms <= 5000,
});

if (voteResult.successRate < 98 || voteResult.p95Ms > 5000) process.exitCode = 3;
