"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { PublicSessionState } from "@/lib/types";
import { ResultBars } from "@/components/result-bars";

export function PresentationView({ code, initial }: { code: string; initial: PublicSessionState }) {
  const [state, setState] = useState<PublicSessionState>(initial);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/sessions/${code}/state`, { cache: "no-store" });
    if (response.ok) setState(await response.json() as PublicSessionState);
  }, [code]);
  const scheduleRefresh = useCallback(() => {
    if (refreshTimer.current) return;
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      void refresh();
    }, 250);
  }, [refresh]);
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`session:${code}`, { config: { private: false } })
      .on("broadcast", { event: "session_state" }, scheduleRefresh)
      .on("broadcast", { event: "result_update" }, scheduleRefresh)
      .subscribe();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      void supabase.removeChannel(channel);
    };
  }, [code, scheduleRefresh]);
  return (
    <main className="flex min-h-screen flex-col bg-slate-950 px-[5vw] py-[4vh] text-white">
      <header className="flex items-center justify-between"><span className="flex items-center gap-3 text-2xl font-black"><Radio className="text-indigo-400" /> PulsePoll</span><div className="text-right"><span className="text-sm uppercase tracking-widest text-slate-400">Join with</span><div className="text-4xl font-black tracking-[0.18em] text-indigo-300">{code}</div></div></header>
      <section className="flex flex-1 flex-col justify-center py-10">
        {state.status === "ended" ? <div className="text-center"><h1 className="text-7xl font-black">Thanks for participating</h1><p className="mt-5 text-2xl text-slate-400">This session has ended.</p></div>
          : !state.question ? <h1 className="text-center text-6xl font-black">Waiting for the first question…</h1>
          : <div className="grid items-center gap-[5vw] lg:grid-cols-2"><div><p className="text-lg font-bold uppercase tracking-widest text-indigo-400">{state.pollTitle}</p><h1 className="mt-5 text-5xl font-black leading-tight xl:text-7xl">{state.question.prompt}</h1><div className="mt-10 flex gap-5 text-xl text-slate-400"><span>{state.responseCount} responses</span><span>·</span><span>{state.votingOpen ? "Voting open" : "Voting closed"}</span></div></div><div className="rounded-3xl bg-white p-8 text-slate-900 shadow-2xl xl:p-12">{state.resultsVisible ? (state.question.type === "free_text" ? <div className="py-20 text-center"><div className="text-7xl font-black text-indigo-600">{state.responseCount}</div><p className="mt-4 text-xl text-slate-500">responses received</p></div> : <ResultBars results={state.results} />) : <div className="py-20 text-center"><h2 className="text-3xl font-black">Results are hidden</h2><p className="mt-3 text-lg text-slate-500">They’ll appear when the host reveals them.</p></div>}</div></div>}
      </section>
    </main>
  );
}
