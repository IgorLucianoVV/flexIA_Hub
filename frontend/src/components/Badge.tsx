import { IconAlert } from "./icons";

const STATUS_STYLES: Record<string, string> = {
  ativo: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  pausado: "bg-amber-50 text-amber-700 ring-amber-600/20",
  encerrado: "bg-gray-100 text-gray-600 ring-gray-500/20",
  em_andamento: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
  planejado: "bg-gray-100 text-gray-600 ring-gray-500/20",
  concluido: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  atrasado: "bg-rose-50 text-rose-700 ring-rose-600/20",
  pendente: "bg-gray-100 text-gray-600 ring-gray-500/20",
  bloqueado: "bg-rose-50 text-rose-700 ring-rose-600/20",
  baixa: "bg-sky-50 text-sky-700 ring-sky-600/20",
  media: "bg-amber-50 text-amber-700 ring-amber-600/20",
  alta: "bg-orange-50 text-orange-700 ring-orange-600/20",
  critica: "bg-rose-50 text-rose-700 ring-rose-600/20",
  deprecado: "bg-gray-100 text-gray-500 ring-gray-500/20",
  em_revisao: "bg-amber-50 text-amber-700 ring-amber-600/20",
};

/** `alert` antepõe o ícone de alerta ao rótulo (ex.: "prazo vencido"). */
export function Badge({ value, label, alert = false }: { value: string; label?: string; alert?: boolean }) {
  const style = STATUS_STYLES[value] ?? "bg-gray-100 text-gray-600 ring-gray-500/20";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap ${style}`}>
      {alert && <IconAlert className="h-3.5 w-3.5" />}
      {label ?? value.replace(/_/g, " ")}
    </span>
  );
}
