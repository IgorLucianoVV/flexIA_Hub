import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { SearchResult } from "../types";
import { KNOWLEDGE_TYPE_LABELS } from "../lib/format";
import {
  IconActivation,
  IconCatalog,
  IconClients,
  IconDocument,
  IconForum,
  IconOverview,
  IconSearch,
  IconTask,
  type IconProps,
} from "./icons";

type IconComponent = (props: IconProps) => React.JSX.Element;

const TYPE_LABELS: Record<SearchResult["type"], string> = {
  cliente: "Clientes",
  catalogo: "Catálogo",
  ativacao: "Ativação",
  forum: "Fórum",
  documento: "Documentos",
  tarefa: "Tasks do ClickUp",
};
const TYPE_ICONS: Record<SearchResult["type"], IconComponent> = {
  cliente: IconClients,
  catalogo: IconCatalog,
  ativacao: IconActivation,
  forum: IconForum,
  documento: IconDocument,
  tarefa: IconTask,
};

const PAGES = [
  { title: "Visão geral", path: "/", icon: IconOverview },
  { title: "Catálogo de Conhecimento", path: "/catalogo", icon: IconCatalog },
  { title: "Ativação", path: "/ativacao", icon: IconActivation },
  { title: "Clientes — Visão 360", path: "/clientes", icon: IconClients },
  { title: "Fórum", path: "/forum", icon: IconForum },
];

/**
 * Busca global (Ctrl+K / ⌘K): ir direto a um cliente, item do catálogo, projeto, tópico,
 * documento ou task pelo nome. Setas navegam, Enter abre, Esc fecha.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setActive(0);
      // foco depois de o elemento existir na tela
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const current = ++requestId.current;
    const timer = setTimeout(() => {
      api
        .search(term)
        .then((res) => {
          // Ignora respostas de buscas antigas que chegarem depois de uma mais nova.
          if (current === requestId.current) {
            setResults(res.results);
            setActive(0);
          }
        })
        .catch(() => current === requestId.current && setResults([]))
        .finally(() => current === requestId.current && setLoading(false));
    }, 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Lista plana (na ordem em que aparece na tela) para a navegação por teclado.
  const entries = useMemo(() => {
    if (query.trim().length < 2) {
      return PAGES.map((p) => ({ key: p.path, title: p.title, subtitle: null as string | null, path: p.path, group: "Ir para", icon: p.icon }));
    }
    return results.map((r) => ({
      key: `${r.type}-${r.id}`,
      title: r.title,
      subtitle: r.type === "catalogo" ? (KNOWLEDGE_TYPE_LABELS[r.subtitle ?? ""] ?? r.subtitle) : r.subtitle,
      path: r.path,
      group: TYPE_LABELS[r.type],
      icon: TYPE_ICONS[r.type],
    }));
  }, [query, results]);

  if (!open) return null;

  function go(path: string) {
    onClose();
    navigate(path);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && entries[active]) {
      e.preventDefault();
      go(entries[active].path);
    }
  }

  let lastGroup = "";

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start justify-center pt-[12vh] px-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Busca global"
        className="w-full max-w-xl bg-white rounded-xl border border-gray-200 shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-2 px-4 border-b border-gray-100">
          <IconSearch className="h-4 w-4 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar cliente, item do catálogo, projeto, tópico, documento…"
            className="flex-1 py-3.5 text-sm focus:outline-none"
            aria-label="Buscar"
          />
          <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Esc</kbd>
        </div>

        <div className="max-h-[50vh] overflow-y-auto py-2">
          {loading && entries.length === 0 && <p className="px-4 py-3 text-sm text-gray-400">Buscando…</p>}
          {!loading && query.trim().length >= 2 && entries.length === 0 && (
            <p className="px-4 py-3 text-sm text-gray-400">
              Nada encontrado para “{query.trim()}”. Para perguntas em linguagem natural, use o Assistente de IA.
            </p>
          )}
          {entries.map((entry, index) => {
            const showGroup = entry.group !== lastGroup;
            lastGroup = entry.group;
            return (
              <div key={entry.key}>
                {showGroup && (
                  <p className="px-4 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-gray-400">{entry.group}</p>
                )}
                <button
                  onClick={() => go(entry.path)}
                  onMouseEnter={() => setActive(index)}
                  className={`w-full text-left px-4 py-2 flex items-center gap-3 text-sm ${
                    index === active ? "bg-indigo-50 text-indigo-900" : "text-gray-700"
                  }`}
                >
                  <entry.icon className={`h-4 w-4 ${index === active ? "text-indigo-700" : "text-gray-400"}`} />
                  <span className="truncate font-medium">{entry.title}</span>
                  {entry.subtitle && <span className="truncate text-xs text-gray-400">{entry.subtitle}</span>}
                </button>
              </div>
            );
          })}
        </div>

        <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400 flex gap-4">
          <span>↑↓ navegar</span>
          <span>Enter abrir</span>
          <span>Ignora acentos e maiúsculas</span>
        </div>
      </div>
    </div>
  );
}
