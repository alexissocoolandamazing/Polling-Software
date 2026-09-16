import { describe, expect, it } from "vitest";
import {
  buildRelayWebSocketUrl,
  isSessionStateRelayMessage,
  relayReconnectDelay,
  sessionQuestionKey,
} from "./relay";
import type { PublicSessionState } from "@/lib/types";

describe("participant relay helpers", () => {
  it("builds a secure WebSocket endpoint from the public relay URL", () => {
    expect(buildRelayWebSocketUrl("https://relay.example.com/", "ABC234"))
      .toBe("wss://relay.example.com/v1/sessions/ABC234/connect");
    expect(buildRelayWebSocketUrl("ftp://relay.example.com", "ABC234")).toBeNull();
  });

  it("recognizes only session-state invalidations", () => {
    expect(isSessionStateRelayMessage('{"type":"session_state"}')).toBe(true);
    expect(isSessionStateRelayMessage('{"type":"result_update"}')).toBe(false);
    expect(isSessionStateRelayMessage("not-json")).toBe(false);
  });

  it("uses capped exponential reconnect delays", () => {
    expect(relayReconnectDelay(0, () => 0.5)).toBe(1_000);
    expect(relayReconnectDelay(4, () => 0.5)).toBe(16_000);
    expect(relayReconnectDelay(20, () => 0.5)).toBe(30_000);
  });

  it("preserves participant response state for same-question session updates", () => {
    const state: PublicSessionState = {
      sessionId: "session",
      code: "ABC234",
      pollTitle: "Poll",
      status: "live",
      votingOpen: true,
      resultsVisible: false,
      allowVoteChanges: false,
      question: { id: "question", prompt: "Question", type: "single_choice", settings: {}, options: [] },
      responseCount: 1,
      participantCount: 2,
      results: [],
    };

    const questionKey = sessionQuestionKey(state);

    expect(sessionQuestionKey({ ...state, responseCount: 2 })).toBe(questionKey);
    expect(sessionQuestionKey({ ...state, resultsVisible: true })).toBe(questionKey);
    expect(sessionQuestionKey({ ...state, votingOpen: false })).toBe(questionKey);
    expect(sessionQuestionKey({ ...state, status: "ended" })).toBe(questionKey);
  });

  it("detects a genuinely different active question", () => {
    const state: PublicSessionState = {
      sessionId: "session",
      code: "ABC234",
      pollTitle: "Poll",
      status: "live",
      votingOpen: true,
      resultsVisible: false,
      allowVoteChanges: false,
      question: { id: "question-a", prompt: "Question A", type: "single_choice", settings: {}, options: [] },
      responseCount: 1,
      participantCount: 2,
      results: [],
    };

    expect(sessionQuestionKey({
      ...state,
      question: { ...state.question!, id: "question-b", prompt: "Question B" },
    })).not.toBe(sessionQuestionKey(state));
    expect(sessionQuestionKey({ ...state, question: null })).not.toBe(sessionQuestionKey(state));
  });
});
