import axios from "axios";
import { config } from "../../config";

/**
 * Cliente HTTP do ai-service. Todas as chamadas levam o segredo compartilhado
 * `X-Service-Token`: o ai-service lê dados de cliente e não deve responder a quem não é o
 * backend. (O usuário final nunca fala direto com o ai-service — sempre passa pelo backend,
 * que é quem valida o login.)
 */
export const aiClient = axios.create({
  baseURL: config.aiServiceUrl,
  headers: config.aiServiceToken ? { "X-Service-Token": config.aiServiceToken } : {},
});

export function isAiServiceUnreachable(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  return code === "ECONNREFUSED" || code === "ENOTFOUND" || code === "ECONNRESET" || code === "EAI_AGAIN";
}
