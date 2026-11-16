/** "AAAA-MM-DD" (ou data-hora ISO) -> "DD/MM/AAAA", sem deslocar o dia por fuso horário. */
export function formatDay(value?: string | null): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function timeAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "agora";
  if (mins < 60) return `${mins}min atrás`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h atrás`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d atrás`;
  return formatDay(iso);
}

/** Dias entre hoje e uma data "AAAA-MM-DD" (negativo = já passou). */
export function daysUntil(day: string): number {
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  const [year, month, date] = day.slice(0, 10).split("-").map(Number);
  return Math.round((Date.UTC(year, month - 1, date) - todayUtc) / 86_400_000);
}

export function dueLabel(day: string): string {
  const days = daysUntil(day);
  if (days < -1) return `venceu há ${-days} dias`;
  if (days === -1) return "venceu ontem";
  if (days === 0) return "vence hoje";
  if (days === 1) return "vence amanhã";
  return `vence em ${days} dias`;
}

export const KNOWLEDGE_TYPE_LABELS: Record<string, string> = {
  agente_ia: "Agente de IA",
  chatbot: "Chatbot",
  instruction: "Instruction",
  arvore_dialogo: "Árvore de diálogo",
  integracao: "Integração",
  infraestrutura: "Infraestrutura",
};

export const KNOWLEDGE_STATUS_LABELS: Record<string, string> = {
  ativo: "Ativo",
  em_revisao: "Em revisão",
  deprecado: "Descontinuado",
};
