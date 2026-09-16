"use client";

import { useEffect, useState } from "react";
import { Users, Vote } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { PublicSessionState } from "@/lib/types";
import { ResultBars } from "@/components/result-bars";

export function AdminLiveResults({ initial }: { initial: PublicSessionState }) {
  const [state, setState] = useState(initial);
  const router = useRouter();

  useEffect(() => {
    setState(initial);
  }, [initial]);

  useEffect(() => {
    const supabase = createClient();
    const filter = `session_id=eq.${initial.sessionId}`;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        router.refresh();
      }, 250);
    };

    const channel = supabase.channel(`admin-session-${initial.sessionId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "poll_sessions", filter: `id=eq.${initial.sessionId}` }, () => router.refresh())
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "session_stats", filter }, ({ new: row }: { new: Record<string, unknown> }) => {
        setState((current) => ({ ...current, participantCount: Number(row.participant_count) }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "question_count_shards", filter }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "option_count_shards", filter }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "rating_count_shards", filter }, scheduleRefresh)
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      void supabase.removeChannel(channel);
    };
  }, [initial.sessionId, router]);

  const responsePercentage = state.participantCount ? Math.min(100, (state.responseCount / state.participantCount) * 100) : 0;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric icon={<Users size={18} />} label="Participants" value={state.participantCount} />
        <Metric icon={<Vote size={18} />} label="Responses" value={state.responseCount} />
        <Metric label="Response rate" value={`${responsePercentage.toFixed(0)}%`} />
      </div>
      <div className="card">
        <div className="mb-6 flex items-center justify-between gap-4"><div><p className="eyebrow">Live results</p><h2 className="mt-1 text-xl font-bold">{state.question?.prompt ?? "No active question"}</h2></div><span className={`rounded-full px-3 py-1 text-xs font-bold ${state.resultsVisible ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{state.resultsVisible ? "Visible" : "Hidden"}</span></div>
        {state.question?.type === "free_text" ? <p className="py-8 text-center text-slate-500">{state.responseCount} text responses received. Text review and export are planned for the next phase.</p> : <ResultBars results={state.results} />}
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon?: React.ReactNode; label: string; value: React.ReactNode }) {
  return <div className="card"><div className="flex items-center gap-2 text-sm font-semibold text-slate-500">{icon}{label}</div><div className="mt-2 text-3xl font-black">{value}</div></div>;
}
