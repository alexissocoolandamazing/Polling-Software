import Link from "next/link";
import { redirect } from "next/navigation";
import { Radio } from "lucide-react";
import { LoginForm } from "@/components/login-form";
import { createClient } from "@/lib/supabase/server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (data?.claims) redirect("/admin");
  const query = await searchParams;
  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="card w-full max-w-md p-8">
        <Link href="/" className="flex items-center gap-2 font-black"><Radio className="text-indigo-600" /> PulsePoll</Link>
        <h1 className="mt-8 text-3xl font-black">Admin sign in</h1>
        <p className="mt-2 text-slate-500">Manage polls and run live sessions.</p>
        <LoginForm next={query.next} />
        <p className="mt-5 text-xs leading-5 text-slate-500">Admin accounts are provisioned in Supabase Auth; public self-registration is disabled by design.</p>
      </div>
    </main>
  );
}
