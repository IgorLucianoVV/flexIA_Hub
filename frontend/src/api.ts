import type {
  ActivationProject,
  ActivationTemplate,
  AdminUser,
  AppNotification,
  AssistantInsights,
  AssistantInteraction,
  AssistantResponse,
  AuditEntry,
  Client,
  Client360,
  ClientAlert,
  ClientDocument,
  ClickupTask,
  DashboardSummary,
  ForumCategory,
  ForumReply,
  ForumThread,
  DialogTree,
  KnowledgeAttachment,
  KnowledgeAttachmentDetail,
  KnowledgeDetail,
  KnowledgeItem,
  Paginated,
  SearchResult,
  User,
  UserRole,
} from "./types";
import { session } from "./session";

const BASE = "/api";

export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

type Query = Record<string, string | number | boolean | undefined>;

function toQueryString(params?: Query): string {
  if (!params) return "";
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== "");
  if (entries.length === 0) return "";
  return `?${new URLSearchParams(entries.map(([k, v]) => [k, String(v)])).toString()}`;
}

interface SessionResponse {
  token: string;
  refreshToken: string;
  expiresIn: number;
  user: User;
}

// Uma única renovação por vez: se várias requisições recebem 401 juntas, todas esperam a
// mesma promise em vez de cada uma gastar (e invalidar) o refresh token da outra.
let refreshing: Promise<boolean> | null = null;

