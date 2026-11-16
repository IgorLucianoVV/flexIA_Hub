interface Props {
  pct: number;
  size?: "sm" | "md";
}

function colorFor(pct: number) {
  if (pct >= 100) return "bg-emerald-500";
  if (pct >= 60) return "bg-indigo-500";
  if (pct >= 30) return "bg-amber-500";
  return "bg-rose-500";
}

export function ProgressBar({ pct, size = "md" }: Props) {
  const clamped = Math.max(0, Math.min(100, pct));
  const height = size === "sm" ? "h-1.5" : "h-2.5";
  return (
    <div className="w-full">
      <div className={`w-full ${height} rounded-full bg-gray-200 overflow-hidden`}>
        <div
          className={`${height} rounded-full ${colorFor(clamped)} transition-all duration-500`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}
