import Link from "next/link";
import { ArrowDown, ArrowLeft, ArrowUp, Play, Plus, Trash2 } from "lucide-react";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth";
import { throwSupabaseQueryError } from "@/lib/supabase/query-error";
import { QUESTION_TYPE_LABELS, type QuestionType } from "@/lib/types";
import { QuestionTypeFields } from "@/components/question-type-fields";
import { addOption, addQuestion, deleteOption, deletePoll, deleteQuestion, launchPoll, moveQuestion, updatePoll, updateQuestion } from "../../actions";

type AnswerOptionRow = {
  id: string;
  question_id: string;
  label: string;
  position: number;
};

export default async function PollEditor({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();

  const { data: poll, error: pollError } = await supabase.from("polls")
    .select("id,title,description,allow_vote_changes")
    .eq("id", id)
    .maybeSingle();
  if (pollError) throwSupabaseQueryError("Load poll", pollError, { pollId: id });
  if (!poll) notFound();

  const [questionsResult, sessionsResult] = await Promise.all([
    supabase.from("questions")
      .select("id,prompt,type,position,settings")
      .eq("poll_id", poll.id)
      .order("position"),
    supabase.from("poll_sessions")
      .select("id,status,join_code,created_at")
      .eq("poll_id", poll.id)
      .order("created_at", { ascending: false }),
  ]);
  if (questionsResult.error) {
    throwSupabaseQueryError("Load poll questions", questionsResult.error, { pollId: poll.id });
  }
  if (sessionsResult.error) {
    throwSupabaseQueryError("Load poll sessions", sessionsResult.error, { pollId: poll.id });
  }

  const questionRows = questionsResult.data ?? [];
  const questionIds = questionRows.map((question) => question.id);
  const optionsResult = questionIds.length
    ? await supabase.from("answer_options")
      .select("id,question_id,label,position")
      .in("question_id", questionIds)
      .order("position")
    : { data: [], error: null };
  if (optionsResult.error) {
    throwSupabaseQueryError("Load question answer options", optionsResult.error, { pollId: poll.id });
  }

  const optionRows = (optionsResult.data ?? []) as AnswerOptionRow[];
  const optionsByQuestion = new Map<string, AnswerOptionRow[]>();
  for (const option of optionRows) {
    const options = optionsByQuestion.get(option.question_id) ?? [];
    options.push(option);
    optionsByQuestion.set(option.question_id, options);
  }
  const questions = questionRows.map((question) => ({
    ...question,
    answer_options: optionsByQuestion.get(question.id) ?? [],
  }));
  const sessions = sessionsResult.data ?? [];

  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <Link className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600" href="/admin"><ArrowLeft size={16} /> Back to polls</Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div><p className="eyebrow">Poll editor</p><h1 className="mt-2 text-4xl font-black">{poll.title}</h1></div>
        <form action={launchPoll}><input type="hidden" name="pollId" value={poll.id} /><button className="btn-primary" disabled={!questions.length}><Play size={17} /> Launch live session</button></form>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="space-y-4">
          <div className="flex items-center justify-between"><h2 className="text-xl font-bold">Questions</h2><span className="text-sm text-slate-500">{questions.length} total</span></div>
          {!questions.length && <div className="card py-12 text-center text-slate-500">Add a question using the form.</div>}
          {questions.map((question, index) => {
            const options = [...(question.answer_options ?? [])].sort((a, b) => a.position - b.position);
            const choice = ["single_choice", "multiple_choice", "yes_no"].includes(question.type);
            return (
              <article className="card" key={question.id}>
                <div className="flex items-start justify-between gap-3">
                  <div><span className="text-xs font-bold text-indigo-600">QUESTION {index + 1} · {QUESTION_TYPE_LABELS[question.type as QuestionType]}</span><h3 className="mt-1 text-lg font-bold">{question.prompt}</h3></div>
                  <div className="flex gap-1">
                    <form action={moveQuestion}><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="questionId" value={question.id} /><input type="hidden" name="direction" value="up" /><button className="btn-secondary min-h-9 px-2" disabled={index === 0} title="Move up"><ArrowUp size={15} /></button></form>
                    <form action={moveQuestion}><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="questionId" value={question.id} /><input type="hidden" name="direction" value="down" /><button className="btn-secondary min-h-9 px-2" disabled={index === questions.length - 1} title="Move down"><ArrowDown size={15} /></button></form>
                    <form action={deleteQuestion}><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="questionId" value={question.id} /><button className="btn-danger min-h-9 px-2" title="Delete question"><Trash2 size={15} /></button></form>
                  </div>
                </div>
                {question.type === "rating" && <p className="mt-3 text-sm text-slate-500">Scale: {String((question.settings as { min?: number }).min ?? 1)}–{String((question.settings as { max?: number }).max ?? 5)}</p>}
                <details className="mt-4 rounded-xl border border-slate-200 p-3">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-600">Edit question</summary>
                  <form action={updateQuestion} className="mt-3 space-y-3">
                    <input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="questionId" value={question.id} />
                    <textarea className="field min-h-20" name="prompt" defaultValue={question.prompt} required maxLength={500} />
                    <QuestionTypeFields defaultType={question.type as QuestionType} defaultMin={Number((question.settings as { min?: number }).min ?? 1)} defaultMax={Number((question.settings as { max?: number }).max ?? 5)} />
                    <button className="btn-secondary w-full">Save question</button>
                  </form>
                </details>
                {choice && <div className="mt-4 space-y-2">
                  {options.map((option) => <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm" key={option.id}><span>{option.label}</span>{question.type !== "yes_no" && <form action={deleteOption}><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="optionId" value={option.id} /><button className="text-slate-400 hover:text-red-600" title="Remove option"><Trash2 size={15} /></button></form>}</div>)}
                  {question.type !== "yes_no" && <form action={addOption} className="flex gap-2 pt-2"><input type="hidden" name="pollId" value={poll.id} /><input type="hidden" name="questionId" value={question.id} /><input className="field min-h-10" name="label" maxLength={200} required placeholder="New answer option" /><button className="btn-secondary min-h-10"><Plus size={15} /> Add</button></form>}
                </div>}
              </article>
            );
          })}
        </section>

        <aside className="space-y-5">
          <section className="card"><h2 className="text-lg font-bold">Poll settings</h2><form action={updatePoll} className="mt-4 space-y-4"><input type="hidden" name="pollId" value={poll.id} /><div><label className="label">Title</label><input className="field" name="title" defaultValue={poll.title} required maxLength={120} /></div><div><label className="label">Description</label><textarea className="field min-h-20" name="description" defaultValue={poll.description} maxLength={1000} /></div><label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" name="allowVoteChanges" defaultChecked={poll.allow_vote_changes} /><span><strong>Allow vote changes</strong><br /><span className="text-slate-500">Participants can replace a submitted answer.</span></span></label><button className="btn-primary w-full">Save settings</button></form></section>
          <section className="card"><h2 className="text-lg font-bold">Add question</h2><form action={addQuestion} className="mt-4 space-y-3"><input type="hidden" name="pollId" value={poll.id} /><textarea className="field min-h-20" name="prompt" required maxLength={500} placeholder="What would you like to ask?" /><QuestionTypeFields defaultType="single_choice" /><button className="btn-primary w-full"><Plus size={16} /> Add question</button></form></section>
          {sessions.length > 0 && <section className="card"><h2 className="text-lg font-bold">Sessions</h2><div className="mt-3 space-y-2">{sessions.map((session) => <Link className="flex items-center justify-between rounded-xl bg-slate-50 p-3 text-sm font-semibold hover:bg-slate-100" href={`/admin/sessions/${session.id}`} key={session.id}><span>{session.join_code}</span><span className="capitalize text-slate-500">{session.status}</span></Link>)}</div></section>}
          <section className="card border-red-100"><h2 className="text-sm font-bold text-red-700">Danger zone</h2><form action={deletePoll} className="mt-3"><input type="hidden" name="pollId" value={poll.id} /><button className="btn-danger w-full"><Trash2 size={16} /> Delete poll</button></form></section>
        </aside>
      </div>
    </main>
  );
}
