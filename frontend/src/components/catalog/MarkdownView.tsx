import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./MermaidDiagram";

/**
 * Documentação em Markdown (com tabelas, listas de tarefas e blocos de código do GFM).
 *
 * Um bloco ```mermaid vira diagrama desenhado. O react-markdown não renderiza HTML cru, então
 * o texto escrito por usuários não consegue injetar script na página.
 */
const components: Components = {
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  ),
  code: ({ className, children }) => {
    const language = /language-(\w+)/.exec(className ?? "")?.[1];
    const code = String(children ?? "").replace(/\n$/, "");
    if (language === "mermaid") return <MermaidDiagram code={code} className="my-2" />;
    return <code className={className}>{children}</code>;
  },
  // O <pre> de um bloco mermaid não deve ganhar a moldura de código.
  pre: ({ children, node }) => {
    const child = node?.children?.[0];
    const isMermaid =
      child && "properties" in child && Array.isArray(child.properties?.className) && child.properties.className.includes("language-mermaid");
    return isMermaid ? <>{children}</> : <pre>{children}</pre>;
  },
};

export function MarkdownView({ content }: { content: string }) {
  return (
    <div className="doc-prose">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
