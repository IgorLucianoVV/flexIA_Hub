/**
 * Normalização de árvores de diálogo.
 *
 * Cada ferramenta de chatbot exporta o fluxo de um jeito. Em vez de exigir um formato só, o Hub
 * aceita os formatos JSON mais comuns e converte tudo para um grafo simples, que é o que fica
 * guardado, é desenhado na tela e é indexado pelo Assistente:
 *
 *   { root, nodes: [{ id, label, text?, type? }], edges: [{ from, to, label? }] }
 *
 * Formatos aceitos na entrada:
 *
 *   1. O próprio formato acima (nodes + edges).
 *   2. Árvore aninhada: { title, text, options: [{ label, next: { ...outro nó } }] }, ou com os
 *      filhos direto em children/options/choices/buttons.
 *   3. Lista de nós com transições por id: [{ id, text, next: [{ label, to: "outro-id" }] }],
 *      também como objeto { nodes: { "id": {...} } } ou { nodes: [...] } sem edges.
 *
 * Nomes de campo reconhecidos (o primeiro que existir vale):
 *   título  → title, name, label, intent
 *   texto   → text, message, messages, content, prompt, say, response, responses
 *   saídas  → transitions, options, choices, buttons, next, children, routes, edges, paths
 *   destino → to, target, next, goto, node, child, destination
 *   rótulo  → label, title, text, option, condition, intent, value
 */

export interface DialogNode {
  id: string;
  label: string;
  text?: string;
  type?: string;
}
export interface DialogEdge {
  from: string;
  to: string;
  label?: string;
}
export interface DialogTree {
  root: string | null;
  nodes: DialogNode[];
  edges: DialogEdge[];
}
export interface NormalizeResult {
  tree: DialogTree;
  warnings: string[];
}

export const DIALOG_TREE_MAX_NODES = 2000;
export const DIALOG_TREE_MAX_EDGES = 6000;

const TITLE_KEYS = ["title", "name", "label", "intent"];
const TEXT_KEYS = ["text", "message", "messages", "content", "prompt", "say", "response", "responses"];
const EXIT_KEYS = ["transitions", "options", "choices", "buttons", "next", "children", "routes", "edges", "paths"];
const TARGET_KEYS = ["to", "target", "next", "goto", "node", "child", "destination"];
const EDGE_LABEL_KEYS = ["label", "title", "text", "option", "condition", "intent", "value"];

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Obj = { [key: string]: Json };

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** Primeiro valor de texto (ou lista de textos) entre as chaves dadas. */
function pickText(obj: Obj, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
    if (Array.isArray(value)) {
      const parts = value
        .map((v) => (typeof v === "string" ? v : isObj(v) ? pickText(v, ["text", "message", "content", "value"]) : undefined))
        .filter((v): v is string => !!v && !!v.trim());
      if (parts.length) return parts.join("\n");
    }
    if (isObj(value)) {
      const inner = pickText(value, ["text", "message", "content", "value"]);
      if (inner) return inner;
    }
  }
  return undefined;
}

function pickExits(obj: Obj): Json[] | null {
  for (const key of EXIT_KEYS) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
    // "next": { ...nó } ou "next": "id" isolados também contam como uma saída.
    if (key === "next" && (isObj(value) || typeof value === "string")) return [value];
  }
  return null;
}

class Builder {
  nodes = new Map<string, DialogNode>();
  edges: DialogEdge[] = [];
  warnings: string[] = [];
  private seq = 0;
  private pendingRefs: { from: string; ref: string; label?: string }[] = [];

  newId(preferred?: string): string {
    let id = preferred?.trim() || `n${++this.seq}`;
    while (this.nodes.has(id)) id = `${preferred || "n"}-${++this.seq}`;
    return id;
  }

  addNode(node: DialogNode) {
    if (this.nodes.size >= DIALOG_TREE_MAX_NODES) throw new TreeTooLargeError();
    this.nodes.set(node.id, node);
  }

  addEdge(edge: DialogEdge) {
    if (this.edges.length >= DIALOG_TREE_MAX_EDGES) throw new TreeTooLargeError();
    this.edges.push(edge);
  }

  addRef(from: string, ref: string, label?: string) {
    this.pendingRefs.push({ from, ref, label });
  }

  /** Resolve as transições por id depois que todos os nós foram lidos. */
  resolveRefs() {
    for (const { from, ref, label } of this.pendingRefs) {
      if (this.nodes.has(ref)) this.addEdge({ from, to: ref, ...(label ? { label } : {}) });
      else this.warnings.push(`Transição de "${from}" aponta para "${ref}", que não existe — ignorada.`);
    }
    this.pendingRefs = [];
  }

  /** Lê um nó (e, recursivamente, os nós aninhados nas saídas dele). */
  readNode(obj: Obj, depth = 0): string {
    if (depth > 200) throw new InvalidTreeError("A árvore está aninhada demais (mais de 200 níveis).");
    const rawId = typeof obj.id === "string" || typeof obj.id === "number" ? String(obj.id) : undefined;
    const id = this.newId(rawId ?? (typeof obj.key === "string" ? obj.key : undefined));
    const label = pickText(obj, TITLE_KEYS) ?? pickText(obj, TEXT_KEYS)?.slice(0, 80) ?? id;
    const text = pickText(obj, TEXT_KEYS);
    const type = typeof obj.type === "string" ? obj.type : undefined;
    this.addNode({ id, label: label.slice(0, 200), ...(text && text !== label ? { text: text.slice(0, 4000) } : {}), ...(type ? { type } : {}) });

    for (const exit of pickExits(obj) ?? []) this.readExit(id, exit, depth);
    return id;
  }

