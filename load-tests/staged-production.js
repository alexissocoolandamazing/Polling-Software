import http from "k6/http";
import { check, sleep } from "k6";
import exec from "k6/execution";

const baseUrl = __ENV.BASE_URL || "https://polling-software.vercel.app";
const code = __ENV.SESSION_CODE;
const vus = Number(__ENV.VUS || 10);

if (!code) throw new Error("SESSION_CODE is required");

export const options = {
  scenarios: {
    burst: {
      executor: "per-vu-iterations",
      vus,
      iterations: 1,
      maxDuration: "90s",
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.02"],
    http_req_duration: ["p(95)<2000"],
  },
};

export function setup() {
  const response = http.get(`${baseUrl}/api/sessions/${code}/state`);
  if (response.status !== 200) throw new Error(`State endpoint returned ${response.status}`);
  const state = response.json();
  if (!state.question) throw new Error("Session needs an active question");
  if (!state.votingOpen) throw new Error("Voting must be open");
  return state;
}

export default function (state) {
  const joined = http.post(`${baseUrl}/api/sessions/${code}/join`);
  const joinedOk = check(joined, { "participant joined": (r) => r.status === 200 || r.status === 201 });
  if (!joinedOk) return;

  const question = state.question;
  const body = {
    questionId: question.id,
    requestId: crypto.randomUUID(),
    optionIds: question.options.length ? [question.options[exec.vu.idInTest % question.options.length].id] : [],
    textAnswer: question.type === "free_text" ? `Load test response ${exec.vu.idInTest}` : null,
    ratingAnswer: question.type === "rating" ? (question.settings.min || 1) : null,
  };

  const voted = http.post(`${baseUrl}/api/sessions/${code}/vote`, JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
  check(voted, { "vote accepted": (r) => r.status === 200 });
  sleep(0.1);
}
