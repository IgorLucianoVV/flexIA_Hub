import { pool } from "../../db";
import { DomainEvent, subscribe } from "../../lib/events";
import { notifyUsers, userIdsWithRoles } from "./service";

/**
 * Regras de "quem precisa saber disso". Cada regra reage a um tipo de evento de domínio.
 * Antes nada avisava ninguém: um alerta ou uma resposta no fórum só era visto por quem
 * abrisse a tela certa. Para acrescentar um canal (email, Slack), basta outro assinante
 * que reaja aos mesmos eventos — as rotas não mudam.
 *
 * Quem causou o evento nunca é notificado da própria ação.
 */
const without = (ids: string[], actorId?: string) => ids.filter((id) => id !== actorId);

const SEVERITY_LABEL: Record<string, string> = { baixa: "baixa", media: "média", alta: "alta", critica: "crítica" };

async function handle(event: DomainEvent): Promise<void> {
  const actorId = event.actor?.id;
  const meta = event.metadata ?? {};

  switch (event.type) {
    // Resposta nova num tópico -> avisa o autor do tópico e quem já participou da conversa.
    case "forum.reply.created": {
      const threadId = String(meta.threadId);
      const { rows } = await pool.query<{ id: string }>(
        `SELECT author_id AS id FROM forum_threads WHERE id = $1
         UNION
         SELECT author_id AS id FROM forum_replies WHERE thread_id = $1`,
        [threadId]
      );
      await notifyUsers(without(rows.map((r) => r.id), actorId), {
        type: event.type,
        title: `Nova resposta em "${meta.threadTitle}"`,
        body: `${event.actor?.name ?? "Alguém"} respondeu no fórum.`,
        link: `/forum/${threadId}`,
      });
      return;
    }

    case "forum.reply.accepted": {
      await notifyUsers(without([String(meta.replyAuthorId)], actorId), {
        type: event.type,
        title: "Sua resposta foi marcada como solução",
        body: `No tópico "${meta.threadTitle}".`,
        link: `/forum/${meta.threadId}`,
      });
      return;
    }

    // Alerta automático de severidade alta/crítica -> avisa quem cuida de clientes.
    case "client.alert.opened": {
      if (meta.severity !== "alta" && meta.severity !== "critica") return;
      const recipients = await userIdsWithRoles(["admin", "analista_ativacao", "analista_suporte"]);
      await notifyUsers(without(recipients, actorId), {
        type: event.type,
        title: `Alerta de severidade ${SEVERITY_LABEL[String(meta.severity)]} — ${meta.clientName}`,
        body: String(meta.message ?? ""),
        link: `/clientes/${event.entityId}`,
      });
      return;
    }

    case "activation.project.completed": {
      const recipients = await userIdsWithRoles(["admin", "analista_ativacao"]);
      await notifyUsers(without(recipients, actorId), {
        type: event.type,
        title: `Projeto de ativação concluído — ${meta.clientName}`,
        body: `"${meta.projectName}" teve todos os artefatos entregues.`,
        link: "/ativacao",
      });
      return;
    }

    case "user.role.changed": {
      await notifyUsers(without([String(event.entityId)], actorId), {
        type: event.type,
        title: "Seu papel no Hub foi alterado",
        body: `Novo papel: ${meta.roleLabel ?? meta.role}. Vale a partir do próximo login.`,
        link: "/",
      });
      return;
    }

    case "knowledge.item.deprecated": {
      // Quem tem itens que dependem do item descontinuado precisa saber: avisa admins e devs.
      if (!meta.dependentsCount) return;
      const recipients = await userIdsWithRoles(["admin", "dev"]);
      await notifyUsers(without(recipients, actorId), {
        type: event.type,
        title: `Item do catálogo descontinuado — ${meta.name}`,
        body: `${meta.dependentsCount} item(ns) do catálogo dependem dele.`,
        link: `/catalogo?item=${event.entityId}`,
      });
      return;
    }
  }
}

export function registerNotificationSubscriber(): void {
  subscribe("notifications", handle);
}
