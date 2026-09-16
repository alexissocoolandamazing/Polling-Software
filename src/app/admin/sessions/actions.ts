"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { notifyParticipantRelay } from "@/lib/realtime-relay";

export async function controlSession(formData: FormData) {
  const { supabase } = await requireAdmin();
  const sessionId = z.uuid().parse(formData.get("sessionId"));
  const action = z.enum(["open", "close", "next", "previous", "reveal", "hide", "end", "set"])
    .parse(formData.get("control"));
  const { data: session, error } = await supabase.from("poll_sessions")
    .select("id,poll_id,join_code,active_question_id,status").eq("id", sessionId).single();
  if (error) throw new Error("Session not found.");

  let update: Record<string, unknown> = {};
  if (action === "open") update = { voting_open: true };
  if (action === "close") update = { voting_open: false };
  if (action === "reveal") update = { results_visible: true };
  if (action === "hide") update = { results_visible: false };
  if (action === "end") update = { status: "ended", voting_open: false, ended_at: new Date().toISOString() };
  if (action === "set") update = { active_question_id: z.uuid().parse(formData.get("questionId")), voting_open: false, results_visible: false };
  if (action === "next" || action === "previous") {
    const { data: questions } = await supabase.from("questions").select("id").eq("poll_id", session.poll_id).order("position");
    const index = questions?.findIndex((question) => question.id === session.active_question_id) ?? -1;
    const target = action === "next" ? index + 1 : index - 1;
    if (questions?.[target]) update = { active_question_id: questions[target].id, voting_open: false, results_visible: false };
  }
  if (Object.keys(update).length) {
    const { error: updateError } = await supabase.from("poll_sessions").update(update).eq("id", sessionId);
    if (updateError) throw new Error(updateError.message);
    await notifyParticipantRelay(session.join_code);
  }
  revalidatePath(`/admin/sessions/${sessionId}`);
}
