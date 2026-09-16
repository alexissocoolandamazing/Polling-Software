import { NextResponse } from "next/server";
import { getPublicSessionState } from "@/lib/session-state";
import { joinCodeSchema } from "@/lib/validation";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const parsed = joinCodeSchema.safeParse((await params).code);
  if (!parsed.success) return NextResponse.json({ error: "Invalid session code." }, { status: 400 });
  const state = await getPublicSessionState(parsed.data);
  if (!state) return NextResponse.json({ error: "Session not found." }, { status: 404 });
  return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
}
