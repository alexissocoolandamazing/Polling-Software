import { z } from "zod";
import { QUESTION_TYPES } from "@/lib/types";

export const joinCodeSchema = z.string().trim().toUpperCase().regex(/^[A-HJ-NP-Z2-9]{6}$/);

export const pollSchema = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).default(""),
  allowVoteChanges: z.boolean().default(false),
});

export const questionSchema = z.object({
  prompt: z.string().trim().min(1).max(500),
  type: z.enum(QUESTION_TYPES),
  ratingMin: z.coerce.number().int().min(0).max(9).default(1),
  ratingMax: z.coerce.number().int().min(1).max(10).default(5),
}).refine((value) => value.ratingMax > value.ratingMin, {
  message: "Rating maximum must be greater than the minimum.",
});

export const voteSchema = z.object({
  questionId: z.uuid(),
  requestId: z.uuid(),
  optionIds: z.array(z.uuid()).max(20).default([]),
  textAnswer: z.string().trim().max(2000).nullable().default(null),
  ratingAnswer: z.number().int().nullable().default(null),
});
