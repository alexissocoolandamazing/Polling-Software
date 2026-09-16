import { performance } from "node:perf_hooks";

const BASE_URL = process.env.BASE_URL || "https://polling-software.vercel.app";
const CODE = process.argv[2] || process.env.SESSION_CODE;
const MAX_USERS = Number(process.argv[3] || process.env.MAX_USERS || 600);
const ALL_STAGES = [10, 50, 100, 200, 400, 600];
const stages = ALL_STAGES.filter((n) => n <= MAX_USERS);

if (!CODE) {
  console.error("Usage: node load-tests/run-production-load-test.mjs SESSION_CODE [MAX_USERS]");
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

console.log(`PulsePoll production load test`);
console.log(`Target: ${BASE_URL}`);
console.log(`Session: ${CODE}`);
console.log(`Stages: ${stages.join(" -> ")}`);
console.log("Each stage creates fresh participants, then releases their votes as one burst.\n");

const stateResponse = await fetch(`${BASE_URL}/api/sessions/${CODE}/state`, { cache: "no-store" });
if (!stateResponse.ok) throw new Error(`State endpoint returned ${stateResponse.status}`);
const state = await stateResponse.json();
if (!state.question) throw new Error("The session has no active question.");
if (!state.votingOpen) throw new Error("Voting is closed. Open voting before running the test.");
const question = state.question;

for (const n of stages) {
  console.log(`\n========== ${n} CONCURRENT USERS ==========`);

  const joins = await Promise.all(Array.from({ length: n }, async (_, i) => {
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

  const joinResult = summarise(`join-${n}`, joins);
  if (joinResult.successRate < 98 || joinResult.p95Ms > 5000) {
    console.error(`Stopping before vote burst: join stage ${n} is unhealthy.`);
    process.exit(2);
  }

  const votes = await Promise.all(joins.map(async (join, i) => {
    if (!join.ok || !join.cookie) {
      return { ok: false, status: 0, ms: 0, error: "Join failed or participant cookie missing" };
    }

    const body = {
      questionId: question.id,
      requestId: crypto.randomUUID(),
      optionIds: question.options?.length ? [question.options[i % question.options.length].id] : [],
      textAnswer: question.type === "free_text" ? `Load test response ${n}-${i}` : null,
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
    return { ok: status === 200, status, ms: result.ms, error: result.error };
  }));

  const voteResult = summarise(`vote-${n}`, votes);
  if (voteResult.successRate < 98 || voteResult.p95Ms > 5000) {
    console.error(`Stopping ramp: vote stage ${n} is unhealthy.`);
    process.exit(3);
  }

  console.log(`Stage ${n} passed. Waiting 2.5 seconds before the next stage...`);
  await new Promise((resolve) => setTimeout(resolve, 2500));
}

console.log("\nHTTP LOAD TEST PASSED THROUGH MAXIMUM REQUESTED STAGE.");
console.log("Paste this terminal output back into ChatGPT so the latency/error profile can be analysed.");
