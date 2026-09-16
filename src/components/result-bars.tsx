import type { ResultItem } from "@/lib/types";

export function ResultBars({ results }: { results: ResultItem[] }) {
  if (!results.length) return <p className="py-8 text-center text-slate-500">Results will appear here.</p>;
  return (
    <div className="space-y-4">
      {results.map((result) => (
        <div key={result.optionId ?? result.label}>
          <div className="mb-1.5 flex items-center justify-between gap-4 text-sm font-semibold">
            <span className="truncate">{result.label}</span><span>{result.count} · {result.percentage.toFixed(0)}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-indigo-500 transition-[width] duration-500" style={{ width: `${Math.max(result.percentage, result.count ? 2 : 0)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
