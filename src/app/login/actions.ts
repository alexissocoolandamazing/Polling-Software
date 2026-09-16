"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const loginSchema = z.object({ email: z.email(), password: z.string().min(8), next: z.string().optional() });

export async function loginAction(_state: string | null, formData: FormData): Promise<string | null> {
  const parsed = loginSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return "Enter a valid email and password.";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return "Sign-in failed. Check your details and try again.";
  const destination = parsed.data.next?.startsWith("/admin") ? parsed.data.next : "/admin";
  redirect(destination);
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/");
}
