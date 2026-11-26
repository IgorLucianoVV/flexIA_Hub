import type { DialogTree } from "../../types";

/** Código Mermaid (flowchart) da árvore. Ids viram n0, n1… e os textos são escapados. */
export function dialogTreeToMermaid(tree: DialogTree): string {
  const alias = new Map(tree.nodes.map((n, i) => [n.id, `n${i}`]));
  const esc = (s: string, max = 42) => {
    const t = s.length > max ? `${s.slice(0, max - 1)}…` : s;
    return t.replace(/"/g, "#quot;").replace(/[\r\n]+/g, " ");
  };
  const lines = ["flowchart TD"];
  for (const n of tree.nodes) lines.push(`  ${alias.get(n.id)}["${esc(n.label)}"]`);
  for (const e of tree.edges) {
    const from = alias.get(e.from);
    const to = alias.get(e.to);
    if (!from || !to) continue;
    lines.push(e.label ? `  ${from} -->|"${esc(e.label, 30)}"| ${to}` : `  ${from} --> ${to}`);
  }
  if (tree.root && alias.has(tree.root)) {
    lines.push("  classDef raiz fill:#4f46e5,stroke:#4338ca,color:#ffffff");
    lines.push(`  class ${alias.get(tree.root)} raiz`);
  }
  return lines.join("\n");
}
