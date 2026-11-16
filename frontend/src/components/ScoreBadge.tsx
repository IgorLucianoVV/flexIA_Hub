import type { Scorecard, ScorecardLevel } from "../types";

const LEVELS: Record<ScorecardLevel, { label: string; icon: string; style: string }> = {
  ouro: { label: "Ouro", icon: "●", style: "bg-amber-50 text-amber-800 ring-amber-500/30" },
  prata: { label: "Prata", icon: "◐", style: "bg-slate-100 text-slate-700 ring-slate-400/40" },
  bronze: { label: "Bronze", icon: "◔", style: "bg-orange-50 text-orange-800 ring-orange-500/30" },
  inicial: { label: "Inicial", icon: "○", style: "bg-gray-100 text-gray-600 ring-gray-400/30" },
};

/** Nível de governança de um item do catálogo. O rótulo e o ícone acompanham a cor, para o
 * nível nunca depender só dela. */
export function ScoreBadge({ scorecard }: { scorecard: Scorecard }) {
  const level = LEVELS[scorecard.level];
  return (
    <span
      title={`Governança: ${scorecard.passed} de ${scorecard.total} verificações atendidas`}
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset whitespace-nowrap ${level.style}`}
    >
      <span aria-hidden="true">{level.icon}</span>
      {level.label} · {scorecard.passed}/{scorecard.total}
    </span>
  );
}
