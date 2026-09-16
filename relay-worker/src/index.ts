import { DurableObject } from "cloudflare:workers";

const sessionPath = /^\/v1\/sessions\/([A-HJ-NP-Z2-9]{6})\/(connect|notify)$/;

type SessionStateNotification = {
  type: "session_state";
  eventId: string;
  sentAt: string;
};

// Encrypted secrets are intentionally absent from wrangler.jsonc, so Wrangler
// generates the configured bindings and this intersection adds only the secret.
type RelayEnv = Env & { RELAY_SHARED_SECRET: string };

export class SessionRelay extends DurableObject<RelayEnv> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return json({ error: "Expected a WebSocket upgrade." }, 426);
    }

    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    return new Response(null, { status: 101, webSocket: client });
  }

  broadcast(notification: SessionStateNotification): number {
    const message = JSON.stringify(notification);
    let recipients = 0;

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
        recipients += 1;
      } catch (error) {
        console.error(JSON.stringify({
          message: "relay_socket_send_failed",
          error: error instanceof Error ? error.message : String(error),
        }));
        socket.close(1011, "Delivery failed");
      }
    }

    return recipients;
  }
}

export default {
  async fetch(request: Request, env: RelayEnv): Promise<Response> {
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return json({ ok: true });
      }

      const match = sessionPath.exec(url.pathname);
      if (!match) return json({ error: "Not found." }, 404);

      const [, code, operation] = match;
      if (operation === "connect") {
        if (request.method !== "GET") return methodNotAllowed("GET");
        if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
          return json({ error: "Expected a WebSocket upgrade." }, 426);
        }
        if (!originAllowed(request.headers.get("Origin"), env.ALLOWED_ORIGINS)) {
          return json({ error: "Origin is not allowed." }, 403);
        }

        return env.SESSION_RELAY.getByName(code).fetch(request);
      }

      if (request.method !== "POST") return methodNotAllowed("POST");
      const suppliedSecret = bearerToken(request.headers.get("Authorization"));
      if (!await secretMatches(suppliedSecret, env.RELAY_SHARED_SECRET)) {
        return json({ error: "Unauthorized." }, 401);
      }

      const notification: SessionStateNotification = {
        type: "session_state",
        eventId: crypto.randomUUID(),
        sentAt: new Date().toISOString(),
      };
      const recipients = await env.SESSION_RELAY.getByName(code).broadcast(notification);
      return json({ ok: true, recipients });
    } catch (error) {
      console.error(JSON.stringify({
        message: "relay_request_failed",
        method: request.method,
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json({ error: "Internal server error." }, 500);
    }
  },
} satisfies ExportedHandler<RelayEnv>;

function bearerToken(header: string | null): string {
  if (!header?.startsWith("Bearer ")) return "";
  return header.slice("Bearer ".length);
}

async function secretMatches(supplied: string, expected: string): Promise<boolean> {
  if (!supplied || !expected) return false;
  const encoder = new TextEncoder();
  const [suppliedHash, expectedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(supplied)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  // Cloudflare implements this non-standard extension, although the generated
  // Web Crypto declaration has not added it to SubtleCrypto yet.
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(suppliedHash, expectedHash);
}

function originAllowed(origin: string | null, configuredOrigins: string): boolean {
  if (!origin || configuredOrigins.trim() === "*") return true;
  return configuredOrigins.split(",").some((allowed) => allowed.trim() === origin);
}

function methodNotAllowed(allowed: "GET" | "POST"): Response {
  return json({ error: "Method not allowed." }, 405, { Allow: allowed });
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      ...headers,
    },
  });
}
