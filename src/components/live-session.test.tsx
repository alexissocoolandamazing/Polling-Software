// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveSession } from "./live-session";
import type { PublicSessionState } from "@/lib/types";

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly instances: MockWebSocket[] = [];

  readonly readyState = MockWebSocket.OPEN;
  private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();

  constructor() {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data?: unknown }) => void) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  close() {}

  emitMessage(data: string) {
    this.listeners.get("message")?.forEach((listener) => listener({ data }));
  }
}

const questionA = {
  id: "question-a",
  prompt: "Question A",
  type: "single_choice" as const,
  settings: {},
  options: [{ id: "option-a", label: "Answer A", position: 0 }],
};

const questionB = {
  id: "question-b",
  prompt: "Question B",
  type: "single_choice" as const,
  settings: {},
  options: [{ id: "option-b", label: "Answer B", position: 0 }],
};

function sessionState(overrides: Partial<PublicSessionState> = {}): PublicSessionState {
  return {
    sessionId: "session",
    code: "ABC234",
    pollTitle: "Poll",
    status: "live",
    votingOpen: true,
    resultsVisible: false,
    allowVoteChanges: true,
    question: questionA,
    responseCount: 0,
    participantCount: 1,
    results: [],
    ...overrides,
  };
}

async function flushUi() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("LiveSession participant response state", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    MockWebSocket.instances.length = 0;
    vi.stubGlobal("WebSocket", MockWebSocket);
    vi.stubEnv("NEXT_PUBLIC_REALTIME_RELAY_URL", "https://relay.example.com");
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("keeps confirmation for same-question updates and resets for a new question", async () => {
    let currentState = sessionState();
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/join") && init?.method === "POST") {
        return { ok: true, json: async () => ({ participantId: "participant" }) } as Response;
      }
      if (url.endsWith("/vote") && init?.method === "POST") {
        currentState = { ...currentState, responseCount: 1 };
        return { ok: true, json: async () => ({ ok: true }) } as Response;
      }
      if (url.endsWith("/state")) {
        return { ok: true, json: async () => currentState } as Response;
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => root.render(<LiveSession code="ABC234" />));
    await flushUi();
    expect(container.textContent).toContain("Question A");

    const firstAnswer = container.querySelector<HTMLInputElement>('input[type="radio"]');
    expect(firstAnswer).not.toBeNull();
    await act(async () => firstAnswer!.click());
    const form = container.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await flushUi();
    expect(container.textContent).toContain("Response recorded");
    expect(container.textContent).toContain("Change response");

    const socket = MockWebSocket.instances[0];
    expect(socket).toBeDefined();

    currentState = { ...currentState, resultsVisible: true };
    await act(async () => socket.emitMessage('{"type":"session_state"}'));
    await flushUi();
    expect(container.textContent).toContain("Live results");
    expect(container.textContent).toContain("Response recorded");

    currentState = { ...currentState, resultsVisible: false };
    await act(async () => socket.emitMessage('{"type":"session_state"}'));
    await flushUi();
    expect(container.textContent).not.toContain("Live results");
    expect(container.textContent).toContain("Response recorded");

    currentState = { ...currentState, votingOpen: false };
    await act(async () => socket.emitMessage('{"type":"session_state"}'));
    await flushUi();
    expect(container.textContent).not.toContain("Change response");
    expect(container.textContent).toContain("Response recorded");
    expect(container.textContent).not.toContain("Voting is currently closed");

    currentState = { ...currentState, votingOpen: true };
    await act(async () => socket.emitMessage('{"type":"session_state"}'));
    await flushUi();
    expect(container.textContent).toContain("Change response");
    expect(container.textContent).toContain("Response recorded");

    currentState = sessionState({ question: questionB });
    await act(async () => socket.emitMessage('{"type":"session_state"}'));
    await flushUi();
    expect(container.textContent).toContain("Question B");
    expect(container.textContent).not.toContain("Response recorded");
    expect(container.textContent).toContain("Submit response");
    expect(container.querySelector<HTMLInputElement>('input[type="radio"]')?.checked).toBe(false);
  });
});
