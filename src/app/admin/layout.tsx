import Link from "next/link";
import { LogOut, Radio } from "lucide-react";
import { requireAdmin } from "@/lib/auth";
import { logoutAction } from "@/app/login/actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return (
    <div className="min-h-screen">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/admin" className="flex items-center gap-2 text-lg font-black"><Radio className="text-indigo-600" /> PulsePoll <span className="text-sm font-medium text-slate-400">Admin</span></Link>
          <form action={logoutAction}><button className="btn-secondary" type="submit"><LogOut size={16} /> Sign out</button></form>
        </div>
      </header>
      {children}
    </div>
  );
}
