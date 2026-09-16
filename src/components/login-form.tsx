"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/login/actions";

export function LoginForm({ next }: { next?: string }) {
  const [error, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next ?? "/admin"} />
      <div><label className="label" htmlFor="email">Email</label><input className="field" id="email" name="email" type="email" required autoComplete="email" /></div>
      <div><label className="label" htmlFor="password">Password</label><input className="field" id="password" name="password" type="password" required minLength={8} autoComplete="current-password" /></div>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">{error}</p>}
      <button className="btn-primary w-full" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
