import { useEffect, useId, useRef, useState } from "react";

/**
 * Desenha um diagrama Mermaid (flowchart, sequência, estados, ER, C4…).
 *
 * A biblioteca é grande, então só é baixada quando o primeiro diagrama aparece na tela
 * (import dinâmico — o resto do Hub não paga por ela). `securityLevel: "strict"` faz o Mermaid
 * escapar o texto dos nós e desativar cliques/scripts: o código vem de usuários.
 */
type MermaidApi = typeof import("mermaid").default;
let mermaidPromise: Promise<MermaidApi> | null = null;

function loadMermaid(): Promise<MermaidApi> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        theme: "base",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        themeVariables: {
          primaryColor: "#eef2ff",
          primaryBorderColor: "#6366f1",
          primaryTextColor: "#1f2937",
          lineColor: "#94a3b8",
          secondaryColor: "#f8fafc",
          tertiaryColor: "#ffffff",
          fontSize: "14px",
        },
        flowchart: { curve: "basis", htmlLabels: false },
      });
      return mermaid;
    });
  }
  return mermaidPromise;
}

export function MermaidDiagram({ code, className = "" }: { code: string; className?: string }) {
  const reactId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rendering, setRendering] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setRendering(true);
    const timer = setTimeout(async () => {
      try {
        const mermaid = await loadMermaid();
        const id = `mmd-${reactId.replace(/[^a-zA-Z0-9]/g, "")}-${Date.now()}`;
        const { svg } = await mermaid.render(id, code.trim());
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        const el = containerRef.current.querySelector("svg");
        if (el) {
          el.style.maxWidth = "none";
          el.removeAttribute("height");
        }
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(String(err?.message ?? err).split("\n").slice(0, 4).join("\n"));
        // O Mermaid deixa um elemento de erro solto no <body> quando falha.
        document.querySelectorAll("body > [id^='dmmd-']").forEach((n) => n.remove());
      } finally {
        if (!cancelled) setRendering(false);
      }
    }, 250); // espera a digitação parar antes de redesenhar no editor
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [code, reactId]);

  return (
    <div className={`relative rounded-xl border border-gray-200 bg-white ${className}`}>
      {error && (
        <div className="p-4 space-y-2">
          <p className="text-sm font-medium text-rose-700">O diagrama tem um erro de sintaxe</p>
          <pre className="text-xs text-rose-700 bg-rose-50 rounded-lg p-3 whitespace-pre-wrap">{error}</pre>
          <p className="text-xs text-gray-500">
            Referência da sintaxe:{" "}
            <a className="text-indigo-600 hover:underline" href="https://mermaid.js.org/intro/" target="_blank" rel="noreferrer">
              mermaid.js.org
            </a>
          </p>
        </div>
      )}
      {/* O contêiner fica sempre montado (só escondido no erro) para o próximo desenho achar onde escrever. */}
      <div className={error ? "hidden" : ""}>
        <div className="absolute right-2 top-2 z-10 flex gap-1">
          {[
            { label: "−", title: "Diminuir", action: () => setZoom((z) => Math.max(0.3, z - 0.2)) },
            { label: "100%", title: "Tamanho original", action: () => setZoom(1) },
            { label: "+", title: "Aumentar", action: () => setZoom((z) => Math.min(3, z + 0.2)) },
          ].map((b) => (
            <button
              key={b.title}
              type="button"
              title={b.title}
              onClick={b.action}
              className="h-7 min-w-7 px-1.5 rounded-md border border-gray-200 bg-white/90 text-xs text-gray-600 hover:bg-gray-50"
            >
              {b.label}
            </button>
          ))}
        </div>
        {rendering && <p className="absolute left-4 top-3 text-xs text-gray-400">Desenhando…</p>}
        <div className="overflow-auto p-4 pt-10 max-h-[70vh]">
          <div ref={containerRef} style={{ transform: `scale(${zoom})`, transformOrigin: "top center" }} className="flex justify-center" />
        </div>
      </div>
    </div>
  );
}
