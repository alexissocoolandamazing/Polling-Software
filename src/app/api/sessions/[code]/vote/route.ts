import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashParticipantToken, participantCookieName } from "@/lib/session-token";
import { joinCodeSchema, voteSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

const statusByMessage: Record<string, number> = {
  SESSION_NOT_FOUND: 404, QUESTION_NOT_FOUND: 404, INVALID_PARTICIPANT: 401,
  VOTING_CLOSED: 409, QUESTION_NOT_ACTIVE: 409, ALREADY_VOTED: 409,
  RATE_LIMITED: 429, INVALID_SELECTION_COUNT: 400, INVALID_OPTIONS: 400,
  INVALID_RATING: 400, INVALID_TEXT: 400,
};

function timingHeaders(requestStartedAt: number, rpcStartedAt: number, rpcFinishedAt: number) {
  const rpcMs = rpcFinishedAt - rpcStartedAt;
  const appMs = performance.now() - requestStartedAt;
  return {
    "Server-Timing": `supabase;dur=${rpcMs.toFixed(1)}, app;dur=${appMs.toFixed(1)}`,
    "X-PulsePoll-RPC-Ms": rpcMs.toFixed(1),
    "X-PulsePoll-App-Ms": appMs.toFixed(1),
  };
}

export async function POST(request: Request, { params }: { params: Promise<{ code: string }> }) {
  const requestStartedAt = performance.now();
  const codeResult = joinCodeSchema.safeParse((await params).code);
  if (!codeResult.success) return NextResponse.json({ error: "Invalid session code." }, { status: 400 });
  const body = await request.json().catch(() => null);
  const parsed = voteSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid vote payload." }, { status: 400 });

  const code = codeResult.data;
  const token = (await cookies()).get(participantCookieName(code))?.value;
  if (!token) return NextResponse.json({ error: "Join the session before voting." }, { status: 401 });

  const db = createAdminClient();
  const tokenHash = hashParticipantToken(token);
  const rpcStartedAt = performance.now();
  const { data, error } = await db.rpc("submit_vote", {
    p_join_code: code,
    p_token_hash: tokenHash,
    p_question_id: parsed.data.questionId,
    p_request_id: parsed.data.requestId,
    p_option_ids: parsed.data.optionIds.length ? parsed.data.optionIds : null,
    p_text_answer: parsed.data.textAnswer,
    p_rating_answer: parsed.data.ratingAnswer,
  });
  const rpcFinishedAt = performance.now();
  const headers = timingHeaders(requestStartedAt, rpcStartedAt, rpcFinishedAt);

  if (error) {
    const key = Object.keys(statusByMessage).find((message) => error.message.includes(message));
    const status = key ? statusByMessage[key] : 500;
    const friendly = key === "ALREADY_VOTED" ? "Your response has already been recorded."
      : key === "VOTING_CLOSED" || key === "QUESTION_NOT_ACTIVE" ? "Voting is closed for this question."
      : key === "RATE_LIMITED" ? "Please wait a moment before trying again."
      : status < 500 ? "This response could not be accepted." : "Could not save your response.";
    return NextResponse.json({ error: friendly }, { status, headers });
  }
  return NextResponse.json({ ok: true, result: Array.isArray(data) ? data[0] : data }, { headers });
}
