import { useMemo, useState, type PointerEvent } from "react";
import type { HealthPoint } from "../types";
import { formatDay } from "../lib/format";

const WIDTH = 560;
const HEIGHT = 150;
const PAD = { top: 12, right: 44, bottom: 22, left: 30 };
const AT_RISK = 70;

/**
 * Tendência do health score (uma série só, eixo fixo de 0 a 100).
 *
 * O eixo não é cortado: como o score é uma nota de 0 a 100, mostrar a escala inteira evita
 * que uma oscilação de 3 pontos pareça uma queda dramática. A linha tracejada marca o
 * limite de "cliente em risco". Passe o mouse (ou toque) para ler o valor de cada dia.
 */
export function HealthTrend({ points }: { points: HealthPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);

  const geometry = useMemo(() => {
    const innerW = WIDTH - PAD.left - PAD.right;
    const innerH = HEIGHT - PAD.top - PAD.bottom;
    const start = new Date(points[0]?.date ?? Date.now()).getTime();
    const end = new Date(points[points.length - 1]?.date ?? Date.now()).getTime();
    const span = Math.max(end - start, 1);
    const x = (date: string) => PAD.left + ((new Date(date).getTime() - start) / span) * innerW;
    const y = (score: number) => PAD.top + (1 - score / 100) * innerH;
    return { x, y, coords: points.map((p) => ({ ...p, cx: x(p.date), cy: y(p.score) })) };
  }, [points]);

  if (points.length < 2) {
    return (
      <p className="text-sm text-gray-400">
        O histórico começa a se formar agora: um ponto por dia, a cada recálculo do health score.
      </p>
    );
  }

  const { coords, y } = geometry;
  const path = coords.map((p, i) => `${i === 0 ? "M" : "L"}${p.cx.toFixed(1)},${p.cy.toFixed(1)}`).join(" ");
  const last = coords[coords.length - 1];
  const first = coords[0];
  const delta = last.score - first.score;
  const active = hover !== null ? coords[hover] : null;

  function handleMove(e: PointerEvent<SVGSVGElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * WIDTH;
    let nearest = 0;
    coords.forEach((p, i) => {
      if (Math.abs(p.cx - px) < Math.abs(coords[nearest].cx - px)) nearest = i;
    });
    setHover(nearest);
  }

  return (
    <div>
      <p className="text-xs text-gray-500 mb-2">
        {delta === 0 ? "Estável" : delta > 0 ? `Subiu ${delta} pontos` : `Caiu ${-delta} pontos`} desde {formatDay(first.date)}
      </p>
      <div className="relative">
        <svg
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="w-full h-auto touch-none"
          role="img"
          aria-label={`Health score de ${first.score} em ${formatDay(first.date)} para ${last.score} em ${formatDay(last.date)}`}
          onPointerMove={handleMove}
          onPointerLeave={() => setHover(null)}
        >
          {[0, 50, 100].map((tick) => (
            <g key={tick}>
              <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y(tick)} y2={y(tick)} stroke="#e5e7eb" strokeWidth={1} />
              <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="#9ca3af">
                {tick}
              </text>
            </g>
          ))}
          <line
            x1={PAD.left}
            x2={WIDTH - PAD.right}
            y1={y(AT_RISK)}
            y2={y(AT_RISK)}
            stroke="#9ca3af"
            strokeWidth={1}
            strokeDasharray="4 4"
          />
          <text x={WIDTH - PAD.right + 4} y={y(AT_RISK) + 3} fontSize={10} fill="#6b7280">
            risco
          </text>

          <path d={path} fill="none" stroke="#4f46e5" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

          {active && (
            <line x1={active.cx} x2={active.cx} y1={PAD.top} y2={HEIGHT - PAD.bottom} stroke="#9ca3af" strokeWidth={1} />
          )}
          {/* Ponto final sempre marcado e rotulado; os demais só aparecem no hover. */}
          <circle cx={last.cx} cy={last.cy} r={4} fill="#4f46e5" stroke="#ffffff" strokeWidth={2} />
          <text x={last.cx + 8} y={last.cy + 4} fontSize={12} fontWeight={600} fill="#111827">
            {last.score}
          </text>
          {active && active !== last && (
            <circle cx={active.cx} cy={active.cy} r={4} fill="#4f46e5" stroke="#ffffff" strokeWidth={2} />
          )}

          <text x={PAD.left} y={HEIGHT - 6} fontSize={10} fill="#9ca3af">
            {formatDay(first.date)}
          </text>
          <text x={WIDTH - PAD.right} y={HEIGHT - 6} fontSize={10} fill="#9ca3af" textAnchor="end">
            {formatDay(last.date)}
          </text>
        </svg>

        {active && (
          <div
            className="absolute -translate-x-1/2 pointer-events-none bg-gray-900 text-white text-xs rounded-md px-2 py-1 whitespace-nowrap"
            style={{ left: `${(active.cx / WIDTH) * 100}%`, top: 0 }}
          >
            {formatDay(active.date)} · <b>{active.score}</b>
          </div>
        )}
      </div>

      <details className="mt-2 text-xs text-gray-500">
        <summary className="cursor-pointer hover:text-gray-700">Ver como tabela</summary>
        <table className="mt-2 w-full max-w-xs">
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.date} className="border-t border-gray-100">
                <td className="py-1">{formatDay(p.date)}</td>
                <td className="py-1 text-right font-medium text-gray-700">{p.score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
