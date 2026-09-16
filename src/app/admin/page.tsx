import Link from "next/link";
import { ArrowRight, Plus } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { createPoll } from "./actions";

export default async function AdminDashboard() {
  const { supabase } = await requireAdmin();
  const { data: polls, error } = await supabase.from("polls")
    .select("id,title,description,created_at,poll_sessions(id,status,join_code,created_at)")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (
    <main className="mx-auto max-w-6xl px-5 py-10">
      <div><p className="eyebrow">Dashboard</p><h1 className="mt-2 text-4xl font-black">Your polls</h1></div>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_340px]">
        <section className="space-y-4">
          {!polls?.length && <div className="card py-14 text-center text-slate-500">No polls yet. Create your first one to get started.</div>}
          {polls?.map((poll) => {
            const sessions = [...(poll.poll_sessions ?? [])].sort((a, b) => b.created_at.localeCompare(a.created_at));
            const latest = sessions[0];
            return (
              <article className="card" key={poll.id}>
                <div className="flex items-start justify-between gap-4">
                  <div><h2 className="text-xl font-bold">{poll.title}</h2><p className="mt-1 line-clamp-2 text-sm text-slate-500">{poll.description || "No description"}</p></div>
                  <Link className="btn-secondary" href={`/admin/polls/${poll.id}`}>Edit <ArrowRight size={16} /></Link>
                </div>
                {latest && <div className="mt-4 border-t border-slate-100 pt-4 text-sm"><span className={`mr-2 rounded-full px-2.5 py-1 font-semibold ${latest.status === "live" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{latest.status}</span><Link className="font-semibold text-indigo-600" href={`/admin/sessions/${latest.id}`}>Session {latest.join_code}</Link></div>}
              </article>
            );
          })}
        </section>
        <aside className="card h-fit">
          <div className="flex items-center gap-2"><Plus className="text-indigo-600" /><h2 className="text-lg font-bold">Create a poll</h2></div>
          <form action={createPoll} className="mt-5 space-y-4">
            <div><label className="label" htmlFor="title">Title</label><input className="field" id="title" name="title" required maxLength={120} placeholder="Quarterly town hall" /></div>
            <div><label className="label" htmlFor="description">Description</label><textarea className="field min-h-24" id="description" name="description" maxLength={1000} /></div>
            <button className="btn-primary w-full">Create poll</button>
          </form>
        </aside>
      </div>
    </main>
  );
}
