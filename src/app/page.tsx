import Link from "next/link";
import { BarChart3, Radio, ShieldCheck } from "lucide-react";
import { JoinForm } from "@/components/join-form";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-5 py-8 sm:py-14">
      <nav className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-lg font-black"><Radio className="text-indigo-600" /> PulsePoll</div>
        <Link className="btn-secondary" href="/login">Admin sign in</Link>
      </nav>
      <section className="grid flex-1 items-center gap-12 py-12 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <p className="eyebrow">Live audience polling</p>
          <h1 className="mt-4 max-w-2xl text-5xl font-black leading-[1.05] tracking-tight text-slate-950 sm:text-6xl">
            Ask the room. See the answer live.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-8 text-slate-600">
            A fast, account-free voting experience for events, workshops and town halls.
          </p>
          <div className="mt-8 hidden gap-5 text-sm font-semibold text-slate-600 sm:flex">
            <span className="flex items-center gap-2"><ShieldCheck size={18} /> Anonymous</span>
            <span className="flex items-center gap-2"><BarChart3 size={18} /> Live results</span>
          </div>
        </div>
        <div className="card p-7 sm:p-9">
          <h2 className="text-2xl font-bold">Join a live session</h2>
          <p className="mt-2 text-slate-500">No account needed.</p>
          <JoinForm />
        </div>
      </section>
    </main>
  );
}
