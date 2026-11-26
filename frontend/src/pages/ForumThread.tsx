import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import type { ForumReply, ForumThread } from "../types";
import { ROLE_LABELS } from "../types";
import { formatDateTime as formatDate } from "../lib/format";

export function ForumThreadPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [thread, setThread] = useState<ForumThread | null>(null);
  const [replies, setReplies] = useState<ForumReply[]>([]);
  const [loading, setLoading] = useState(true);
  const [replyBody, setReplyBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingThread, setEditingThread] = useState(false);
  const [threadDraft, setThreadDraft] = useState({ title: "", body: "" });
  const [editingReplyId, setEditingReplyId] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState("");

  function canModify(authorId: string) {
    return !!user && (user.id === authorId || user.role === "admin");
  }

  function load() {
    if (!id) return;
    setLoading(true);
    api.getForumThread(id)
      .then((data) => {
        setThread(data.thread);
        setReplies(data.replies);
      })
      .finally(() => setLoading(false));
  }

  useEffect(load, [id]);

  async function handleReply(e: FormEvent) {
    e.preventDefault();
    if (!id || !replyBody.trim()) return;
    setSending(true);
    setError(null);
    try {
      await api.replyForumThread(id, replyBody.trim());
      setReplyBody("");
      load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSending(false);
    }
  }

  // Só o autor do tópico (ou um admin) decide qual resposta resolveu a questão.
  async function toggleAccepted(replyId: string) {
    if (!id || !thread) return;
    try {
      await api.acceptForumReply(id, thread.accepted_reply_id === replyId ? null : replyId);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  function startEditThread() {
    if (!thread) return;
    setThreadDraft({ title: thread.title, body: thread.body });
    setEditingThread(true);
  }

  async function saveThreadEdit() {
    if (!id) return;
    try {
      await api.editForumThread(id, threadDraft);
      setEditingThread(false);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteThread() {
    if (!id) return;
    if (!window.confirm("Apagar este tópico e todas as respostas? Essa ação não pode ser desfeita.")) return;
    try {
      await api.deleteForumThread(id);
      navigate("/forum");
    } catch (err: any) {
      setError(err.message);
    }
  }

  function startEditReply(r: ForumReply) {
    setEditingReplyId(r.id);
    setReplyDraft(r.body);
  }

  async function saveReplyEdit(replyId: string) {
    if (!id) return;
    try {
      await api.editForumReply(id, replyId, replyDraft);
      setEditingReplyId(null);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function handleDeleteReply(replyId: string) {
    if (!id) return;
    if (!window.confirm("Apagar esta resposta?")) return;
    try {
      await api.deleteForumReply(id, replyId);
      load();
    } catch (err: any) {
      setError(err.message);
    }
  }

  if (loading) return <div className="p-8 text-gray-400">Carregando…</div>;
  if (!thread) return <div className="p-8 text-gray-400">Tópico não encontrado.</div>;

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <Link to="/forum" className="text-xs text-indigo-600 hover:underline">← Fórum</Link>

      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-[11px] text-gray-400 bg-gray-100 rounded-full px-2 py-0.5">{thread.category_name}</span>
            {thread.client_name && (
              <Link to={`/clientes/${thread.client_id}`} className="text-[11px] text-indigo-600 bg-indigo-50 rounded-full px-2 py-0.5 hover:underline">
                {thread.client_name}
              </Link>
            )}
            {thread.knowledge_item_name && (
              <Link to={`/catalogo/${thread.knowledge_item_id}`} className="text-[11px] text-violet-600 bg-violet-50 rounded-full px-2 py-0.5 hover:underline">
                {thread.knowledge_item_name}
              </Link>
            )}
          </div>
          {canModify(thread.author_id) && !editingThread && (
            <div className="flex items-center gap-3 shrink-0">
              <button onClick={startEditThread} className="text-xs text-gray-500 hover:text-indigo-600">Editar</button>
              <button onClick={handleDeleteThread} className="text-xs text-gray-500 hover:text-rose-600">Apagar</button>
            </div>
          )}
        </div>

        {editingThread ? (
          <div className="space-y-3 mt-2">
            <input
              value={threadDraft.title}
              onChange={(e) => setThreadDraft({ ...threadDraft, title: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <textarea
              rows={4}
              value={threadDraft.body}
              onChange={(e) => setThreadDraft({ ...threadDraft, body: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setEditingThread(false)} className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
              <button onClick={saveThreadEdit} className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">Salvar</button>
            </div>
          </div>
        ) : (
          <>
            <h1 className="text-xl font-semibold">{thread.title}</h1>
            <p className="text-xs text-gray-400 mt-1">
              {thread.author_name} · {ROLE_LABELS[thread.author_role]} · {formatDate(thread.created_at)}
              {thread.updated_at !== thread.created_at && " · editado"}
            </p>
            <p className="text-sm text-gray-700 mt-4 whitespace-pre-wrap">{thread.body}</p>
          </>
        )}
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-gray-600">
          {replies.length} resposta(s)
          {thread.accepted_reply_id && <span className="text-emerald-700 font-medium"> · ✓ resolvido</span>}
        </h2>
        {replies.map((r) => (
          <div
            key={r.id}
            className={`bg-white rounded-xl border p-5 ${
              thread.accepted_reply_id === r.id ? "border-emerald-300 ring-1 ring-emerald-100" : "border-gray-200"
            }`}
          >
            {thread.accepted_reply_id === r.id && (
              <p className="text-xs font-medium text-emerald-700 mb-2">✓ Resposta marcada como solução</p>
            )}
            <div className="flex items-start justify-between gap-3 mb-1.5">
              <p className="text-xs text-gray-400">
                <span className="font-medium text-gray-700">{r.author_name}</span> · {ROLE_LABELS[r.author_role]} · {formatDate(r.created_at)}
              </p>
              {editingReplyId !== r.id && (canModify(thread.author_id) || canModify(r.author_id)) && (
                <div className="flex items-center gap-3 shrink-0">
                  {canModify(thread.author_id) && (
                    <button onClick={() => toggleAccepted(r.id)} className="text-xs text-gray-500 hover:text-emerald-700">
                      {thread.accepted_reply_id === r.id ? "Desmarcar solução" : "✓ Marcar como solução"}
                    </button>
                  )}
                  {canModify(r.author_id) && (
                    <>
                      <button onClick={() => startEditReply(r)} className="text-xs text-gray-500 hover:text-indigo-600">Editar</button>
                      <button onClick={() => handleDeleteReply(r.id)} className="text-xs text-gray-500 hover:text-rose-600">Apagar</button>
                    </>
                  )}
                </div>
              )}
            </div>
            {editingReplyId === r.id ? (
              <div className="space-y-2">
                <textarea
                  rows={3}
                  value={replyDraft}
                  onChange={(e) => setReplyDraft(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <div className="flex justify-end gap-2">
                  <button onClick={() => setEditingReplyId(null)} className="px-3 py-1.5 text-sm rounded-lg text-gray-600 hover:bg-gray-50">Cancelar</button>
                  <button onClick={() => saveReplyEdit(r.id)} className="px-3 py-1.5 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700">Salvar</button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{r.body}</p>
            )}
          </div>
        ))}
      </div>

      {user ? (
        <form onSubmit={handleReply} className="bg-white rounded-xl border border-gray-200 p-5 space-y-3">
          <label className="text-xs font-medium text-gray-600">Responder</label>
          <textarea
            rows={3}
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="Escreva sua resposta…"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />
          {error && <p className="text-xs text-rose-600">{error}</p>}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={sending || !replyBody.trim()}
              className="px-4 py-2 text-sm rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
            >
              {sending ? "Enviando…" : "Responder"}
            </button>
          </div>
        </form>
      ) : (
        <p className="text-sm text-gray-500 text-center">
          <Link to="/login" className="text-indigo-600 hover:underline">Entre</Link> para responder este tópico.
        </p>
      )}
    </div>
  );
}
