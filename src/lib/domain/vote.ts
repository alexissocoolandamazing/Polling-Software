import type { QuestionType } from "@/lib/types";

export type VoteInput = {
  optionIds: string[];
  textAnswer: string | null;
  ratingAnswer: number | null;
};

export function validateVoteShape(
  type: QuestionType,
  vote: VoteInput,
  ratingRange: { min: number; max: number } = { min: 1, max: 5 },
): string | null {
  const distinctOptions = new Set(vote.optionIds);
  if (distinctOptions.size !== vote.optionIds.length) return "Choose each answer only once.";
  if ((type === "single_choice" || type === "yes_no") && vote.optionIds.length !== 1) {
    return "Choose one answer.";
  }
  if (type === "multiple_choice" && vote.optionIds.length < 1) return "Choose at least one answer.";
  if (type === "rating" && (
    vote.ratingAnswer === null || !Number.isInteger(vote.ratingAnswer) ||
    vote.ratingAnswer < ratingRange.min || vote.ratingAnswer > ratingRange.max
  )) return `Choose a rating from ${ratingRange.min} to ${ratingRange.max}.`;
  if (type === "free_text" && !vote.textAnswer?.trim()) return "Enter a response.";
  return null;
}