async function refreshSession(): Promise<boolean> {
  const refreshToken = session.getRefreshToken();
  if (!refreshToken) return false;
  if (!refreshing) {
    refreshing = fetch(`${BASE}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    })
      .then(async (res) => {
        if (!res.ok) return false;
        session.set((await res.json()) as SessionResponse);
        return true;
      })
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

async function send(path: string, options?: RequestInit): Promise<Response> {
  const token = session.getAccessToken();
  return fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
}

/** Faz a requisição autenticada (renovando a sessão se preciso) e devolve a Response crua. */
async function requestRaw(path: string, options?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await send(path, options);
    // Access token expirado: renova em silêncio e repete a requisição uma vez. As rotas de
    // /auth ficam de fora — nelas, 401 significa credencial errada, não sessão vencida.
    if (res.status === 401 && !path.startsWith("/auth/")) {
      if (await refreshSession()) {
        res = await send(path, options);
      } else {
        session.clear();
        session.notifyExpired();
      }
    }
  } catch {
    throw new ApiError(0, "Não foi possível falar com o servidor. Verifique sua conexão.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, body.error || `Erro ${res.status} ao chamar ${path}`);
  }
  return res;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await requestRaw(path, options);
  if (res.status === 204) return undefined as T;
  return res.json();
}

const put = <T>(path: string, body: unknown) => request<T>(path, { method: "PUT", body: JSON.stringify(body) });

const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const patch = <T>(path: string, body: unknown) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });
const del = <T = void>(path: string) => request<T>(path, { method: "DELETE" });

export const api = {
  // Autenticação
  register: (data: { name: string; email: string; password: string; role: string }) =>
    post<SessionResponse>("/auth/register", data),
  login: (data: { email: string; password: string }) => post<SessionResponse>("/auth/login", data),
  logout: (refreshToken: string) => post<void>("/auth/logout", { refreshToken }),
  me: () => request<User>("/auth/me"),
  forgotPassword: (email: string) =>
    post<{ message: string; devModeToken?: string; devModeNote?: string }>("/auth/forgot-password", { email }),
  resetPassword: (token: string, password: string) =>
    post<{ message: string }>("/auth/reset-password", { token, password }),

  // Visão geral, busca global e notificações
  getDashboard: () => request<DashboardSummary>("/dashboard/summary"),
  search: (q: string) => request<{ query: string; results: SearchResult[] }>(`/search${toQueryString({ q })}`),
  getNotifications: (params?: { unread?: boolean; limit?: number }) =>
    request<Paginated<AppNotification> & { unreadCount: number }>(`/notifications${toQueryString(params)}`),
  getUnreadCount: () => request<{ unreadCount: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) => post<{ id: string }>(`/notifications/${id}/read`),
  markAllNotificationsRead: () => post<{ updated: number }>("/notifications/read-all"),
  getIntegrationStatus: () =>
    request<{ gitlab: { configured: boolean }; clickup: { configured: boolean } }>("/integrations/status"),

  // Clientes
  getClients: (params?: { q?: string; sort?: "name" | "health"; limit?: number; offset?: number }) =>
    request<Paginated<Client>>(`/clients${toQueryString(params)}`),
  getClient360: (id: string) => request<Client360>(`/clients/${id}/360`),
  createClient: (data: { name: string; segment?: string; csmOwner?: string }) => post<Client>("/clients", data),
  getClientClickupTasks: (id: string, params?: { limit?: number; offset?: number }) =>
    request<Paginated<ClickupTask>>(`/clients/${id}/clickup-tasks${toQueryString(params)}`),
  createClientAlert: (id: string, data: { severity: string; message: string }) =>
    post<ClientAlert>(`/clients/${id}/alerts`, data),
  resolveClientAlert: (id: string, alertId: string) => post<ClientAlert>(`/clients/${id}/alerts/${alertId}/resolve`),
  createClientDocument: (id: string, data: { title: string; url?: string; category?: string }) =>
    post<ClientDocument>(`/clients/${id}/documents`, data),
  syncClickup: () => post<any>("/integrations/clickup/sync"),

  // Catálogo de Conhecimento
  getKnowledge: (params?: { type?: string; q?: string; tag?: string; status?: string; limit?: number; offset?: number }) =>
    request<Paginated<KnowledgeItem>>(`/knowledge${toQueryString(params)}`),
  getKnowledgeItem: (id: string) => request<KnowledgeDetail>(`/knowledge/${id}`),
  updateKnowledgeItem: (id: string, data: Record<string, unknown>) => patch<KnowledgeItem>(`/knowledge/${id}`, data),
  reviewKnowledgeItem: (id: string) => post<KnowledgeItem>(`/knowledge/${id}/review`),
  addKnowledgeRelation: (id: string, toId: string) => post<{ id: string }>(`/knowledge/${id}/relations`, { toId }),
  removeKnowledgeRelation: (id: string, relationId: string) => del(`/knowledge/${id}/relations/${relationId}`),
  syncGitlab: () => post<any>("/knowledge/sync/gitlab"),

  // Anexos do catálogo: documentação, diagramas, árvores de diálogo, arquivos e links
  getAttachments: (itemId: string) => request<KnowledgeAttachment[]>(`/knowledge/${itemId}/attachments`),
  getAttachment: (itemId: string, attachmentId: string) =>
    request<KnowledgeAttachmentDetail>(`/knowledge/${itemId}/attachments/${attachmentId}`),
  createAttachment: (itemId: string, data: { kind: string; title: string; content?: string; url?: string }) =>
    post<KnowledgeAttachment & { warnings: string[] }>(`/knowledge/${itemId}/attachments`, data),
  updateAttachment: (itemId: string, attachmentId: string, data: { title?: string; content?: string; url?: string }) =>
    patch<KnowledgeAttachment & { warnings: string[] }>(`/knowledge/${itemId}/attachments/${attachmentId}`, data),
  deleteAttachment: (itemId: string, attachmentId: string) => del(`/knowledge/${itemId}/attachments/${attachmentId}`),
  reorderAttachments: (itemId: string, ids: string[]) => put<void>(`/knowledge/${itemId}/attachments/order`, { ids }),
  uploadAttachment: (itemId: string, file: File, title?: string) =>
    request<KnowledgeAttachment>(`/knowledge/${itemId}/attachments/file`, {
      method: "POST",
      body: file,
      headers: {
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(file.name),
        ...(title ? { "X-Title": encodeURIComponent(title) } : {}),
      },
    }),
  /** Baixa o arquivo com o token da sessão (um <img src> ou link direto não levaria o token). */
  getAttachmentFile: async (itemId: string, attachmentId: string) =>
    (await requestRaw(`/knowledge/${itemId}/attachments/${attachmentId}/file`)).blob(),
  previewDialogTree: (content: string) =>
    post<{ tree: DialogTree; warnings: string[]; limits: { maxNodes: number } }>("/knowledge/dialog-tree/preview", { content }),

  // Ativação
  getActivationProjects: (params?: { clientId?: string; status?: string; q?: string; limit?: number; offset?: number }) =>
    request<Paginated<ActivationProject>>(`/activation/projects${toQueryString(params)}`),
  getActivationTemplates: () => request<ActivationTemplate[]>("/activation/templates"),
  createActivationProject: (data: {
    name: string;
    clientId: string;
    ownerName?: string;
    startDate?: string;
    targetDate?: string;
    templateId?: string;
  }) => post<ActivationProject>("/activation/projects", data),
  deleteActivationProject: (id: string) => del(`/activation/projects/${id}`),
  createPhase: (projectId: string, data: { name: string }) => post<any>(`/activation/projects/${projectId}/phases`, data),
  createArtifact: (phaseId: string, data: { name: string; dueDate?: string; responsible?: string }) =>
    post<any>(`/activation/phases/${phaseId}/artifacts`, data),
  updateArtifactStatus: (artifactId: string, status: string) =>
    patch<any>(`/activation/artifacts/${artifactId}`, { status }),

  // Fórum
  getForumCategories: () => request<ForumCategory[]>("/forum/categories"),
  createForumCategory: (data: { slug: string; name: string; description?: string; order?: number }) =>
    post<ForumCategory>("/forum/categories", data),
  updateForumCategory: (id: string, data: { name?: string; description?: string | null; order?: number }) =>
    patch<ForumCategory>(`/forum/categories/${id}`, data),
  getForumThreads: (params?: {
    category?: string;
    clientId?: string;
    knowledgeItemId?: string;
    q?: string;
    limit?: number;
    offset?: number;
  }) => request<Paginated<ForumThread>>(`/forum/threads${toQueryString(params)}`),
  getForumThread: (id: string) => request<{ thread: ForumThread; replies: ForumReply[] }>(`/forum/threads/${id}`),
  createForumThread: (data: { title: string; body: string; categoryId: string; clientId?: string; knowledgeItemId?: string }) =>
    post<ForumThread>("/forum/threads", data),
  replyForumThread: (threadId: string, body: string) => post<ForumReply>(`/forum/threads/${threadId}/replies`, { body }),
  editForumThread: (id: string, data: { title?: string; body?: string }) => patch<ForumThread>(`/forum/threads/${id}`, data),
  deleteForumThread: (id: string) => del(`/forum/threads/${id}`),
  acceptForumReply: (threadId: string, replyId: string | null) =>
    post<ForumThread>(`/forum/threads/${threadId}/accept`, { replyId }),
  editForumReply: (threadId: string, replyId: string, body: string) =>
    patch<ForumReply>(`/forum/threads/${threadId}/replies/${replyId}`, { body }),
  deleteForumReply: (threadId: string, replyId: string) => del(`/forum/threads/${threadId}/replies/${replyId}`),

  // Assistente de IA
  askAssistant: (question: string) => post<AssistantResponse>("/assistant/ask", { question }),
  getAssistantStatus: () => request<{ ok: boolean; configured: boolean }>("/assistant/status"),
  getAssistantHistory: () => request<AssistantInteraction[]>("/assistant/history"),
  clearAssistantHistory: () => del("/assistant/history"),
  sendAssistantFeedback: (interactionId: string, value: 1 | -1 | null) =>
    post<{ id: string; feedback: 1 | -1 | null }>(`/assistant/interactions/${interactionId}/feedback`, { value }),
  reindexAssistant: (full = false) =>
    post<{ chunks_indexed: number; mode: string; updated: number; removed: number }>(
      `/assistant/reindex${toQueryString({ full: full || undefined })}`
    ),

  // Administração (só admin)
  getAdminUsers: (params?: { q?: string }) => request<Paginated<AdminUser>>(`/admin/users${toQueryString(params)}`),
  updateAdminUser: (id: string, data: { role?: UserRole; isActive?: boolean; name?: string }) =>
    patch<AdminUser>(`/admin/users/${id}`, data),
  getAuditLog: (params?: { q?: string; action?: string; limit?: number; offset?: number }) =>
    request<Paginated<AuditEntry>>(`/admin/audit${toQueryString(params)}`),
  getAssistantInsights: () => request<AssistantInsights>("/admin/assistant/insights"),
};
