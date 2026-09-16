import { LiveSession } from "@/components/live-session";

export default async function SessionPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <LiveSession code={code.toUpperCase()} />;
}
