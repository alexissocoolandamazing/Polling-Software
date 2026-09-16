import { performance } from "node:perf_hooks";

const BASE_URL = process.env.BASE_URL || "https://polling-software.vercel.app";
const CODE = process.argv[2] || process.env.SESSION_CODE;
const CONNECTIONS = Number(process.argv[3] || process.env.CONNECTIONS || 400);
const RAMP_SECONDS = Number(process.argv[4] || process.env.RAMP_SECONDS || 20);
const EXPLICIT_RELAY_URL = process.argv[5] || process.env.RELAY_URL || process.env.NEXT_PUBLIC_REALTIME_RELAY_URL || "";
const HOST_ACTION_TIMEOUT_MS = 60_000;
const DELIVERY_WINDOW_MS = 8_000;
const CONNECT_TIMEOUT_MS = 15_000;

if (!CODE) {
  console.error("Usage: node load-tests/run-realtime-relay-test.mjs SESSION_CODE [CONNECTIONS] [RAMP_SECONDS] [RELAY_URL]");
  process.exit(1);
}

if (typeof WebSocket === "undefined") {
  console.error("This test needs Node 22+ with the built-in WebSocket client.");
  process.exit(1);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function summary(values) {
  if (!values.length) return { p50Ms: 0, p95Ms: 0, p99Ms: 0, maxMs: 0 };
  return {
    p50Ms: Math.round(percentile(values, 50)),
    p95Ms: Math.round(percentile(values, 95)),
    p99Ms: Math.round(percentile(values, 99)),
    maxMs: Math.round(Math.max(...values)),
  };
}

function normaliseBaseUrl(url) {
  return url.trim().replace(/\/$/, "");
}

function toWebSocketUrl(httpUrl, code) {
  const url = new URL(httpUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/v1/sessions/${code}/connect`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function extractRelayCandidates(text) {
  const normalised = text.replaceAll("\\/", "/");
  const matches = normalised.match(/https:\/\/[A-Za-z0-9.-]+\.workers\.dev/gi) || [];
  return [...new Set(matches.map(normaliseBaseUrl))];
}

async function discoverRelayUrl() {
  if (EXPLICIT_RELAY_URL) return normaliseBaseUrl(EXPLICIT_RELAY_URL);

  const pageUrl = `${BASE_URL}/session/${CODE}`;
  const page = await fetch(pageUrl, { cache: "no-store" });
  if (!page.ok) throw new Error(`Could not load participant page (${page.status}).`);
  const html = await page.text();

  const direct = extractRelayCandidates(html);
  if (direct.length) {
    const preferred = direct.find((url) => url.includes("pulsepoll-realtime-relay"));
    return preferred || direct[0];
  }

  const scriptUrls = [];
  const scriptRegex = /<script[^>]+src=["']([^"']+)["']/gi;
  let match;
  while ((match = scriptRegex.exec(html)) !== null) {
    try {
      scriptUrls.push(new URL(match[1], BASE_URL).toString());
    } catch {
      // Ignore malformed script URLs.
    }
  }

  const uniqueScripts = [...new Set(scriptUrls)].slice(0, 40);
  const scripts = await Promise.all(uniqueScripts.map(async (url) => {
    try {
      const response = await fetch(url);
      return response.ok ? await response.text() : "";
    } catch {
      return "";
    }
  }));

  for (const source of scripts) {
    const candidates = extractRelayCandidates(source);
    if (candidates.length) {
      const preferred = candidates.find((url) => url.includes("pulsepoll-realtime-relay"));
      return preferred || candidates[0];
    }
  }

  throw new Error(
    "Could not auto-discover the Cloudflare relay URL. Re-run with it as the last argument, e.g. " +
    "node load-tests/run-realtime-relay-test.mjs CODE 400 20 https://your-worker.workers.dev"
  );
}

const relayUrl = await discoverRelayUrl();
const healthResponse = await fetch(`${relayUrl}/health`, { cache: "no-store" });
if (!healthResponse.ok) throw new Error(`Relay health check failed with HTTP ${healthResponse.status}.`);
const wsUrl = toWebSocketUrl(relayUrl, CODE);

console.log("PulsePoll Cloudflare realtime relay test");
console.log(`Session: ${CODE}`);
console.log(`Relay: ${relayUrl}`);
console.log(`Connections: ${CONNECTIONS}`);
console.log(`Connection ramp: ${RAMP_SECONDS}s`);
console.log("This tests persistent WebSockets and delivery of one real host control update.\n");

const sockets = [];
const connectionResults = new Array(CONNECTIONS);
const recipientIndexes = new Set();
const deliveryLatencies = [];
let armed = false;
let targetEventId = null;
let targetSentAtMs = null;
let firstBroadcastResolve;
let finished = false;
let unexpectedCloses = 0;

const firstBroadcast = new Promise((resolve) => {
  firstBroadcastResolve = resolve;
});

function handleMessage(index, event) {
  if (!armed) return;
  let payload;
  try {
    payload = JSON.parse(String(event.data));
  } catch {
    return;
  }
  if (payload?.type !== "session_state" || !payload.eventId) return;

  if (!targetEventId) {
    targetEventId = payload.eventId;
    targetSentAtMs = Date.parse(payload.sentAt);
    firstBroadcastResolve(payload);
  }
  if (payload.eventId !== targetEventId || recipientIndexes.has(index)) return;

  recipientIndexes.add(index);
  if (Number.isFinite(targetSentAtMs)) {
    deliveryLatencies.push(Math.max(0, Date.now() - targetSentAtMs));
  }
}

async function openSocket(index, targetStart) {
  const waitMs = targetStart - performance.now();
  if (waitMs > 0) await sleep(waitMs);

  const started = performance.now();
  return await new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(wsUrl);
    sockets[index] = socket;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { socket.close(); } catch {}
      resolve({ index, ok: false, ms: performance.now() - started, error: "connect timeout" });
    }, CONNECT_TIMEOUT_MS);

    socket.addEventListener("open", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.addEventListener("message", (event) => handleMessage(index, event));
      socket.addEventListener("close", () => {
        if (!finished) unexpectedCloses += 1;
      });
      resolve({ index, ok: true, ms: performance.now() - started, error: null });
    });

    socket.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ index, ok: false, ms: performance.now() - started, error: "websocket error" });
    });
  });
}

const rampStarted = performance.now();
const spacingMs = (RAMP_SECONDS * 1000) / Math.max(1, CONNECTIONS);
await Promise.all(Array.from({ length: CONNECTIONS }, async (_, index) => {
  const result = await openSocket(index, rampStarted + index * spacingMs);
  connectionResults[index] = result;
}));

const successfulConnections = connectionResults.filter((row) => row?.ok);
const failedConnections = connectionResults.filter((row) => !row?.ok);
const connectTimes = successfulConnections.map((row) => row.ms);
const connectionRate = (successfulConnections.length / CONNECTIONS) * 100;

console.log("========== CONNECTION RESULTS ==========");
console.log({
  requested: CONNECTIONS,
  connected: successfulConnections.length,
  failed: failedConnections.length,
  successRate: Number(connectionRate.toFixed(2)),
  ...summary(connectTimes),
});

if (connectionRate < 98) {
  finished = true;
  for (const socket of sockets) {
    try { socket?.close(); } catch {}
  }
  console.error("Too many WebSocket connections failed; stopping before the broadcast test.");
  process.exit(2);
}

armed = true;
console.log("\n========== HOST ACTION ==========");
console.log("All test sockets are now listening.");
console.log("NOW, in the PulsePoll admin page, click ONE control that changes session state:");
console.log("for example Close voting / Open voting / Reveal results / Hide results / Next.");
console.log("You have 60 seconds. Do not close this terminal.\n");

const hostActionTimeout = sleep(HOST_ACTION_TIMEOUT_MS).then(() => null);
const notification = await Promise.race([firstBroadcast, hostActionTimeout]);

if (!notification) {
  finished = true;
  for (const socket of sockets) {
    try { socket?.close(); } catch {}
  }
  console.error("No relay notification arrived within 60 seconds.");
  process.exit(3);
}

const deliveryDeadline = performance.now() + DELIVERY_WINDOW_MS;
while (recipientIndexes.size < successfulConnections.length && performance.now() < deliveryDeadline) {
  await sleep(50);
}

const delivered = recipientIndexes.size;
const deliveryRate = (delivered / successfulConnections.length) * 100;
const latencySummary = summary(deliveryLatencies);

console.log("========== BROADCAST RESULTS ==========");
console.log({
  eventId: targetEventId,
  connectedAtBroadcast: successfulConnections.length,
  received: delivered,
  missed: successfulConnections.length - delivered,
  deliveryRate: Number(deliveryRate.toFixed(2)),
  unexpectedClosesBeforeFinish: unexpectedCloses,
  ...latencySummary,
});

const connectionHealthy = connectionRate >= 98;
const deliveryHealthy = deliveryRate >= 98 && latencySummary.p95Ms <= 2000;

console.log("\n========== VERDICT ==========");
console.log({
  connectionHealthy,
  deliveryHealthy,
  overallHealthy: connectionHealthy && deliveryHealthy,
});

finished = true;
for (const socket of sockets) {
  try { socket?.close(1000, "Load test complete"); } catch {}
}

if (!connectionHealthy || !deliveryHealthy) process.exitCode = 4;
