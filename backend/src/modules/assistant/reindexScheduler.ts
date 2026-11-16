import { config } from "../../config";
import { DomainEvent, subscribe } from "../../lib/events";
import { logger } from "../../lib/logger";
import { aiClient, isAiServiceUnreachable } from "./aiClient";

/**
 * Mantém o índice de RAG em dia sozinho.
 *
 * Antes, o índice só era atualizado quando alguém clicava em "Atualizar índice". Agora
 * todo evento de domínio que muda conteúdo pesquisável agenda uma reindexação incremental
 * (o ai-service só reprocessa os chunks cujo conteúdo mudou). As chamadas são agrupadas
 * por debounce: dez alterações em sequência viram uma única reindexação, alguns segundos
 * depois da última.
 */
let timer: NodeJS.Timeout | null = null;
let running = false;
let pendingWhileRunning = false;

async function runReindex(): Promise<void> {
  if (running) {
    // Já existe uma reindexação em curso: garante mais uma rodada ao fim dela, para não
    // perder as alterações que chegaram no meio.
    pendingWhileRunning = true;
    return;
  }
  running = true;
  try {
    const { data } = await aiClient.post("/reindex", {}, { timeout: 120_000 });
    logger.debug({ result: data }, "Índice de RAG atualizado automaticamente");
  } catch (err) {
    if (isAiServiceUnreachable(err)) {
      logger.debug("ai-service fora do ar — reindexação automática ignorada (o índice se atualiza quando ele subir)");
    } else {
      logger.warn({ err }, "Falha na reindexação automática do RAG");
    }
  } finally {
    running = false;
    if (pendingWhileRunning) {
      pendingWhileRunning = false;
      scheduleReindex();
    }
  }
}

export function scheduleReindex(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    void runReindex();
  }, config.reindexDebounceMs);
  // Não segura o processo vivo só por causa deste timer (ex.: ao encerrar o servidor).
  timer.unref();
}

function handle(event: DomainEvent): void {
  if (event.contentChanged === false) return;
  scheduleReindex();
}

export function registerReindexSubscriber(): void {
  // Nos testes não existe ai-service: o agendador fica desligado.
  if (config.isTest) return;
  subscribe("rag-reindex", handle);
}
