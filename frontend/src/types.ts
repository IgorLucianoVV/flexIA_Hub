export interface Client {
  id: string;
  name: string;
  segment?: string | null;
  status: string;
  csm_owner?: string | null;
  health_score?: number | null;
  health_breakdown?: HealthBreakdown | null;
  open_alerts?: string | number;
  activation_projects_count?: string | number;
}

export interface HealthComponent {
  key: string;
  label: string;
  count: number;
  penalty: number;
  maxPenalty: number;
}

export interface HealthBreakdown {
  base: number;
  components: HealthComponent[];
  calculatedAt: string;
}

export interface HealthPoint {
  date: string;
  score: number;
}

export interface ScorecardCheck {
  key: string;
  label: string;
  passed: boolean;
  hint?: string;
}

export type ScorecardLevel = "ouro" | "prata" | "bronze" | "inicial";

export interface Scorecard {
  score: number;
  level: ScorecardLevel;
  passed: number;
  total: number;
  checks: ScorecardCheck[];
  daysSinceReview: number | null;
  stale: boolean;
}

export interface KnowledgeRelationItem {
  relation_id: string;
  id: string;
  name: string;
  type: string;
  status: string;
}

export interface KnowledgeDetail {
  item: KnowledgeItem & { replaced_by_name?: string | null };
  dependsOn: KnowledgeRelationItem[];
  dependents: KnowledgeRelationItem[];
  threads: { id: string; title: string; created_at: string; reply_count: number }[];
}

export interface KnowledgeItem {
  id: string;
  type: string;
  name: string;
  description?: string | null;
  owner_team?: string | null;
  tags: string[];
  status: string;
  gitlab_project_id?: string | null;
  gitlab_path?: string | null;
  gitlab_web_url?: string | null;
  gitlab_namespace?: string | null;
  last_synced_at?: string | null;
  last_reviewed_at?: string | null;
  deprecation_note?: string | null;
  replaced_by_id?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  depends_on_count?: number;
  dependents_count?: number;
  scorecard: Scorecard;
}

export interface ActivationArtifact {
  id: string;
  name: string;
  type?: string | null;
  status: string;
  responsible?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  is_overdue?: boolean;
}

export interface ActivationPhase {
  id: string;
  name: string;
  order: number;
  status: string;
  artifacts: ActivationArtifact[];
  progressPct: number;
}

export interface ActivationProject {
  id: string;
  name: string;
  status: string;
  owner_name?: string | null;
  start_date?: string | null;
  target_date?: string | null;
  is_overdue?: boolean;
  client_id: string;
  client_name: string;
  phases: ActivationPhase[];
  progressPct: number;
  totalArtifacts: number;
  doneArtifacts: number;
  overdueArtifacts?: number;
}

export interface ActivationTemplate {
  id: string;
  name: string;
  description?: string | null;
  phases: { name: string; artifacts: { name: string; type?: string; dueOffsetDays?: number }[] }[];
}

export interface ClickupTask {
  id: string;
  clickup_task_id: string;
  name: string;
  status: string;
  list_name?: string | null;
  assignee?: string | null;
  due_date?: string | null;
  url?: string | null;
  priority?: string | null;
}

export interface ClientDocument {
  id: string;
  title: string;
  source: string;
  url?: string | null;
  category?: string | null;
  updated_at: string;
}

export interface ClientAlert {
  id: string;
  severity: string;
  message: string;
  source?: string | null;
  resolved: boolean;
  created_at: string;
  resolved_at?: string | null;
}

export interface ClientMetric {
  id: string;
  metric_key: string;
  value: number;
  unit?: string | null;
  period: string;
}

export interface Client360 {
  client: Client;
  clickupTasks: ClickupTask[];
  clickupTasksTotal: number;
  documents: ClientDocument[];
  alerts: ClientAlert[];
  metrics: ClientMetric[];
  activationProjects: ActivationProject[];
  healthHistory: HealthPoint[];
}

