import { logger } from "./logger";

/**
 * Barramento de eventos de domínio (in-process).
 *
 * As rotas não sabem quem reage ao que elas fazem: publicam um evento ("uma resposta foi
 * criada no fórum") e seguem. Quem precisa reagir assina o barramento:
 *
 *   - auditoria      → grava uma linha em `audit_log` para todo evento;
 *   - notificações   → decide quem precisa ser avisado (autor do tópico, time de ativação…);
 *   - reindexação    → agenda a atualização do índice de RAG quando o conteúdo muda.
 *
 * Antes, cada efeito colateral teria que ser chamado à mão em cada rota. Com o barramento,
 * acrescentar um efeito novo (ex.: enviar email, webhook para o Slack) é escrever um
 * assinante — nenhuma rota muda.
 *
 * `publish` espera os assinantes terminarem, mas a falha de um assinante nunca derruba a
 * requisição que originou o evento: é registrada no log e os demais continuam.
 */
export interface EventActor {
  id: string;
  name: string;
  role: string;
}

export interface DomainEvent {
  /** Nome no formato `area.entidade.acao`, ex.: `forum.reply.created`. */
  type: string;
  /** Quem causou o evento. `null` = o próprio sistema (ex.: cálculo automático). */
  actor: EventActor | null;
  entityType: string;
  entityId?: string | null;
  /** Frase legível que descreve o que aconteceu — é o que aparece no log de auditoria. */
  summary: string;
  metadata?: Record<string, unknown>;
  /** O conteúdo pesquisável da plataforma mudou? (dispara reindexação do RAG). Padrão: true. */
  contentChanged?: boolean;
}

export type EventHandler = (event: DomainEvent) => Promise<void> | void;

const handlers: { name: string; handler: EventHandler }[] = [];

export function subscribe(name: string, handler: EventHandler): void {
  // Idempotente: registrar o mesmo assinante duas vezes (ex.: app importado por vários
  // arquivos de teste no mesmo processo) não duplica o efeito.
  if (handlers.some((h) => h.name === name)) return;
  handlers.push({ name, handler });
}

export async function publish(event: DomainEvent): Promise<void> {
  const results = await Promise.allSettled(handlers.map((h) => h.handler(event)));
  results.forEach((result, index) => {
    if (result.status === "rejected") {
      logger.error(
        { err: result.reason, subscriber: handlers[index].name, eventType: event.type },
        "Assinante de evento falhou"
      );
    }
  });
}

/** Só para testes: remove todos os assinantes. */
export function clearSubscribers(): void {
  handlers.length = 0;
}
