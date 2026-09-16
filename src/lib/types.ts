export const QUESTION_TYPES = ["single_choice", "multiple_choice", "yes_no", "rating", "free_text"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export type SessionStatus = "draft" | "live" | "ended";

export interface AnswerOption {
  id: string;
  label: string;
  position: number;
}

export interface PublicQuestion {
  id: string;
  prompt: string;
  type: QuestionType;
  settings: { min?: number; max?: number };
  options: AnswerOption[];
}

export interface ResultItem {
  optionId: string | null;
  label: string;
  count: number;
  percentage: number;
}

export interface PublicSessionState {
  sessionId: string;
  code: string;
  pollTitle: string;
  status: SessionStatus;
  votingOpen: boolean;
  resultsVisible: boolean;
  allowVoteChanges: boolean;
  question: PublicQuestion | null;
  responseCount: number;
  participantCount: number;
  results: ResultItem[];
}

export interface AdminResultsState extends PublicSessionState {
  resultsVisible: boolean;
}
