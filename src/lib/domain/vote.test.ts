import { describe, expect, it } from "vitest";
import { validateVoteShape } from "./vote";

const empty = { optionIds: [], textAnswer: null, ratingAnswer: null };

describe("validateVoteShape", () => {
  it("requires exactly one single-choice option", () => {
    expect(validateVoteShape("single_choice", empty)).toBe("Choose one answer.");
    expect(validateVoteShape("single_choice", { ...empty, optionIds: ["a"] })).toBeNull();
  });

  it("accepts multiple distinct choices and rejects duplicates", () => {
    expect(validateVoteShape("multiple_choice", { ...empty, optionIds: ["a", "b"] })).toBeNull();
    expect(validateVoteShape("multiple_choice", { ...empty, optionIds: ["a", "a"] })).toBe("Choose each answer only once.");
  });

  it("enforces the configured rating range", () => {
    expect(validateVoteShape("rating", { ...empty, ratingAnswer: 6 }, { min: 1, max: 5 })).toMatch(/1 to 5/);
    expect(validateVoteShape("rating", { ...empty, ratingAnswer: 4 }, { min: 1, max: 5 })).toBeNull();
  });

  it("rejects blank free text", () => {
    expect(validateVoteShape("free_text", { ...empty, textAnswer: "  " })).toBe("Enter a response.");
  });
});
