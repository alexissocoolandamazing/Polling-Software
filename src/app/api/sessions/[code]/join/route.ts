import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSessionByCode } from "@/lib/session-state";
import { createParticipantToken, hashParticipantToken, participantCookieName } from "@/lib/session-token";
import { joinCodeSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function POST(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const parsed = joinCodeSchema.safeParse((await params).code);
  if (!parsed.success) return NextResponse.json({ error: "Invalid session code." }, { status: 400 });
  const code = parsed.data;
  const session = await getSessionByCode(code);
  if (!session || session.status === "ended") {
    return NextResponse.json({ error: "This session is not available." }, { status: 404 });
  }

  const cookieStore = await cookies();
  const cookieName = participantCookieName(code);
  const existingToken = cookieStore.get(cookieName)?.value;
  const db = createAdminClient();
  if (existingToken) {
    const { data: existing } = await db.from("participants").select("id")
      .eq("session_id", session.id).eq("token_hash", hashParticipantToken(existingToken)).maybeSingle();
    if (existing) return NextResponse.json({ participantId: existing.id });
  }

  const token = createParticipantToken();
  const { data: participant, error } = await db.from("participants").insert({
    session_id: session.id, token_hash: hashParticipantToken(token),
  }).select("id").single();
  if (error) return NextResponse.json({ error: "Could not join the session." }, { status: 500 });
  cookieStore.set(cookieName, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax",
    path: `/`, maxAge: 60 * 60 * 24,
  });
  return NextResponse.json({ participantId: participant.id }, { status: 201 });
}
