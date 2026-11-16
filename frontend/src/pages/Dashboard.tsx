import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import type { DashboardSummary } from "../types";
import { HealthPill } from "../components/HealthPill";
import { ProgressBar } from "../components/ProgressBar";
import { dueLabel, formatDay } from "../lib/format";

export function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getDashboard()
      .then(setData)
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <div className="p-8 text-rose-600 text-sm">Não foi possível carregar a visão geral: {error}</div>;
  if (!data) return <div className="p-8 text-gray-400">Carregando…</div>;

  const { clients, alerts, activation, knowledge, forum } = data;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8">
      <header>
        <h1 className="text-2xl font-semibold">Visão geral</h1>
        <p className="text-gray-500 text-sm mt-1">
          Governança e descoberta de conhecimento técnico do squad FlexIA — catálogo, ativação e clientes em um só lugar.
        </p>
      </header>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard
          label="Clientes ativos"
          value={clients.total}
          sub={clients.atRisk > 0 ? `${clients.atRisk} em risco (score < ${clients.atRiskThreshold})` : "nenhum em risco"}
          to="/clientes"
        />
        <StatCard
          label="Alertas abertos"
          value={alerts.open}
          sub={alerts.high > 0 ? `${alerts.high} de severidade alta ou crítica` : "nenhum grave"}
          attention={alerts.high > 0}
          to="/clientes"
        />
        <StatCard
          label="Projetos de Ativação"
          value={activation.inProgress}
          sub={`em andamento · ${activation.overdue} atrasado(s)`}
          attention={activation.overdue > 0}
          to="/ativacao"
        />
        <StatCard
          label="Governança do catálogo"
          value={`${knowledge.averageScore}%`}
          sub={`${knowledge.total} itens · ${knowledge.stale} sem revisão recente`}
          to="/catalogo"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-1">
            <h2 className="font-semibold text-sm">Clientes que pedem atenção</h2>
            <Link to="/clientes" className="text-xs text-indigo-600 font-medium hover:underline">
              ver todos →
            </Link>
          </div>
          <p className="text-xs text-gray-500 mb-4">
            Health score médio: <b className="text-gray-700">{clients.avgHealth}</b> de 100 · menor score primeiro
          </p>
          <ul className="divide-y divide-gray-100">
            {clients.attention.map((c) => {
              const change = c.score_week_ago != null && c.health_score != null ? c.health_score - c.score_week_ago : null;
              return (
                <li key={c.id}>
                  <Link to={`/clientes/${c.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-gray-50 rounded px-1.5 -mx-1.5">
                    <span className="truncate">{c.name}</span>
                    <span className="flex items-center gap-3 shrink-0 text-xs">
                      {c.open_alerts > 0 && <span className="text-rose-700">{c.open_alerts} alerta(s)</span>}
                      {change !== null && change !== 0 && (
                        <span className="text-gray-500" title="Variação nos últimos 7 dias">
                          {change > 0 ? "▲" : "▼"} {Math.abs(change)} em 7d
                        </span>
                      )}
                      <HealthPill score={c.health_score} threshold={clients.atRiskThreshold} />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-sm">Projetos de Ativação em andamento</h2>
            <Link to="/ativacao" className="text-xs text-indigo-600 font-medium hover:underline">
              ver todos →
            </Link>
          </div>
          {activation.projects.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum projeto em andamento.</p>
          ) : (
            <div className="space-y-4">
              {activation.projects.map((p) => (
                <Link key={p.id} to={`/ativacao?projeto=${p.id}`} className="block hover:bg-gray-50 rounded px-1.5 -mx-1.5 py-1">
                  <div className="flex items-center justify-between text-sm mb-1 gap-2">
                    <span className="font-medium truncate">
                      {p.client_name} — {p.name}
                    </span>
                    <span className="text-gray-500 text-xs shrink-0">{p.progressPct}%</span>
                  </div>
                  <ProgressBar pct={p.progressPct} size="sm" />
                  <p className={`text-[11px] mt-1 ${p.is_overdue ? "text-rose-700 font-medium" : "text-gray-400"}`}>
                    {p.target_date ? `${p.is_overdue ? "⚠ Atrasado — prazo era" : "Prazo:"} ${formatDay(p.target_date)}` : "Sem prazo definido"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-sm mb-1">Entregas da semana</h2>
          <p className="text-xs text-gray-500 mb-4">Artefatos de ativação em aberto, vencidos ou vencendo nos próximos 7 dias.</p>
          {activation.upcoming.length === 0 ? (
            <p className="text-sm text-gray-400">Nada vencendo nos próximos 7 dias.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {activation.upcoming.map((a) => (
                <li key={a.id} className="py-2 flex items-start justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="truncate">{a.name}</p>
                    <p className="text-xs text-gray-400 truncate">
                      {a.client_name} · {a.project_name}
                    </p>
                  </div>
                  <span className={`text-xs shrink-0 ${a.is_overdue ? "text-rose-700 font-medium" : "text-gray-500"}`}>
                    {a.is_overdue ? "⚠ " : ""}
                    {dueLabel(a.due_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="font-semibold text-sm mb-4">Conhecimento e fórum</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <Fact label="Itens no catálogo" value={knowledge.total} to="/catalogo" />
            <Fact label="Itens nível ouro" value={knowledge.gold} to="/catalogo" />
            <Fact label="Itens sem revisão há 180+ dias" value={knowledge.stale} to="/catalogo" />
            <Fact label="Tópicos do fórum sem resposta" value={`${forum.unanswered} de ${forum.threads}`} to="/forum" />
          </dl>
        </section>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  sub,
  attention,
  to,
}: {
  label: string;
  value: number | string;
  sub?: string;
  attention?: boolean;
  to: string;
}) {
  return (
    <Link to={to} className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 transition-colors">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-semibold mt-1">{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${attention ? "text-rose-700 font-medium" : "text-gray-400"}`}>{attention ? "⚠ " : ""}{sub}</p>}
    </Link>
  );
}

function Fact({ label, value, to }: { label: string; value: number | string; to: string }) {
  return (
    <Link to={to} className="block hover:bg-gray-50 rounded-lg p-2 -m-2">
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-lg font-semibold mt-0.5">{value}</dd>
    </Link>
  );
}
