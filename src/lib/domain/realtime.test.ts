import { describe, expect, it } from "vitest";
import { applyResultBroadcast } from "./realtime";
import type { PublicSessionState } from "@/lib/types";

const state: PublicSessionState = {
  sessionId: "s", code: "ABC234", pollTitle: "Poll", status: "live", votingOpen: true,
  resultsVisible: true, participantCount: 4, responseCount: 2,
  allowVoteChanges: false,
  question: { id: "q", prompt: "Question", type: "single_choice", settings: {}, options: [] },
  results: [{ optionId: "a", label: "A", count: 1, percentage: 50 }],
};

describe("applyResultBroadcast", () => {
  it("updates counts without requiring a result refetch", () => {
    const changed = applyResultBroadcast(state, { kind: "option", questionId: "q", optionId: "a", count: 2 });
    expect(changed.results[0].count).toBe(2);
  });
  it("ignores updates for another question", () => {
    expect(applyResultBroadcast(state, { kind: "response", questionId: "other", count: 9 })).toBe(state);
  });
});
