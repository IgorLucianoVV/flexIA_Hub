import type { ReactNode } from "react";

/** Converte `**negrito**` em <strong>, sem interpretar mais nada como marcação. */
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : part
  );
}

/**
 * Mostra a resposta do assistente com a formatação mínima que ele usa: negrito, listas
 * com "- " e parágrafos. O texto é montado como elementos React (nunca como HTML cru), então
 * conteúdo vindo da base — escrito por usuários — não tem como injetar marcação na página.
 */
export function AnswerText({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  let list: string[] = [];

  const flushList = () => {
    if (list.length === 0) return;
    blocks.push(
      <ul key={`ul-${blocks.length}`} className="list-disc pl-5 space-y-0.5">
        {list.map((item, i) => (
          <li key={i}>{inline(item)}</li>
        ))}
      </ul>
    );
    list = [];
  };

  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.startsWith("- ") || line.startsWith("• ")) {
      list.push(line.slice(2));
      continue;
    }
    flushList();
    if (line) blocks.push(<p key={`p-${blocks.length}`}>{inline(line)}</p>);
  }
  flushList();

  return <div className="space-y-2">{blocks}</div>;
}
