/**
 * Scorecard de governança do Catálogo.
 *
 * Portais internos de desenvolvedor (Cortex, Port, OpsLevel, plugins do Backstage) medem a
 * "maturidade" de cada item do catálogo com um conjunto de verificações objetivas, e é isso
 * que transforma um catálogo de lista passiva em ferramenta de governança: fica visível o
 * que está sem dono, sem documentação ou parado há meses.
 *
 * A função é pura (sem banco): recebe o item e devolve as verificações, a nota e o nível.
 */
export const REVIEW_MAX_AGE_DAYS = 180;

export interface ScorecardInput {
  description?: string | null;
  owner_team?: string | null;
  tags?: string[] | null;
  status: string;
  gitlab_web_url?: string | null;
  last_synced_at?: Date | string | null;
  last_reviewed_at?: Date | string | null;
  deprecation_note?: string | null;
  replaced_by_id?: string | null;
}

export interface ScorecardCheck {
  key: string;
  label: string;
  passed: boolean;
  /** O que fazer para passar — só vem preenchido quando a verificação falha. */
  hint?: string;
}

export type ScorecardLevel = "ouro" | "prata" | "bronze" | "inicial";

export interface Scorecard {
  score: number;
  level: ScorecardLevel;
  passed: number;
  total: number;
  checks: ScorecardCheck[];
  /** Dias desde a última revisão/sincronização; `null` se nunca houve. */
  daysSinceReview: number | null;
  stale: boolean;
}

function daysSince(value: Date | string | null | undefined, now: Date): number | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((now.getTime() - date.getTime()) / 86_400_000);
}

export function computeScorecard(item: ScorecardInput, now: Date = new Date()): Scorecard {
  const reviewAges = [daysSince(item.last_reviewed_at, now), daysSince(item.last_synced_at, now)].filter(
    (d): d is number => d !== null
  );
  const daysSinceReview = reviewAges.length ? Math.min(...reviewAges) : null;
  const fresh = daysSinceReview !== null && daysSinceReview <= REVIEW_MAX_AGE_DAYS;

  const lifecycleDefined =
    item.status === "ativo" ||
    (item.status === "deprecado" && Boolean(item.deprecation_note?.trim() || item.replaced_by_id));

  const definitions: Array<Omit<ScorecardCheck, "hint"> & { hint: string }> = [
    {
      key: "owner",
      label: "Tem time responsável",
      passed: Boolean(item.owner_team?.trim()),
      hint: "Defina o time dono do item.",
    },
    {
      key: "description",
      label: "Descrição explica o que é e para que serve",
      passed: (item.description?.trim().length ?? 0) >= 40,
      hint: "Escreva uma descrição com pelo menos 40 caracteres.",
    },
    {
      key: "tags",
      label: "Tem tags para ser encontrado",
      passed: (item.tags?.length ?? 0) > 0,
      hint: "Adicione ao menos uma tag.",
    },
    {
      key: "source",
      label: "Vinculado ao repositório no GitLab",
      passed: Boolean(item.gitlab_web_url?.trim()),
      hint: "Informe o link do repositório (ou sincronize com o GitLab).",
    },
    {
      key: "fresh",
      label: `Revisado ou sincronizado nos últimos ${REVIEW_MAX_AGE_DAYS} dias`,
      passed: fresh,
      hint:
        daysSinceReview === null
          ? "Nunca foi revisado — confira os dados e marque como revisado."
          : `Última revisão há ${daysSinceReview} dias — confira os dados e marque como revisado.`,
    },
    {
      key: "lifecycle",
      label: "Ciclo de vida definido",
      passed: lifecycleDefined,
      hint:
        item.status === "deprecado"
          ? "Item descontinuado: informe o motivo ou o item que o substitui."
          : "Item em revisão: conclua a revisão e marque como ativo ou descontinuado.",
    },
  ];

  const checks: ScorecardCheck[] = definitions.map(({ hint, ...check }) =>
    check.passed ? check : { ...check, hint }
  );
  const passed = checks.filter((c) => c.passed).length;
  const total = checks.length;
  const score = Math.round((passed / total) * 100);
  const level: ScorecardLevel = score === 100 ? "ouro" : score >= 66 ? "prata" : score >= 33 ? "bronze" : "inicial";

  return { score, level, passed, total, checks, daysSinceReview, stale: !fresh };
}
