import { useMemo, useState } from "react";
import type { DialogEdge, DialogNode, DialogTree } from "../../types";
import { IconChevronDown, IconSearch } from "../icons";
import { dialogTreeToMermaid } from "./dialogTreeMermaid";
import { MermaidDiagram } from "./MermaidDiagram";

/**
 * Árvore de diálogo navegável.
 *
 * Dois modos: "Navegar" mostra o fluxo como um índice expansível a partir do nó inicial (com
 * busca e o painel do nó selecionado: o que o bot diz, de onde se chega e para onde vai) e
 * "Mapa" desenha o grafo inteiro com Mermaid, bom para fluxos de até ~120 nós.
 */
const MAP_MAX_NODES = 120;

const normalize = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

interface TreeIndex {
  byId: Map<string, DialogNode>;
  exits: Map<string, DialogEdge[]>;
  entries: Map<string, DialogEdge[]>;
  /** Primeiro caminho (em largura) da raiz até cada nó alcançável. */
  parentOf: Map<string, string | null>;
  unreachable: DialogNode[];
  finals: number;
  depth: number;
}

function indexTree(tree: DialogTree): TreeIndex {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const exits = new Map<string, DialogEdge[]>();
  const entries = new Map<string, DialogEdge[]>();
  for (const e of tree.edges) {
    exits.set(e.from, [...(exits.get(e.from) ?? []), e]);
    entries.set(e.to, [...(entries.get(e.to) ?? []), e]);
  }
  const parentOf = new Map<string, string | null>();
  let depth = 0;
  if (tree.root && byId.has(tree.root)) {
    parentOf.set(tree.root, null);
    let frontier = [tree.root];
    while (frontier.length) {
      depth++;
      const next: string[] = [];
      for (const id of frontier) {
        for (const e of exits.get(id) ?? []) {
          if (!parentOf.has(e.to)) {
            parentOf.set(e.to, id);
            next.push(e.to);
          }
        }
      }
      frontier = next;
    }
  }
  return {
    byId,
    exits,
    entries,
    parentOf,
    unreachable: tree.nodes.filter((n) => !parentOf.has(n.id)),
    finals: tree.nodes.filter((n) => !(exits.get(n.id)?.length)).length,
    depth,
  };
}

