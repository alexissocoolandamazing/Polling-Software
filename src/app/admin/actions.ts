"use server";

import { randomInt } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { pollSchema, questionSchema } from "@/lib/validation";

const uuid = z.uuid();

export async function createPoll(formData: FormData) {
  const { supabase, userId } = await requireAdmin();
  const parsed = pollSchema.safeParse({
    title: formData.get("title"), description: formData.get("description") ?? "", allowVoteChanges: false,
  });
  if (!parsed.success) throw new Error("Invalid poll details.");
  const { data, error } = await supabase.from("polls").insert({
    owner_id: userId, title: parsed.data.title, description: parsed.data.description,
  }).select("id").single();
  if (error) throw new Error(error.message);
  redirect(`/admin/polls/${data.id}`);
}

export async function updatePoll(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = uuid.parse(formData.get("pollId"));
  const parsed = pollSchema.safeParse({
    title: formData.get("title"), description: formData.get("description") ?? "",
    allowVoteChanges: formData.get("allowVoteChanges") === "on",
  });
  if (!parsed.success) throw new Error("Invalid poll details.");
  const { error } = await supabase.from("polls").update({
    title: parsed.data.title, description: parsed.data.description,
    allow_vote_changes: parsed.data.allowVoteChanges,
  }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/polls/${id}`);
}

export async function deletePoll(formData: FormData) {
  const { supabase } = await requireAdmin();
  const id = uuid.parse(formData.get("pollId"));
  const { error } = await supabase.from("polls").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/admin");
  redirect("/admin");
}

export async function addQuestion(formData: FormData) {
  const { supabase } = await requireAdmin();
  const pollId = uuid.parse(formData.get("pollId"));
  const parsed = questionSchema.safeParse({
    prompt: formData.get("prompt"), type: formData.get("type"),
    ratingMin: formData.get("ratingMin") ?? 1, ratingMax: formData.get("ratingMax") ?? 5,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid question.");
  const { data: last } = await supabase.from("questions").select("position").eq("poll_id", pollId)
    .order("position", { ascending: false }).limit(1).maybeSingle();
  const settings = parsed.data.type === "rating" ? { min: parsed.data.ratingMin, max: parsed.data.ratingMax } : {};
  const { data: question, error } = await supabase.from("questions").insert({
    poll_id: pollId, prompt: parsed.data.prompt, type: parsed.data.type,
    position: Number(last?.position ?? -1) + 1, settings,
  }).select("id").single();
  if (error) throw new Error(error.message);
  if (parsed.data.type === "yes_no") {
    const { error: optionError } = await supabase.from("answer_options").insert([
      { question_id: question.id, label: "Yes", position: 0 },
      { question_id: question.id, label: "No", position: 1 },
    ]);
    if (optionError) throw new Error(optionError.message);
  }
  revalidatePath(`/admin/polls/${pollId}`);
}

export async function updateQuestion(formData: FormData) {
  const { supabase } = await requireAdmin();
  const pollId = uuid.parse(formData.get("pollId"));
  const questionId = uuid.parse(formData.get("questionId"));
  const parsed = questionSchema.safeParse({
    prompt: formData.get("prompt"), type: formData.get("type"),
    ratingMin: formData.get("ratingMin") ?? 1, ratingMax: formData.get("ratingMax") ?? 5,
  });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid question.");
  const { data: existing } = await supabase.from("questions").select("type")
    .eq("id", questionId).eq("poll_id", pollId).single();
  if (!existing) throw new Error("Question not found.");
  const settings = parsed.data.type === "rating" ? { min: parsed.data.ratingMin, max: parsed.data.ratingMax } : {};
  const { error } = await supabase.from("questions").update({
    prompt: parsed.data.prompt, type: parsed.data.type, settings,
  }).eq("id", questionId).eq("poll_id", pollId);
  if (error) throw new Error(error.message);
  if (parsed.data.type === "yes_no" && existing.type !== "yes_no") {
    const { error: deleteError } = await supabase.from("answer_options").delete().eq("question_id", questionId);
    if (deleteError) throw new Error("This question has session responses and can no longer become Yes / No.");
    const { error: optionError } = await supabase.from("answer_options").insert([
      { question_id: questionId, label: "Yes", position: 0 },
      { question_id: questionId, label: "No", position: 1 },
    ]);
    if (optionError) throw new Error(optionError.message);
  }
  revalidatePath(`/admin/polls/${pollId}`);
}

export async function deleteQuestion(formData: FormData) {
  const { supabase } = await requireAdmin();
  const pollId = uuid.parse(formData.get("pollId"));
  const questionId = uuid.parse(formData.get("questionId"));
  const { error } = await supabase.from("questions").delete().eq("id", questionId).eq("poll_id", pollId);
  if (error) throw new Error("Questions used by a live session cannot be removed.");
  revalidatePath(`/admin/polls/${pollId}`);
}

export async function moveQuestion(formData: FormData) {
  const { supabase } = await requireAdmin();
  const pollId = uuid.parse(formData.get("pollId"));
  const questionId = uuid.parse(formData.get("questionId"));
  const direction = z.enum(["up", "down"]).parse(formData.get("direction"));
  const { data: questions, error } = await supabase.from("questions").select("id,position")
    .eq("poll_id", pollId).order("position");
  if (error || !questions) throw new Error(error?.message ?? "Questions not found.");
  const index = questions.findIndex((question) => question.id === questionId);
  const swapIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || swapIndex < 0 || swapIndex >= questions.length) return;
  const current = questions[index];
  const swap = questions[swapIndex];
  await Promise.all([
    supabase.from("questions").update({ position: swap.position }).eq("id", current.id),
    supabase.from("questions").update({ position: current.position }).eq("id", swap.id),
  ]);
  revalidatePath(`/admin/polls/${pollId}`);
}

export async function addOption(formData: FormData) {
  const { supabase } = await requireAdmin();
  const pollId = uuid.parse(formData.get("pollId"));
  const questionId = uuid.parse(formData.get("questionId"));
  const label = z.string().trim().min(1).max(200).parse(formData.get("label"));
  const { data: last } = await supabase.from("answer_options").select("position")
    .eq("question_id", questionId).order("position", { ascending: false }).limit(1).maybeSingle();
  const { error } = await supabase.from("answer_options").insert({
    question_id: questionId, label, position: Number(last?.position ?? -1) + 1,
  });
  if (error) throw new Error(error.message);
  revalidatePath(`/admin/polls/${pollId}`);
}

export async function deleteOption(formData: FormData) {
  const { supabase } = await requireAdmin();
  const pollId = uuid.parse(formData.get("pollId"));
  const optionId = uuid.parse(formData.get("optionId"));
  const { error } = await supabase.from("answer_options").delete().eq("id", optionId);
  if (error) throw new Error("Options used by a live session cannot be removed.");
  revalidatePath(`/admin/polls/${pollId}`);
}

const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function makeCode() {
  return Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join("");
}

export async function launchPoll(formData: FormData) {
  const { supabase } = await requireAdmin();
  const pollId = uuid.parse(formData.get("pollId"));
  const { data: questions } = await supabase.from("questions").select("id,prompt,type,answer_options(id)")
    .eq("poll_id", pollId).order("position");
  const firstQuestion = questions?.[0];
  if (!firstQuestion) throw new Error("Add at least one question before launching.");
  const incomplete = questions.find((question) =>
    ["single_choice", "multiple_choice", "yes_no"].includes(question.type) && question.answer_options.length < 2,
  );
  if (incomplete) throw new Error(`Add at least two options to “${incomplete.prompt}” before launching.`);
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const { data, error } = await supabase.from("poll_sessions").insert({
      poll_id: pollId, join_code: makeCode(), status: "live", active_question_id: firstQuestion.id,
      voting_open: false, results_visible: false, started_at: new Date().toISOString(),
    }).select("id").single();
    if (!error && data) redirect(`/admin/sessions/${data.id}`);
    if (error?.code !== "23505") throw new Error(error?.message ?? "Could not launch session.");
  }
  throw new Error("Could not allocate a unique join code. Try again.");
}