  private readExit(from: string, exit: Json, depth: number) {
    if (typeof exit === "string" || typeof exit === "number") {
      this.addRef(from, String(exit));
      return;
    }
    if (!isObj(exit)) return;

    const edgeLabel = pickText(exit, EDGE_LABEL_KEYS);
    for (const key of TARGET_KEYS) {
      const target = exit[key];
      if (typeof target === "string" || typeof target === "number") {
        this.addRef(from, String(target), edgeLabel);
        return;
      }
      if (isObj(target)) {
        const child = this.readNode(target, depth + 1);
        this.addEdge({ from, to: child, ...(edgeLabel ? { label: edgeLabel } : {}) });
        return;
      }
    }
    // Sem destino explícito: a própria saída é o nó filho (formato aninhado com children).
    const child = this.readNode(exit, depth + 1);
    const optionLabel = typeof exit.option === "string" ? exit.option : undefined;
    this.addEdge({ from, to: child, ...(optionLabel ? { label: optionLabel } : {}) });
  }
}

export class InvalidTreeError extends Error {}
export class TreeTooLargeError extends InvalidTreeError {
  constructor() {
    super(`A árvore passa do limite de ${DIALOG_TREE_MAX_NODES} nós / ${DIALOG_TREE_MAX_EDGES} ligações.`);
  }
}

function fromNative(input: Obj, b: Builder): string | null {
  const nodes = input.nodes as Json[];
  for (const raw of nodes) {
    if (!isObj(raw)) continue;
    const rawId = raw.id;
    if (typeof rawId !== "string" && typeof rawId !== "number") {
      b.warnings.push("Um nó sem id foi ignorado.");
      continue;
    }
    const id = String(rawId);
    if (b.nodes.has(id)) {
      b.warnings.push(`Nó "${id}" repetido — mantida a primeira ocorrência.`);
      continue;
    }
    const label = pickText(raw, TITLE_KEYS) ?? pickText(raw, TEXT_KEYS)?.slice(0, 80) ?? id;
    const text = pickText(raw, TEXT_KEYS);
    b.addNode({
      id,
      label: label.slice(0, 200),
      ...(text && text !== label ? { text: text.slice(0, 4000) } : {}),
      ...(typeof raw.type === "string" ? { type: raw.type } : {}),
    });
  }
  for (const raw of input.edges as Json[]) {
    if (!isObj(raw)) continue;
    const from = raw.from ?? raw.source;
    const to = raw.to ?? raw.target;
    if ((typeof from !== "string" && typeof from !== "number") || (typeof to !== "string" && typeof to !== "number")) continue;
    const label = pickText(raw, ["label", "condition", "text"]);
    if (!b.nodes.has(String(from)) || !b.nodes.has(String(to))) {
      b.warnings.push(`Ligação "${from}" → "${to}" usa um nó que não existe — ignorada.`);
      continue;
    }
    b.addEdge({ from: String(from), to: String(to), ...(label ? { label } : {}) });
  }
  const root = input.root ?? input.start;
  return typeof root === "string" || typeof root === "number" ? String(root) : null;
}

function fromList(list: Json[], b: Builder) {
  for (const raw of list) {
    if (!isObj(raw)) continue;
    // Nós de uma lista plana: lê o nó, mas as saídas por id só são resolvidas no fim.
    b.readNode(raw);
  }
}

/** Converte um JSON de árvore de diálogo (texto) no formato normalizado do Hub. */
export function normalizeDialogTree(source: string): NormalizeResult {
  let input: Json;
  try {
    input = JSON.parse(source);
  } catch {
    throw new InvalidTreeError("O conteúdo não é um JSON válido.");
  }

  const b = new Builder();
  let root: string | null = null;

  if (isObj(input) && Array.isArray(input.nodes) && Array.isArray(input.edges)) {
    root = fromNative(input, b);
  } else if (Array.isArray(input)) {
    fromList(input, b);
  } else if (isObj(input) && Array.isArray(input.nodes)) {
    fromList(input.nodes, b);
  } else if (isObj(input) && isObj(input.nodes)) {
    fromList(
      Object.entries(input.nodes).map(([key, value]) => (isObj(value) ? { id: key, ...value } : value)),
      b
    );
  } else if (isObj(input)) {
    root = b.readNode(input);
  } else {
    throw new InvalidTreeError("Formato não reconhecido: esperado um objeto ou uma lista de nós.");
  }
  b.resolveRefs();

  const nodes = [...b.nodes.values()];
  if (nodes.length === 0) throw new InvalidTreeError("Nenhum nó encontrado no JSON.");

  if (!root || !b.nodes.has(root)) {
    // Raiz = primeiro nó sem ligações chegando (ou o primeiro nó, se o fluxo for um ciclo).
    const hasIncoming = new Set(b.edges.map((e) => e.to));
    root = nodes.find((n) => !hasIncoming.has(n.id))?.id ?? nodes[0].id;
  }

  return { tree: { root, nodes, edges: b.edges }, warnings: b.warnings.slice(0, 50) };
}

/**
 * Texto corrido da árvore, para busca e para o Assistente de IA: cada nó com o que o bot diz e
 * as opções que levam a outros nós.
 */
export function dialogTreeToText(tree: DialogTree): string {
  const byId = new Map(tree.nodes.map((n) => [n.id, n]));
  const exits = new Map<string, DialogEdge[]>();
  for (const e of tree.edges) exits.set(e.from, [...(exits.get(e.from) ?? []), e]);
  return tree.nodes
    .map((n) => {
      const lines = [`Nó "${n.label}"${n.text ? `: ${n.text}` : ""}`];
      for (const e of exits.get(n.id) ?? []) {
        lines.push(`  → ${e.label ? `"${e.label}" leva a ` : "segue para "}"${byId.get(e.to)?.label ?? e.to}"`);
      }
      return lines.join("\n");
    })
    .join("\n");
}
