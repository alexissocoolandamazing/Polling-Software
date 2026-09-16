import { PresentationView } from "@/components/presentation-view";
import { notFound } from "next/navigation";
import { getPublicSessionState } from "@/lib/session-state";

export default async function PresentPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const normalized = code.toUpperCase();
  const initial = await getPublicSessionState(normalized);
  if (!initial) notFound();
  return <PresentationView code={normalized} initial={initial} />;
}
