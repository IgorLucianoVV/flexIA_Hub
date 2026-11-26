import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api";
import type { AppNotification } from "../types";
import { timeAgo } from "../lib/format";
import { IconBell } from "./icons";

const POLL_INTERVAL_MS = 60_000;

/**
 * Sino de notificações. O contador é atualizado a cada minuto (e sempre que a aba volta a
 * ficar visível); a lista só é carregada quando o sino é aberto.
 */
export function NotificationBell() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const refreshCount = useCallback(() => {
    api
      .getUnreadCount()
      .then((res) => setUnread(res.unreadCount))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_INTERVAL_MS);
    const onVisible = () => document.visibilityState === "visible" && refreshCount();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshCount]);

  useEffect(() => {
    if (!open) return;
    api
      .getNotifications({ limit: 15 })
      .then((res) => {
        setItems(res.items);
        setUnread(res.unreadCount);
      })
      .catch(() => setItems([]));

    const onClick = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function openNotification(n: AppNotification) {
    if (!n.read_at) {
      api.markNotificationRead(n.id).catch(() => undefined);
      setUnread((count) => Math.max(0, count - 1));
      setItems((prev) => prev?.map((i) => (i.id === n.id ? { ...i, read_at: new Date().toISOString() } : i)) ?? prev);
    }
    setOpen(false);
    if (n.link) navigate(n.link);
  }

  async function markAllRead() {
    await api.markAllNotificationsRead().catch(() => undefined);
    setUnread(0);
    setItems((prev) => prev?.map((i) => ({ ...i, read_at: i.read_at ?? new Date().toISOString() })) ?? prev);
  }

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? `Notificações: ${unread} não lida(s)` : "Notificações"}
        aria-expanded={open}
        className="relative h-9 w-9 rounded-lg border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 flex items-center justify-center"
      >
        <IconBell className="h-[18px] w-[18px]" />
        {unread > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-semibold flex items-center justify-center">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-96 max-w-[calc(100vw-2rem)] bg-white border border-gray-200 rounded-xl shadow-xl z-40 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
            <h3 className="font-semibold text-sm">Notificações</h3>
            {unread > 0 && (
              <button onClick={markAllRead} className="text-xs text-indigo-600 hover:underline">
                Marcar todas como lidas
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {items === null ? (
              <p className="px-4 py-6 text-sm text-gray-400">Carregando…</p>
            ) : items.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-400">
                Nada por aqui ainda. Você será avisado de respostas no fórum, alertas de clientes e projetos concluídos.
              </p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      onClick={() => openNotification(n)}
                      className={`w-full text-left px-4 py-3 hover:bg-gray-50 flex gap-3 ${n.read_at ? "" : "bg-indigo-50/50"}`}
                    >
                      <span
                        className={`mt-1.5 h-2 w-2 rounded-full shrink-0 ${n.read_at ? "bg-transparent" : "bg-indigo-600"}`}
                        aria-hidden="true"
                      />
                      <span className="min-w-0">
                        <span className={`block text-sm ${n.read_at ? "text-gray-600" : "font-medium text-gray-900"}`}>
                          {n.title}
                        </span>
                        {n.body && <span className="block text-xs text-gray-500 mt-0.5 line-clamp-2">{n.body}</span>}
                        <span className="block text-[11px] text-gray-400 mt-1">
                          {timeAgo(n.created_at)}
                          {!n.read_at && " · não lida"}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
