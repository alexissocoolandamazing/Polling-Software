import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Eye, EyeOff, ExternalLink, Lock, Play, Square } from "lucide-react";
import { notFound } from "next/navigation";
import QRCode from "qrcode";
import { AdminLiveResults } from "@/components/admin-live-results";
import { requireAdmin } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { getPublicSessionState } from "@/lib/session-state";
import { controlSession } from "../actions";

export default async function AdminSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requireAdmin();
  const { data: session } = await supabase.from("poll_sessions").select("id,poll_id,join_code,status,active_question_id,voting_open,results_visible,polls(title)").eq("id", id).single();
  if (!session) notFound();
  const [{ data: questions }, state] = await Promise.all([
    supabase.from("questions").select("id,prompt,position").eq("poll_id", session.poll_id).order("position"),
    getPublicSessionState(session.join_code, true),
  ]);
  if (!state) notFound();
  const baseUrl = serverEnv().siteUrl.replace(/\/$/, "");
  const participantUrl = `${baseUrl}/session/${session.join_code}`;
  const qr = await QRCode.toDataURL(participantUrl, { width: 480, margin: 2, color: { dark: "#172033", light: "#ffffff" } });
  const index = questions?.findIndex((question) => question.id === session.active_question_id) ?? -1;
  const ended = session.status === "ended";
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <Link className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600" href={`/admin/polls/${session.poll_id}`}><ArrowLeft size={16} /> Back to poll</Link>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4"><div><p className="eyebrow">Live session</p><h1 className="mt-2 text-4xl font-black">Code {session.join_code}</h1><p className="mt-2 text-slate-500">{state.pollTitle}</p></div><Link className="btn-secondary" href={`/session/${session.join_code}/present`} target="_blank">Presentation view <ExternalLink size={16} /></Link></div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
        <section><AdminLiveResults key={`${state.status}-${state.question?.id}-${state.resultsVisible}`} initial={state} /></section>
        <aside className="space-y-5">
          <section className="card text-center"><Image className="mx-auto rounded-xl" src={qr} alt={`QR code to join session ${session.join_code}`} width={220} height={220} unoptimized /><p className="mt-3 break-all text-xs text-slate-500">{participantUrl}</p></section>
          <section className="card"><h2 className="font-bold">Session controls</h2><div className="mt-4 grid grid-cols-2 gap-2">
            <Control id={id} action={session.voting_open ? "close" : "open"} disabled={ended} label={session.voting_open ? "Close voting" : "Open voting"} icon={session.voting_open ? <Lock size={16} /> : <Play size={16} />} primary={!session.voting_open} />
            <Control id={id} action={session.results_visible ? "hide" : "reveal"} disabled={ended} label={session.results_visible ? "Hide results" : "Reveal results"} icon={session.results_visible ? <EyeOff size={16} /> : <Eye size={16} />} />
            <Control id={id} action="previous" disabled={ended || index <= 0} label="Previous" icon={<ChevronLeft size={16} />} />
            <Control id={id} action="next" disabled={ended || index < 0 || index >= (questions?.length ?? 0) - 1} label="Next" icon={<ChevronRight size={16} />} />
          </div>{!ended && <div className="mt-2"><Control id={id} action="end" label="End session" icon={<Square size={15} />} danger /></div>}</section>
          <section className="card"><h2 className="font-bold">Questions</h2><div className="mt-3 space-y-2">{questions?.map((question, questionIndex) => <form action={controlSession} key={question.id}><input type="hidden" name="sessionId" value={id} /><input type="hidden" name="control" value="set" /><input type="hidden" name="questionId" value={question.id} /><button disabled={ended} className={`w-full rounded-xl border p-3 text-left text-sm ${question.id === session.active_question_id ? "border-indigo-400 bg-indigo-50 font-bold text-indigo-900" : "border-slate-200 hover:bg-slate-50"}`}><span className="mr-2 text-xs text-slate-400">{questionIndex + 1}</span>{question.prompt}</button></form>)}</div></section>
        </aside>
      </div>
    </main>
  );
}

function Control({ id, action, label, icon, disabled, primary, danger }: { id: string; action: string; label: string; icon: React.ReactNode; disabled?: boolean; primary?: boolean; danger?: boolean }) {
  return <form action={controlSession} className={danger ? "w-full" : "contents"}><input type="hidden" name="sessionId" value={id} /><input type="hidden" name="control" value={action} /><button disabled={disabled} className={`${danger ? "btn-danger" : primary ? "btn-primary" : "btn-secondary"} w-full`}>{icon}{label}</button></form>;
}
