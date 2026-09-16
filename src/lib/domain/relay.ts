import type { PublicSessionState } from "@/lib/types";

export const RELAY_FALLBACK_POLL_MS = 5_000;

export function buildRelayWebSocketUrl(baseUrl: string | undefined, code: string): string | null {
  if (!baseUrl) return null;

  try {
    const url = new URL(baseUrl);
    if (url.protocol === "https:") url.protocol = "wss:";
    else if (url.protocol === "http:") url.protocol = "ws:";
    else if (url.protocol !== "wss:" && url.protocol !== "ws:") return null;
    url.pathname = `/v1/sessions/${code}/connect`;
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

export function relayReconnectDelay(attempt: number, random = Math.random): number {
  const exponential = Math.min(30_000, 1_000 * 2 ** Math.max(0, attempt));
  return Math.round(exponential * (0.8 + random() * 0.4));
}

export function isSessionStateRelayMessage(data: unknown): boolean {
  if (typeof data !== "string") return false;
  try {
    const parsed: unknown = JSON.parse(data);
    return typeof parsed === "object" && parsed !== null && "type" in parsed
      && parsed.type === "session_state";
  } catch {
    return false;
  }
}

export function sessionControlSignature(state: PublicSessionState): string {
  return [
    state.status,
    state.question?.id ?? "",
    state.votingOpen ? "open" : "closed",
    state.resultsVisible ? "shown" : "hidden",
  ].join(":");
}
