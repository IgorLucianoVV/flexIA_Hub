import { pool } from "../db";
import { normalizeDialogTree } from "../modules/knowledge/dialogTree";

/**
 * Documentação de demonstração para alguns itens do catálogo, para a página do item e o
 * Assistente de IA terem o que mostrar numa base recém-criada. Como o resto do catálogo do
 * seed, o conteúdo é ilustrativo — a documentação real vem do time.
 */
type DemoAttachment = { kind: "documento" | "diagrama" | "arvore_dialogo" | "link"; title: string; content?: string; url?: string };

const LIBERCARD_DOC = `# Bot Libercard — Cadastro e Recarga

> Conteúdo de demonstração criado pelo seed.

Chatbot de autoatendimento no **WhatsApp** que cadastra o cartão Libercard do beneficiário e faz
recarga via **PIX**. Atende sozinho a maior parte das conversas e transfere para um atendente
humano quando o cliente pede ou quando a recarga falha duas vezes.

## Como funciona

1. A mensagem chega pelo **FlexUC** (núcleo de mensageria), que identifica o canal e o contato.
2. O bot reconhece a intenção (cadastro, recarga, saldo, atendente).
3. Para recarga, gera a cobrança PIX pela **Integração PIX Libercard** e espera a confirmação.
4. Confirmado o pagamento, envia o comprovante e encerra a conversa.

\`\`\`mermaid
sequenceDiagram
  actor Cliente
  participant FlexUC
  participant Bot
  participant PIX as Integração PIX
  Cliente->>FlexUC: "quero recarregar 50"
  FlexUC->>Bot: mensagem + contato
  Bot->>PIX: criar cobrança (R$ 50)
  PIX-->>Bot: QR Code / copia e cola
  Bot-->>Cliente: código PIX
  PIX-->>Bot: webhook: pagamento confirmado
  Bot-->>Cliente: comprovante da recarga
\`\`\`

## Configuração

| Variável | Para que serve |
|---|---|
| \`PIX_API_URL\` | Endereço da Integração PIX Libercard |
| \`PIX_WEBHOOK_SECRET\` | Valida o webhook de confirmação |
| \`RECARGA_VALOR_MAXIMO\` | Teto por recarga (padrão R$ 500) |

## Pontos de atenção

- [x] Idempotência no webhook: o mesmo pagamento confirmado duas vezes não credita duas vezes.
- [ ] Cobrança PIX expira em 30 minutos — o bot ainda não avisa o cliente antes de expirar.
- Se a integração PIX ficar fora do ar, o bot oferece transbordo em vez de tentar de novo em loop.
`;

const LIBERCARD_ARCHITECTURE = `flowchart LR
  subgraph Canais
    WA([WhatsApp])
    WEB([WebChat])
  end
  WA --> FUC[FlexUC - mensageria]
  WEB --> FUC
  FUC --> BOT[Bot Libercard]
  BOT --> NLU{{Agente de intenções}}
  BOT --> PIX[Integração PIX]
  PIX --> BANCO[(Backend Libercard)]
  PIX -. webhook .-> BOT
  BOT --> HUM[Fila de atendentes]`;

const LIBERCARD_TREE = {
  title: "Boas-vindas",
  text: "Olá! Sou o assistente Libercard. O que você quer fazer?",
  options: [
    {
      label: "Recarregar cartão",
      next: {
        title: "Valor da recarga",
        text: "Qual valor você quer recarregar? (de R$ 10 a R$ 500)",
        options: [
          {
            label: "Informou o valor",
            next: {
              title: "Cobrança PIX",
              text: "Aqui está o código PIX copia e cola. Assim que o pagamento cair, aviso por aqui.",
              options: [
                { label: "Pagamento confirmado", next: { title: "Comprovante", text: "Recarga feita! Seu novo saldo já está disponível." } },
                { label: "Expirou ou falhou", next: { title: "Falha na recarga", text: "Não recebi a confirmação. Quer tentar de novo ou falar com um atendente?" } },
              ],
            },
          },
          { label: "Valor fora do limite", next: { title: "Valor inválido", text: "O valor precisa estar entre R$ 10 e R$ 500." } },
        ],
      },
    },
    {
      label: "Cadastrar cartão",
      next: {
        title: "Cadastro",
        text: "Me informe o CPF do titular e os 4 últimos dígitos do cartão.",
        options: [{ label: "Dados conferem", next: { title: "Cartão cadastrado", text: "Pronto! Cartão cadastrado no seu número." } }],
      },
    },
    { label: "Consultar saldo", next: { title: "Saldo", text: "Seu saldo atual é exibido aqui, com as últimas 3 movimentações." } },
    { label: "Falar com atendente", next: { title: "Transbordo", text: "Vou te transferir para um atendente. Horário: seg a sex, 8h às 18h." } },
  ],
};

