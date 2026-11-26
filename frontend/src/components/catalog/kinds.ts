import type { AttachmentKind } from "../../types";
import { IconDiagram, IconDialogTree, IconDocument, IconLink, IconPaperclip, type IconProps } from "../icons";

/** Tipos de anexo do catálogo: rótulos, ícones e textos de ajuda, na ordem em que aparecem. */
export const ATTACHMENT_KINDS: {
  kind: AttachmentKind;
  label: string;
  plural: string;
  icon: (p: IconProps) => React.JSX.Element;
  hint: string;
}[] = [
  {
    kind: "documento",
    label: "Documentação",
    plural: "Documentação",
    icon: IconDocument,
    hint: "Texto em Markdown: como funciona, decisões, runbook, exemplos de código.",
  },
  {
    kind: "diagrama",
    label: "Diagrama",
    plural: "Diagramas",
    icon: IconDiagram,
    hint: "Arquitetura, fluxos e sequências escritos em Mermaid e desenhados na tela.",
  },
  {
    kind: "arvore_dialogo",
    label: "Árvore de diálogo",
    plural: "Árvores de diálogo",
    icon: IconDialogTree,
    hint: "Importe o JSON do fluxo do bot e navegue pelos nós e caminhos.",
  },
  {
    kind: "arquivo",
    label: "Arquivo",
    plural: "Arquivos",
    icon: IconPaperclip,
    hint: "PDF, imagens, prints, planilhas, exportações. O texto de PDFs vai para o Assistente.",
  },
  {
    kind: "link",
    label: "Link",
    plural: "Links",
    icon: IconLink,
    hint: "Figma, Drive, Confluence, painel de monitoramento.",
  },
];

export const KIND_BY_ID = Object.fromEntries(ATTACHMENT_KINDS.map((k) => [k.kind, k])) as Record<
  AttachmentKind,
  (typeof ATTACHMENT_KINDS)[number]
>;

export const ACCEPTED_FILES =
  ".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.txt,.md,.csv,.json,.yaml,.yml,.xml,.log,.sql,.py,.js,.ts,.drawio,.docx,.xlsx,.pptx,.zip";

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export const DOC_TEMPLATE = `# Visão geral

O que este item faz, para quem e em que canal.

## Como funciona

1. Entrada: …
2. Processamento: …
3. Saída: …

## Configuração

| Variável | Para que serve | Exemplo |
|---|---|---|
| \`API_URL\` | Endereço da API | \`https://…\` |

## Diagrama

\`\`\`mermaid
flowchart LR
  Usuario([Usuário]) --> Bot[Chatbot]
  Bot --> API[(API)]
\`\`\`

## Pontos de atenção

- [ ] Limites, dependências, riscos conhecidos
`;

export const DIAGRAM_TEMPLATES: { label: string; code: string }[] = [
  {
    label: "Arquitetura",
    code: `flowchart LR
  subgraph Canal
    WA([WhatsApp])
    Web([Site])
  end
  WA --> Bot[Chatbot]
  Web --> Bot
  Bot --> IA{{Agente de IA}}
  IA --> KB[(Base de conhecimento)]
  Bot --> CRM[(CRM do cliente)]`,
  },
  {
    label: "Sequência",
    code: `sequenceDiagram
  actor Cliente
  participant Bot
  participant API
  Cliente->>Bot: Quero a segunda via
  Bot->>API: GET /faturas?cpf=…
  API-->>Bot: fatura em aberto
  Bot-->>Cliente: Link da segunda via`,
  },
  {
    label: "Estados",
    code: `stateDiagram-v2
  [*] --> Aguardando
  Aguardando --> EmAtendimento: mensagem recebida
  EmAtendimento --> Transbordo: pediu atendente
  EmAtendimento --> Resolvido: dúvida respondida
  Transbordo --> Resolvido
  Resolvido --> [*]`,
  },
  {
    label: "Entidades",
    code: `erDiagram
  CLIENTE ||--o{ CONVERSA : abre
  CONVERSA ||--|{ MENSAGEM : contem
  CONVERSA }o--|| INTENCAO : classificada_como`,
  },
];

export const TREE_EXAMPLE = `{
  "title": "Boas-vindas",
  "text": "Olá! Sou o assistente virtual. Como posso ajudar?",
  "options": [
    {
      "label": "Segunda via",
      "next": { "title": "Segunda via", "text": "Informe seu CPF, por favor." }
    },
    {
      "label": "Falar com atendente",
      "next": { "title": "Transbordo", "text": "Vou te transferir para um atendente." }
    }
  ]
}`;
