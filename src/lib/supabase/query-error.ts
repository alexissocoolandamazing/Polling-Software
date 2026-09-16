import "server-only";
import type { PostgrestError } from "@supabase/supabase-js";

export function throwSupabaseQueryError(
  operation: string,
  error: PostgrestError,
  context: Record<string, string> = {},
): never {
  console.error(`[PulsePoll] ${operation} failed`, {
    ...context,
    code: error.code,
    message: error.message,
    details: error.details,
    hint: error.hint,
  });

  throw new Error(`${operation} failed (${error.code}): ${error.message}`);
}
