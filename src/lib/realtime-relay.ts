import "server-only";
import { joinCodeSchema } from "@/lib/validation";

const relayTimeoutMs = 2_000;

export async function notifyParticipantRelay(rawCode: string): Promise<boolean> {
  const code = joinCodeSchema.parse(rawCode);
  const relayUrl = process.env.NEXT_PUBLIC_REALTIME_RELAY_URL;
  const secret = process.env.REALTIME_RELAY_SECRET;

  if (!relayUrl || !secret) {
    console.warn(JSON.stringify({
      message: "participant_relay_not_configured",
      code,
    }));
    return false;
  }

  try {
    const endpoint = new URL(`/v1/sessions/${code}/notify`, relayUrl);
    if (endpoint.protocol === "ws:") endpoint.protocol = "http:";
    if (endpoint.protocol === "wss:") endpoint.protocol = "https:";
    if (endpoint.protocol !== "http:" && endpoint.protocol !== "https:") {
      throw new Error("Relay URL must use HTTP(S) or WS(S).");
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      cache: "no-store",
      signal: AbortSignal.timeout(relayTimeoutMs),
    });
    if (!response.ok) throw new Error(`Relay returned ${response.status}.`);
    return true;
  } catch (error) {
    console.error(JSON.stringify({
      message: "participant_relay_notification_failed",
      code,
      error: error instanceof Error ? error.message : String(error),
    }));
    return false;
  }
}
