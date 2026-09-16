"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Radio } from "lucide-react";
import Link from "next/link";
import type { PublicSessionState } from "@/lib/types";
import { validateVoteShape } from "@/lib/domain/vote";
import {
  buildRelayWebSocketUrl,
  isSessionStateRelayMessage,
  RELAY_FALLBACK_POLL_MS,
  relayReconnectDelay,
  sessionQuestionKey,
} from "@/lib/domain/relay";
import { ResultBars } from "@/components/result-bars";

type VoteDraft = { optionIds: string[]; textAnswer: string | null; ratingAnswer: number | null };
const emptyVote: VoteDraft = { optionIds: [], textAnswer: null, ratingAnswer: null };

export function LiveSession({ code }: { code: string }) {
  const [state, setState] = useState<PublicSessionState | null>(null);
  const [vote, setVote] = useState<VoteDraft>(emptyVote);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const joinRequest = useRef<{ code: string; promise: Promise<void> } | null>(null);
  const lastQuestionKey = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/sessions/${code}/state`, { cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).error ?? "Session unavailable.");
    const nextState = await response.json() as PublicSessionState;
    const nextQuestionKey = sessionQuestionKey(nextState);
    if (lastQuestionKey.current && lastQuestionKey.current !== nextQuestionKey) {
      setConfirmed(false);
      setVote(emptyVote);
      setError("");
    }
    lastQuestionKey.current = nextQuestionKey;
    setState(nextState);
  }, [code]);

  useEffect(() => {
    let active = true;

    // React Strict Mode can run the mount effect twice in development. Reuse
    // one in-flight join request so we neither create duplicate participants
    // nor leave the second effect stuck in the loading state.
    if (!joinRequest.current || joinRequest.current.code !== code) {
      joinRequest.current = {
        code,
        promise: (async () => {
          const response = await fetch(`/api/sessions/${code}/join`, { method: "POST" });
          if (!response.ok) throw new Error((await response.json()).error ?? "Could not join.");
        })(),
      };
    }

    async function finishJoin() {
      try {
        await joinRequest.current!.promise;
        if (!active) return;
        await refresh();
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : "Could not join.");
      } finally {
        if (active) setLoading(false);
      }
    }

    void finishJoin();
    return () => { active = false; };
  }, [code, refresh]);

  useEffect(() => {
    const endpoint = buildRelayWebSocketUrl(process.env.NEXT_PUBLIC_REALTIME_RELAY_URL, code);
    let disposed = false;
    let socket: WebSocket | null = null;
    let reconnectAttempt = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let fallbackTimer: ReturnType<typeof setInterval> | null = null;

    const refreshSilently = () => {
      void refresh().catch(() => undefined);
    };
    const startFallbackPolling = () => {
      if (fallbackTimer) return;
      refreshSilently();
      fallbackTimer = setInterval(refreshSilently, RELAY_FALLBACK_POLL_MS);
    };
    const stopFallbackPolling = () => {
      if (!fallbackTimer) return;
      clearInterval(fallbackTimer);
      fallbackTimer = null;
    };
    const scheduleReconnect = () => {
      if (!endpoint || disposed || reconnectTimer) return;
      const delay = relayReconnectDelay(reconnectAttempt++);
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };
    const connect = () => {
      if (!endpoint || disposed || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
        if (!endpoint) startFallbackPolling();
        return;
      }

      let nextSocket: WebSocket;
      try {
        nextSocket = new WebSocket(endpoint);
      } catch {
        startFallbackPolling();
        scheduleReconnect();
        return;
      }
      socket = nextSocket;
      nextSocket.addEventListener("open", () => {
        reconnectAttempt = 0;
        stopFallbackPolling();
        refreshSilently();
      });
      nextSocket.addEventListener("message", (event) => {
        if (isSessionStateRelayMessage(event.data)) refreshSilently();
      });
      nextSocket.addEventListener("close", () => {
        if (socket === nextSocket) socket = null;
        if (disposed) return;
        startFallbackPolling();
        scheduleReconnect();
      });
      nextSocket.addEventListener("error", () => nextSocket.close());
    };
    const reconnectNow = () => {
      refreshSilently();
      if (!endpoint || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      reconnectTimer = null;
      connect();
    };
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") reconnectNow();
    };

    connect();
    window.addEventListener("online", reconnectNow);
    document.addEventListener("visibilitychange", refreshWhenVisible);

    return () => {
      disposed = true;
      window.removeEventListener("online", reconnectNow);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      if (reconnectTimer) clearTimeout(reconnectTimer);
      stopFallbackPolling();
      socket?.close(1000, "Participant left");
    };
  }, [code, refresh]);

  const ratingRange = useMemo(() => ({ min: state?.question?.settings.min ?? 1, max: state?.question?.settings.max ?? 5 }), [state]);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!state?.question) return;
    const validation = validateVoteShape(state.question.type, vote, ratingRange);
    if (validation) { setError(validation); return; }
    setSubmitting(true); setError("");
    const response = await fetch(`/api/sessions/${code}/vote`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...vote, questionId: state.question.id, requestId: crypto.randomUUID() }),
    });
    if (response.ok) { setConfirmed(true); await refresh(); }
    else setError((await response.json()).error ?? "Could not submit your response.");
    setSubmitting(false);
  }

  if (loading) return <Centered><Loader2 className="animate-spin text-indigo-600" /><p>Joining session…</p></Centered>;
  if (error && !state) return <Centered><p className="text-lg font-bold text-red-700">{error}</p><Link className="btn-secondary" href="/">Try another code</Link></Centered>;
  if (!state) return null;
  if (state.status === "ended") return <Centered><CheckCircle2 size={40} className="text-indigo-600" /><h1 className="text-2xl font-black">Session complete</h1><p className="text-slate-500">Thanks for taking part.</p></Centered>;

  const question = state.question;
  return (
    <main className="mx-auto min-h-screen max-w-xl px-4 py-5 sm:py-10">
      <header className="flex items-center justify-between"><span className="flex items-center gap-2 font-black"><Radio size={19} className="text-indigo-600" /> PulsePoll</span><span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold shadow-sm">{code}</span></header>
      <section className="card mt-6 p-6 sm:p-8">
        <p className="eyebrow">{state.pollTitle}</p>
        {!question ? <div className="py-14 text-center"><h1 className="text-2xl font-black">Waiting for a question</h1><p className="mt-2 text-slate-500">Your host will begin shortly.</p></div> : <>
          <h1 className="mt-3 text-2xl font-black leading-tight sm:text-3xl">{question.prompt}</h1>
          {confirmed ? <div className="mt-8 rounded-2xl bg-emerald-50 p-7 text-center"><CheckCircle2 className="mx-auto text-emerald-600" size={42} /><h2 className="mt-3 text-xl font-black text-emerald-900">Response recorded</h2><p className="mt-1 text-sm text-emerald-700">You’re all set for this question.</p>{state.allowVoteChanges && state.votingOpen && <button type="button" className="btn-secondary mt-4" onClick={() => setConfirmed(false)}>Change response</button>}</div>
            : !state.votingOpen ? <div className="mt-8 rounded-2xl bg-amber-50 p-5 text-center"><p className="font-bold text-amber-900">Voting is currently closed</p><p className="mt-1 text-sm text-amber-700">This screen updates automatically.</p></div>
            : <form className="mt-7 space-y-3" onSubmit={submit}>
              {question.options.map((option) => <label className={`flex min-h-14 items-center gap-3 rounded-xl border p-4 font-semibold transition ${vote.optionIds.includes(option.id) ? "border-indigo-500 bg-indigo-50 text-indigo-900" : "border-slate-200"}`} key={option.id}><input type={question.type === "multiple_choice" ? "checkbox" : "radio"} name="answer" checked={vote.optionIds.includes(option.id)} onChange={() => setVote((current) => ({ ...current, optionIds: question.type === "multiple_choice" ? (current.optionIds.includes(option.id) ? current.optionIds.filter((id) => id !== option.id) : [...current.optionIds, option.id]) : [option.id] }))} />{option.label}</label>)}
              {question.type === "rating" && <div className="grid grid-cols-5 gap-2">{Array.from({ length: ratingRange.max - ratingRange.min + 1 }, (_, index) => index + ratingRange.min).map((rating) => <button type="button" onClick={() => setVote((current) => ({ ...current, ratingAnswer: rating }))} className={`aspect-square rounded-xl border text-lg font-black ${vote.ratingAnswer === rating ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-200 bg-white"}`} key={rating}>{rating}</button>)}</div>}
              {question.type === "free_text" && <textarea className="field min-h-32" maxLength={2000} placeholder="Type your response" value={vote.textAnswer ?? ""} onChange={(event) => setVote((current) => ({ ...current, textAnswer: event.target.value }))} />}
              {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
              <button className="btn-primary mt-2 h-14 w-full text-base" disabled={submitting}>{submitting ? <><Loader2 size={18} className="animate-spin" /> Submitting…</> : "Submit response"}</button>
            </form>}
          {state.resultsVisible && <div className="mt-8 border-t border-slate-200 pt-6"><div className="mb-5 flex items-center justify-between"><h2 className="font-bold">Live results</h2><span className="text-sm text-slate-500">{state.responseCount} responses</span></div><ResultBars results={state.results} /></div>}
        </>}
      </section>
    </main>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-5 text-center">{children}</main>;
}
