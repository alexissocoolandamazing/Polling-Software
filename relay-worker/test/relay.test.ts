import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const sessionCode = "ABC234";
const secret = "test-relay-secret";

describe("PulsePoll realtime relay", () => {
  it("reports health without exposing configuration", async () => {
    const response = await exports.default.fetch("https://relay.test/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("rejects invalid session codes before invoking a Durable Object", async () => {
    const response = await exports.default.fetch("https://relay.test/v1/sessions/INVALID/connect", {
      headers: { Upgrade: "websocket" },
    });

    expect(response.status).toBe(404);
  });

  it("requires the shared secret for host notifications", async () => {
    const response = await exports.default.fetch(`https://relay.test/v1/sessions/${sessionCode}/notify`, {
      method: "POST",
    });

    expect(response.status).toBe(401);
  });

  it("broadcasts one narrow invalidation to connected participants", async () => {
    const connect = await exports.default.fetch(`https://relay.test/v1/sessions/${sessionCode}/connect`, {
      headers: { Upgrade: "websocket", Origin: "https://poll.test" },
    });
    const socket = connect.webSocket;
    if (!socket) throw new Error("Expected a WebSocket response.");
    socket.accept();

    const message = new Promise<string>((resolve) => {
      socket.addEventListener("message", (event) => resolve(String(event.data)), { once: true });
    });
    const notify = await exports.default.fetch(`https://relay.test/v1/sessions/${sessionCode}/notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
    });

    expect(notify.status).toBe(200);
    expect(await notify.json()).toEqual({ ok: true, recipients: 1 });
    expect(JSON.parse(await message)).toMatchObject({ type: "session_state" });
    socket.close(1000, "done");
  });
});