export function DialogTreeView({ tree }: { tree: DialogTree }) {
  const index = useMemo(() => indexTree(tree), [tree]);
  const [mode, setMode] = useState<"navegar" | "mapa">("navegar");
  const [selected, setSelected] = useState<string | null>(tree.root);
  const [query, setQuery] = useState("");
  // Nós expandidos no índice. Começa com a raiz e o primeiro nível abertos.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(tree.root ? [tree.root] : []));

  const matches = useMemo(() => {
    const q = normalize(query.trim());
    if (q.length < 2) return [];
    // Também acha o nó pela opção que leva até ele ("Perdi o cartão" → nó de bloqueio).
    const haystack = (n: DialogNode) =>
      normalize(`${n.label} ${n.text ?? ""} ${(index.entries.get(n.id) ?? []).map((e) => e.label ?? "").join(" ")}`);
    return tree.nodes.filter((n) => haystack(n).includes(q)).slice(0, 30);
  }, [query, tree.nodes, index]);

  function select(id: string) {
    setSelected(id);
    // Abre o caminho da raiz até o nó, para ele aparecer no índice.
    setExpanded((prev) => {
      const next = new Set(prev);
      let cursor = index.parentOf.get(id);
      while (cursor) {
        next.add(cursor);
        cursor = index.parentOf.get(cursor) ?? null;
      }
      return next;
    });
    requestAnimationFrame(() => document.getElementById(`dt-${id}`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }));
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const selectedNode = selected ? index.byId.get(selected) : undefined;
  const mermaidCode = useMemo(() => (tree.nodes.length <= MAP_MAX_NODES ? dialogTreeToMermaid(tree) : null), [tree]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5 text-xs font-medium">
          {(["navegar", "mapa"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`px-3 py-1.5 rounded-md ${mode === m ? "bg-indigo-600 text-white" : "text-gray-600 hover:bg-gray-50"}`}
            >
              {m === "navegar" ? "Navegar" : "Mapa"}
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-500">
          {tree.nodes.length} nós · {tree.edges.length} ligações · {index.depth} níveis · {index.finals} finais
          {index.unreachable.length > 0 && <span className="text-amber-700"> · {index.unreachable.length} fora do fluxo</span>}
        </p>
      </div>

      {mode === "mapa" ? (
        mermaidCode ? (
          <MermaidDiagram code={mermaidCode} />
        ) : (
          <p className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3">
            Este fluxo tem {tree.nodes.length} nós — o mapa fica ilegível acima de {MAP_MAX_NODES}. Use o modo Navegar e a busca.
          </p>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="lg:col-span-3 space-y-2 min-w-0">
            <label className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 h-9 focus-within:ring-2 focus-within:ring-indigo-500">
              <IconSearch className="h-4 w-4 text-gray-400" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar nó pelo nome, pelo que o bot diz ou pela opção que leva até ele…"
                className="flex-1 text-sm focus:outline-none bg-transparent"
              />
            </label>
            {query.trim().length >= 2 && (
              <div className="rounded-lg border border-gray-200 bg-white divide-y divide-gray-100 max-h-48 overflow-y-auto">
                {matches.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Nenhum nó encontrado.</p>}
                {matches.map((n) => (
                  <button key={n.id} type="button" onClick={() => select(n.id)} className="w-full text-left px-3 py-2 hover:bg-indigo-50">
                    <p className="text-sm font-medium text-gray-800 truncate">{n.label}</p>
                    {n.text && <p className="text-xs text-gray-500 truncate">{n.text}</p>}
                  </button>
                ))}
              </div>
            )}

            <div className="rounded-xl border border-gray-200 bg-white p-2 max-h-[60vh] overflow-y-auto">
              {tree.root && index.byId.has(tree.root) ? (
                <OutlineNode
                  id={tree.root}
                  index={index}
                  expanded={expanded}
                  selected={selected}
                  onToggle={toggle}
                  onSelect={select}
                  ancestors={new Set()}
                  depth={0}
                />
              ) : (
                <p className="text-sm text-gray-400 p-2">Árvore sem nó inicial.</p>
              )}
              {index.unreachable.length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-amber-700">
                    Fora do fluxo principal (nenhum caminho do início chega aqui)
                  </p>
                  {index.unreachable.map((n) => (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => setSelected(n.id)}
                      className={`block w-full text-left px-2 py-1 rounded text-sm ${selected === n.id ? "bg-indigo-50 text-indigo-800" : "text-gray-700 hover:bg-gray-50"}`}
                    >
                      {n.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <aside className="lg:col-span-2 rounded-xl border border-gray-200 bg-white p-4 h-fit lg:sticky lg:top-20 space-y-3">
            {selectedNode ? (
              <>
                <div>
                  <p className="text-[11px] uppercase tracking-wide text-gray-400">
                    {selectedNode.id === tree.root ? "Nó inicial" : "Nó"}
                    {selectedNode.type ? ` · ${selectedNode.type}` : ""}
                  </p>
                  <h4 className="font-semibold text-gray-900">{selectedNode.label}</h4>
                </div>
                {selectedNode.text ? (
                  <p className="text-sm text-gray-700 whitespace-pre-wrap bg-indigo-50/60 border border-indigo-100 rounded-lg px-3 py-2">
                    {selectedNode.text}
                  </p>
                ) : (
                  <p className="text-xs text-gray-400">Sem texto cadastrado neste nó.</p>
                )}
                <EdgeList title="Leva a" edges={index.exits.get(selectedNode.id) ?? []} pick={(e) => e.to} index={index} onSelect={select} empty="Fim do fluxo — nenhuma saída." />
                <EdgeList title="Chega de" edges={index.entries.get(selectedNode.id) ?? []} pick={(e) => e.from} index={index} onSelect={select} empty="Ninguém aponta para este nó." />
              </>
            ) : (
              <p className="text-sm text-gray-400">Selecione um nó para ver os detalhes.</p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function EdgeList({
  title,
  edges,
  pick,
  index,
  onSelect,
  empty,
}: {
  title: string;
  edges: DialogEdge[];
  pick: (e: DialogEdge) => string;
  index: TreeIndex;
  onSelect: (id: string) => void;
  empty: string;
}) {
  return (
    <div>
      <p className="text-xs font-medium text-gray-500 mb-1">{title}</p>
      {edges.length === 0 ? (
        <p className="text-xs text-gray-400">{empty}</p>
      ) : (
        <ul className="space-y-1">
          {edges.map((e, i) => (
            <li key={`${e.from}-${e.to}-${i}`}>
              <button type="button" onClick={() => onSelect(pick(e))} className="text-left text-sm text-indigo-700 hover:underline">
                {e.label && <span className="text-[11px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5 mr-1.5">{e.label}</span>}
                {index.byId.get(pick(e))?.label ?? pick(e)}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function OutlineNode({
  id,
  index,
  expanded,
  selected,
  onToggle,
  onSelect,
  ancestors,
  depth,
  edgeLabel,
}: {
  id: string;
  index: TreeIndex;
  expanded: Set<string>;
  selected: string | null;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
  ancestors: Set<string>;
  depth: number;
  edgeLabel?: string;
}) {
  const node = index.byId.get(id);
  if (!node) return null;
  const exits = index.exits.get(id) ?? [];
  // Um nó só é desenhado por extenso no seu primeiro caminho a partir da raiz; nos outros
  // aparece como atalho. Isso evita repetir sub-árvores inteiras e laços infinitos.
  const isPrimary = index.parentOf.get(id) === (ancestors.size ? [...ancestors].at(-1) : null) || depth === 0;
  const isLoop = ancestors.has(id);
  const isOpen = expanded.has(id);

  const label = (
    <span className="min-w-0 flex items-baseline gap-1.5">
      {edgeLabel && <span className="shrink-0 text-[11px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{edgeLabel}</span>}
      <span className="truncate">{node.label}</span>
    </span>
  );

  if (isLoop || !isPrimary) {
    return (
      <button
        type="button"
        onClick={() => onSelect(id)}
        className="flex items-center gap-1.5 w-full text-left rounded px-2 py-1 text-sm text-gray-500 hover:bg-gray-50"
        style={{ paddingLeft: depth * 16 + 28 }}
      >
        <span className="shrink-0 text-gray-400">{isLoop ? "↺" : "↪"}</span>
        {label}
        <span className="shrink-0 text-[11px] text-gray-400">{isLoop ? "volta" : "vai para"}</span>
      </button>
    );
  }

  return (
    <div>
      <div
        id={`dt-${id}`}
        className={`flex items-center gap-1 rounded px-2 py-1 text-sm ${selected === id ? "bg-indigo-50 text-indigo-900" : "text-gray-800 hover:bg-gray-50"}`}
        style={{ paddingLeft: depth * 16 + 8 }}
      >
        {exits.length > 0 ? (
          <button type="button" onClick={() => onToggle(id)} aria-label={isOpen ? "Recolher" : "Expandir"} className="shrink-0 h-5 w-5 grid place-items-center rounded hover:bg-gray-200/60">
            <IconChevronDown className={`h-3.5 w-3.5 text-gray-400 transition-transform ${isOpen ? "" : "-rotate-90"}`} />
          </button>
        ) : (
          <span className="shrink-0 h-5 w-5 grid place-items-center">
            <span className="h-1.5 w-1.5 rounded-full bg-gray-300" />
          </span>
        )}
        <button type="button" onClick={() => onSelect(id)} className="min-w-0 flex-1 text-left flex items-center gap-2">
          {label}
          {exits.length > 0 && !isOpen && <span className="shrink-0 text-[11px] text-gray-400">{exits.length}</span>}
        </button>
      </div>
      {isOpen &&
        exits.map((e, i) => (
          <OutlineNode
            key={`${e.to}-${i}`}
            id={e.to}
            edgeLabel={e.label}
            index={index}
            expanded={expanded}
            selected={selected}
            onToggle={onToggle}
            onSelect={onSelect}
            ancestors={new Set([...ancestors, id])}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}
