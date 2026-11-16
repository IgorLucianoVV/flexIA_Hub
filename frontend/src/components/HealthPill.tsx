/** Health score com rótulo de risco: o aviso (⚠) acompanha a cor, nunca depende só dela. */
export function HealthPill({ score, threshold = 70 }: { score: number | null | undefined; threshold?: number }) {
  const atRisk = score != null && score < threshold;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
        score == null
          ? "bg-gray-100 text-gray-500 ring-gray-400/20"
          : atRisk
            ? "bg-rose-50 text-rose-700 ring-rose-600/20"
            : "bg-emerald-50 text-emerald-700 ring-emerald-600/20"
      }`}
      title={atRisk ? "Cliente em risco" : undefined}
    >
      {atRisk ? "⚠ " : ""}
      {score ?? "—"}
    </span>
  );
}
