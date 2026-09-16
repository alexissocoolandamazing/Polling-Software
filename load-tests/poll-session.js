import http from "k6/http";
import { check, sleep } from "k6";

const baseUrl = __ENV.BASE_URL || "http://localhost:3000";
const code = __ENV.SESSION_CODE;
const profile = __ENV.PROFILE || "burst";

if (!code) throw new Error("SESSION_CODE is required");

const profiles = {
  join: {
    join: { executor: "per-vu-iterations", vus: 600, iterations: 1, maxDuration: "60s" },
  },
  burst: {
    burst: { executor: "per-vu-iterations", vus: 600, iterations: 1, maxDuration: "60s" },
  },
  stress: {
    stress: { executor: "per-vu-iterations", vus: 1000, iterations: 1, maxDuration: "90s" },
  },
  duplicate: {
    duplicate: { executor: "per-vu-iterations", vus: 100, iterations: 1, maxDuration: "30s" },
  },
};

export const options = {
  scenarios: profiles[profile] || profiles.burst,
  thresholds: {
    http_req_failed: ["rate<0.01"],
    http_req_duration: ["p(95)<1000"],
  },
};

export function setup() {
  const response = http.get(`${baseUrl}/api/sessions/${code}/state`);
  check(response, { "session state is available": (result) => result.status === 200 });
  const state = response.json();
  if (!state.question) throw new Error("The session needs an active question");
  if (profile !== "join" && !state.votingOpen) throw new Error("Open voting before running a vote profile");
  return state;
}

export default function runScenario(state) {
  const joined = http.post(`${baseUrl}/api/sessions/${code}/join`);
  check(joined, { "participant joined": (response) => response.status === 200 || response.status === 201 });
  if (profile === "join") { sleep(1); return; }

  const requestId = crypto.randomUUID();
  const question = state.question;
  const body = {
    questionId: question.id,
    requestId,
    optionIds: question.options.length ? [question.options[__VU % question.options.length].id] : [],
    textAnswer: question.type === "free_text" ? `Load test response ${__VU}` : null,
    ratingAnswer: question.type === "rating" ? (question.settings.min || 1) : null,
  };
  const params = { headers: { "Content-Type": "application/json" } };
  const voted = http.post(`${baseUrl}/api/sessions/${code}/vote`, JSON.stringify(body), params);
  check(voted, { "vote accepted": (response) => response.status === 200 });
  if (profile === "duplicate") {
    const retried = http.post(`${baseUrl}/api/sessions/${code}/vote`, JSON.stringify(body), params);
    check(retried, { "idempotent retry accepted": (response) => response.status === 200 });
  }
}
