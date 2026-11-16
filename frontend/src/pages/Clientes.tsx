import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { Client } from "../types";
import { Badge } from "../components/Badge";
import { Modal } from "../components/Modal";
import { HealthPill } from "../components/HealthPill";

const PAGE_SIZE = 20;

export function Clientes() {
  const { user } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<"name" | "health">("health");
  const [showNew, setShowNew] = useState(false);

  const canCreate = user?.role === "admin" || user?.role === "analista_ativacao";

  function load() {
    setLoading(true);
    api
      .getClients({ q: q || undefined, sort, limit: PAGE_SIZE, offset: 0 })
      .then((res) => {
        setClients(res.items);
        setTotal(res.total);
      })
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    const timer = setTimeout(load, q ? 300 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort]);

  async function loadMore() {
    setLoadingMore(true);
    try {
      const res = await api.getClients({ q: q || undefined, sort, limit: PAGE_SIZE, offset: clients.length });
      setClients((prev) => [...prev, ...res.items]);
      setTotal(res.total);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="p-8 max-w-5xl mx-auto space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Clientes — Visão 360</h1>
          <p className="text-gray-500 text-sm mt-1">
            Selecione um cliente para ver tasks do ClickUp, documentação, alertas e métricas em um só lugar.
          </p>
        </div>
        {canCreate && (
          <button
            onClick={() => setShowNew(true)}
            className="px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 shrink-0"
          >
            + Novo cliente
          </button>
        )}
      </header>

      <div className="flex flex-wrap gap-2 items-center">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nome ou segmento…"
          className="px-3 py-2 text-sm border border-gray-200 rounded-lg w-72 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <label className="text-xs text-gray-500 flex items-center gap-1.5">
          Ordenar por
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as "name" | "health")}
            className="rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-sm text-gray-700"
          >
            <option value="health">Quem precisa de atenção primeiro</option>
            <option value="name">Nome</option>
          </select>
        </label>
      </div>

      {loading ? (
        <div className="text-gray-400">Carregando…</div>
      ) : clients.length === 0 ? (
        <div className="text-gray-400 text-sm">Nenhum cliente encontrado.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {clients.map((c) => (
              <Link
                key={c.id}
                to={`/clientes/${c.id}`}
                className="bg-white rounded-xl border border-gray-200 p-4 hover:border-indigo-300 hover:shadow-sm transition-all flex flex-col gap-2"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">{c.name}</h3>
                  <Badge value={c.status} />
                </div>
                <p className="text-xs text-gray-500">{c.segment ?? "Segmento não informado"}</p>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-gray-100 text-xs text-gray-500">
                  <span>CSM: {c.csm_owner ?? "—"}</span>
                  <span className="flex items-center gap-3">
                    {Number(c.open_alerts) > 0 && <span className="text-rose-700 font-medium">{c.open_alerts} alerta(s)</span>}
                    <span className="flex items-center gap-1.5">
                      Health <HealthPill score={c.health_score} />
                    </span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>
              {clients.length} de {total}
            </span>
            {clients.length < total && (
              <button onClick={loadMore} disabled={loadingMore} className="text-indigo-600 font-medium hover:underline disabled:opacity-50">
                {loadingMore ? "Carregando…" : "Carregar mais"}
              </button>
            )}
          </div>
        </>
      )}

      {showNew && (
        <NewClientModal
          onClose={() => setShowNew(false)}
          onCreated={() => {
            setShowNew(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function NewClientModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState("");
  const [segment, setSegment] = useState("");
  const [csmOwner, setCsmOwner] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.createClient({ name, segment: segment || undefined, csmOwner: csmOwner || undefined });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  const input = "mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <Modal title="Novo cliente" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-xs font-medium text-gray-600">
          Nome
          <input required value={name} onChange={(e) => setName(e.target.value)} className={input} />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          Segmento (opcional)
          <input value={segment} onChange={(e) => setSegment(e.target.value)} className={input} placeholder="Ex.: Saúde, Meios de pagamento" />
        </label>
        <label className="block text-xs font-medium text-gray-600">
          CSM responsável (opcional)
          <input value={csmOwner} onChange={(e) => setCsmOwner(e.target.value)} className={input} />
        </label>
        {error && <p className="text-xs text-rose-600 bg-rose-50 border border-rose-200 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg text-gray-600 hover:bg-gray-50">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={saving}
            className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {saving ? "Salvando…" : "Cadastrar"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