const UNIMED_MENU = [
  { id: "menu", title: "Menu CSC", text: "Bem-vindo ao CSC Unimed Sobral. Escolha a diretoria:", options: [
    { label: "1 - Diretoria Administrativa", to: "adm" },
    { label: "2 - Diretoria de Mercado", to: "mercado" },
    { label: "3 - Diretoria de Saúde", to: "saude" },
  ] },
  { id: "adm", title: "Diretoria Administrativa", text: "Escolha o setor:", options: [
    { label: "Financeiro", to: "financeiro" },
    { label: "RH", to: "rh" },
    { label: "Voltar", to: "menu" },
  ] },
  { id: "mercado", title: "Diretoria de Mercado", text: "Escolha o setor:", options: [
    { label: "Comercial", to: "comercial" },
    { label: "Relacionamento", to: "relacionamento" },
    { label: "Voltar", to: "menu" },
  ] },
  { id: "saude", title: "Diretoria de Saúde", text: "Escolha o setor:", options: [
    { label: "Auditoria médica", to: "auditoria" },
    { label: "Regulação", to: "regulacao" },
    { label: "Voltar", to: "menu" },
  ] },
  { id: "financeiro", title: "Financeiro", text: "Transferindo para o Financeiro (ramal 2101)." },
  { id: "rh", title: "RH", text: "Transferindo para o RH (ramal 2140)." },
  { id: "comercial", title: "Comercial", text: "Transferindo para o Comercial (ramal 2200)." },
  { id: "relacionamento", title: "Relacionamento", text: "Transferindo para o Relacionamento com o Cliente (ramal 2230)." },
  { id: "auditoria", title: "Auditoria médica", text: "Transferindo para a Auditoria Médica (ramal 2310)." },
  { id: "regulacao", title: "Regulação", text: "Transferindo para a Regulação (ramal 2320)." },
];

const FLEXUC_SEQUENCE = `sequenceDiagram
  participant Canal as WhatsApp / WebChat
  participant FUC as FlexUC
  participant Fila as Fila de mensagens
  participant Bot
  Canal->>FUC: mensagem recebida
  FUC->>FUC: identifica contato e sessão
  FUC->>Fila: publica evento
  Fila->>Bot: entrega para o bot do cliente
  Bot-->>FUC: resposta
  FUC-->>Canal: envia no canal de origem
  Note over FUC,Bot: sem resposta em 30s, a sessão vai para a fila humana`;

const FLEXUC_RUNBOOK = `# Runbook — FlexUC

> Conteúdo de demonstração criado pelo seed.

## Mensagens paradas na fila

1. Confira o painel da fila: mais de **500 mensagens pendentes** indica consumidor parado.
2. Reinicie o consumidor do bot afetado (não o FlexUC inteiro).
3. Se o webhook do WhatsApp estiver devolvendo erro, verifique se o token do canal expirou.

## Bot não responde em um canal só

- Compare a configuração de roteamento do canal com a de um canal que funciona.
- Sessões presas: encerre as sessões abertas há mais de 24h do contato afetado.
`;

const DEMO: Record<string, DemoAttachment[]> = {
  "Bot Libercard — Cadastro e Recarga": [
    { kind: "documento", title: "Como o bot funciona", content: LIBERCARD_DOC },
    { kind: "diagrama", title: "Arquitetura da solução", content: LIBERCARD_ARCHITECTURE },
    { kind: "arvore_dialogo", title: "Fluxo principal de atendimento", content: JSON.stringify(LIBERCARD_TREE) },
    {
      kind: "link",
      title: "Repositório no GitLab",
      url: "https://gitlab.com/flexia/bots/libercard-cadastro-recarga",
      content: "Código do fluxo, testes e pipeline de deploy.",
    },
  ],
  "Árvore de diálogo — Menu CSC Unimed Sobral": [
    { kind: "arvore_dialogo", title: "Menu de diretorias e setores", content: JSON.stringify(UNIMED_MENU) },
  ],
  "FlexUC — Núcleo de Mensageria": [
    { kind: "diagrama", title: "Ciclo de uma mensagem", content: FLEXUC_SEQUENCE },
    { kind: "documento", title: "Runbook de incidentes", content: FLEXUC_RUNBOOK },
  ],
};

export async function seedAttachments(knowledgeIds: Record<string, string>): Promise<number> {
  let count = 0;
  for (const [itemName, attachments] of Object.entries(DEMO)) {
    const itemId = knowledgeIds[itemName];
    if (!itemId) continue;
    for (const [position, a] of attachments.entries()) {
      const content = a.kind === "arvore_dialogo" && a.content ? JSON.stringify(normalizeDialogTree(a.content).tree) : (a.content ?? null);
      await pool.query(
        `INSERT INTO knowledge_attachments (item_id, kind, title, content, url, position) VALUES ($1,$2,$3,$4,$5,$6)`,
        [itemId, a.kind, a.title, content, a.url ?? null, position]
      );
      count++;
    }
  }
  return count;
}
