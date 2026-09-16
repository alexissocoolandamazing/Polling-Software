import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { PublicQuestion, PublicSessionState, QuestionType, ResultItem, SessionStatus } from "@/lib/types";

type SessionRow = {
  id: string; poll_id: string; join_code: string; status: SessionStatus;
  active_question_id: string | null; voting_open: boolean; results_visible: boolean;
};

export async function getSessionByCode(code: string): Promise<SessionRow | null> {
  const db = createAdminClient();
  const { data } = await db.from("poll_sessions")
    .select("id,poll_id,join_code,status,active_question_id,voting_open,results_visible")
    .eq("join_code", code).maybeSingle();
  return data as SessionRow | null;
}

export async function getPublicSessionState(code: string, includeHiddenResults = false): Promise<PublicSessionState | null> {
  const db = createAdminClient();
  const session = await getSessionByCode(code);
  if (!session) return null;

  const [{ data: poll }, { data: sessionStats }] = await Promise.all([
    db.from("polls").select("title,allow_vote_changes").eq("id", session.poll_id).single(),
    db.from("session_stats").select("participant_count").eq("session_id", session.id).maybeSingle(),
  ]);

  let question: PublicQuestion | null = null;
  let responseCount = 0;
  let results: ResultItem[] = [];

  if (session.active_question_id) {
    const [{ data: questionRow }, { data: options }, { data: questionShards }] = await Promise.all([
      db.from("questions").select("id,prompt,type,settings").eq("id", session.active_question_id).single(),
      db.from("answer_options").select("id,label,position").eq("question_id", session.active_question_id).order("position"),
      db.from("question_count_shards").select("response_count").eq("session_id", session.id)
        .eq("question_id", session.active_question_id),
    ]);
    if (questionRow) {
      question = {
        id: questionRow.id as string,
        prompt: questionRow.prompt as string,
        type: questionRow.type as QuestionType,
        settings: (questionRow.settings ?? {}) as { min?: number; max?: number },
        options: (options ?? []).map((item) => ({
          id: item.id as string, label: item.label as string, position: item.position as number,
        })),
      };
    }
    responseCount = (questionShards ?? []).reduce((sum, row) => sum + Number(row.response_count ?? 0), 0);

    if (question && (includeHiddenResults || session.results_visible)) {
      if (["single_choice", "multiple_choice", "yes_no"].includes(question.type)) {
        const { data: counts } = await db.from("option_count_shards").select("option_id,vote_count")
          .eq("session_id", session.id).eq("question_id", question.id);
        const byOption = new Map<string, number>();
        for (const row of counts ?? []) {
          const optionId = row.option_id as string;
          byOption.set(optionId, (byOption.get(optionId) ?? 0) + Number(row.vote_count ?? 0));
        }
        results = question.options.map((option) => {
          const count = byOption.get(option.id) ?? 0;
          return { optionId: option.id, label: option.label, count, percentage: responseCount ? (count / responseCount) * 100 : 0 };
        });
      } else if (question.type === "rating") {
        const { data: counts } = await db.from("rating_count_shards").select("rating,vote_count")
          .eq("session_id", session.id).eq("question_id", question.id);
        const byRating = new Map<number, number>();
        for (const row of counts ?? []) {
          const rating = Number(row.rating);
          byRating.set(rating, (byRating.get(rating) ?? 0) + Number(row.vote_count ?? 0));
        }
        results = [...byRating.entries()].sort(([a], [b]) => a - b).map(([rating, count]) => ({
          optionId: null, label: String(rating), count,
          percentage: responseCount ? (count / responseCount) * 100 : 0,
        }));
      }
    }
  }

  return {
    sessionId: session.id,
    code: session.join_code,
    pollTitle: (poll?.title as string | undefined) ?? "Live poll",
    status: session.status,
    votingOpen: session.voting_open,
    resultsVisible: session.results_visible,
    allowVoteChanges: Boolean(poll?.allow_vote_changes),
    question,
    responseCount,
    participantCount: Number(sessionStats?.participant_count ?? 0),
    results,
  };
}