// ---------------------------------------------------------------------------
// Paginação
// ---------------------------------------------------------------------------
export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------
export type UserRole = "dev" | "analista_suporte" | "analista_ativacao" | "admin";

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  created_at?: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  dev: "Desenvolvedor(a)",
  analista_suporte: "Analista de Suporte",
  analista_ativacao: "Analista de Ativação",
  admin: "Admin",
};

// ---------------------------------------------------------------------------
// Fórum
// ---------------------------------------------------------------------------
export interface ForumCategory {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  order: number;
  thread_count: string | number;
}

export interface ForumThread {
  id: string;
  title: string;
  body: string;
  category_id: string;
  category_slug: string;
  category_name: string;
  author_id: string;
  author_name: string;
  author_role: UserRole;
  client_id?: string | null;
  client_name?: string | null;
  knowledge_item_id?: string | null;
  knowledge_item_name?: string | null;
  pinned: boolean;
  accepted_reply_id?: string | null;
  created_at: string;
  updated_at: string;
  reply_count: string | number;
}

export interface ForumReply {
  id: string;
  body: string;
  thread_id: string;
  author_id: string;
  author_name: string;
  author_role: UserRole;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Assistente de IA
// ---------------------------------------------------------------------------
export interface AssistantCitation {
  type: "cliente" | "catalogo" | "ativacao" | "forum" | "documento" | "alerta" | "metrica" | "tarefa";
  id: string;
  label: string;
  path: string;
}

export interface AssistantResponse {
  answer: string;
  sources_used: string[];
  citations: AssistantCitation[];
  ai_configured: boolean;
  interactionId?: string;
}

export interface AssistantInteraction {
  id: string;
  question: string;
  answer: string;
  citations: AssistantCitation[];
  ai_configured: boolean;
  feedback: 1 | -1 | null;
  created_at: string;
}

// ---------------------------------------------------------------------------
// Notificações, busca global, painel
// ---------------------------------------------------------------------------
export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body?: string | null;
  link?: string | null;
  read_at?: string | null;
  created_at: string;
}

export interface SearchResult {
  type: "cliente" | "catalogo" | "ativacao" | "forum" | "documento" | "tarefa";
  id: string;
  title: string;
  subtitle: string | null;
  path: string;
}

export interface DashboardSummary {
  clients: {
    total: number;
    avgHealth: number;
    atRisk: number;
    atRiskThreshold: number;
    attention: { id: string; name: string; health_score: number | null; open_alerts: number; score_week_ago: number | null }[];
  };
  alerts: { open: number; high: number };
  activation: {
    total: number;
    inProgress: number;
    overdue: number;
    projects: {
      id: string;
      name: string;
      status: string;
      target_date: string | null;
      client_name: string;
      is_overdue: boolean;
      progressPct: number;
    }[];
    upcoming: { id: string; name: string; due_date: string; is_overdue: boolean; project_name: string; client_name: string }[];
  };
  knowledge: { total: number; averageScore: number; stale: number; gold: number };
  forum: { threads: number; unanswered: number };
}

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------
export interface AdminUser extends User {
  is_active: boolean;
  updated_at?: string;
  last_login_at?: string | null;
}

export interface AuditEntry {
  id: string;
  actor_id: string | null;
  actor_name: string;
  action: string;
  entity_type: string;
  entity_id: string | null;
  summary: string;
  created_at: string;
}

export interface AssistantInsights {
  totals: { questions: number; last_7_days: number; users: number; positive: number; negative: number; avg_duration_ms: number };
  recent: { id: string; question: string; feedback: 1 | -1 | null; ai_configured: boolean; created_at: string; user_name: string }[];
  negative: { id: string; question: string; answer: string; feedback_comment: string | null; created_at: string; user_name: string }[];
  perDay: { date: string; questions: number }[];
}
