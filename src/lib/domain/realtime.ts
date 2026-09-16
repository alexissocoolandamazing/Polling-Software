import type { PublicSessionState } from "@/lib/types";

export type ResultBroadcast = {
  kind: "response" | "option" | "rating";
  questionId: string;
  count: number;
  optionId?: string;
  rating?: number;
};

export function applyResultBroadcast(state: PublicSessionState, update: ResultBroadcast): PublicSessionState {
  if (!state.question || state.question.id !== update.questionId) return state;
  const responseCount = update.kind === "response" ? update.count : state.responseCount;
  let results = state.results;
  if (update.kind === "option" && update.optionId) {
    results = state.results.map((result) => result.optionId === update.optionId ? { ...result, count: update.count } : result);
  }
  if (update.kind === "rating" && update.rating !== undefined) {
    const label = String(update.rating);
    const found = state.results.some((result) => result.label === label);
    results = found
      ? state.results.map((result) => result.label === label ? { ...result, count: update.count } : result)
      : [...state.results, { optionId: null, label, count: update.count, percentage: 0 }].sort((a, b) => Number(a.label) - Number(b.label));
  }
  results = results.map((result) => ({
    ...result,
    percentage: responseCount ? (result.count / responseCount) * 100 : 0,
  }));
  return { ...state, responseCount, results };
}
