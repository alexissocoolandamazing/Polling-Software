"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function JoinForm() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState("");

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const normalized = code.trim().toUpperCase();
    if (!/^[A-HJ-NP-Z2-9]{6}$/.test(normalized)) {
      setError("Enter the 6-character code shown by your host.");
      return;
    }
    router.push(`/session/${normalized}`);
  }

  return (
    <form onSubmit={submit} className="mt-8 space-y-3">
      <label htmlFor="join-code" className="label text-left">Session code</label>
      <input
        id="join-code" autoComplete="off" autoCapitalize="characters" inputMode="text"
        className="field h-14 text-center text-xl font-bold uppercase tracking-[0.3em]"
        maxLength={6} placeholder="ABC234" value={code}
        onChange={(event) => { setCode(event.target.value); setError(""); }}
      />
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <button className="btn-primary h-14 w-full text-base" type="submit">Join poll</button>
    </form>
  );
}
