import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { api } from "../api";
import { useAuth } from "../AuthContext";
import { ROLE_LABELS } from "../types";
import { AssistantPanel } from "./AssistantPanel";
import { CommandPalette } from "./CommandPalette";
import { ErrorBoundary } from "./ErrorBoundary";
import { NotificationBell } from "./NotificationBell";

const NAV_ITEMS = [
  { to: "/", label: "Visão geral", icon: "🏠", end: true },
  { to: "/catalogo", label: "Catálogo de Conhecimento", icon: "📚" },
  { to: "/ativacao", label: "Ativação", icon: "🚀" },
  { to: "/clientes", label: "Clientes — Visão 360", icon: "🧭" },
  { to: "/forum", label: "Fórum", icon: "💬" },
];

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export function Layout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [integrations, setIntegrations] = useState<{ gitlab: boolean; clickup: boolean } | null>(null);

  useEffect(() => {
    api
      .getIntegrationStatus()
      .then((res) => setIntegrations({ gitlab: res.gitlab.configured, clickup: res.clickup.configured }))
      .catch(() => setIntegrations(null));
  }, []);

  // Ctrl+K / ⌘K abre a busca global de qualquer tela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const navItems = user?.role === "admin" ? [...NAV_ITEMS, { to: "/admin", label: "Administração", icon: "⚙️" }] : NAV_ITEMS;

  return (
    <div className="min-h-screen flex bg-[#f7f7fb] text-gray-900">
      <aside className="w-64 shrink-0 bg-white border-r border-gray-200 flex flex-col sticky top-0 h-screen">
        <div className="px-5 py-5 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-semibold text-sm">
              FX
            </div>
            <div>
              <p className="font-semibold text-sm leading-tight">FlexIA Hub</p>
              <p className="text-xs text-gray-400 leading-tight">Squad FlexIA</p>
            </div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={"end" in item ? item.end : false}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  isActive ? "bg-indigo-50 text-indigo-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                }`
              }
            >
              <span className="text-base leading-none">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {user && (
          <div className="px-4 py-3 border-t border-gray-100">
            <p className="text-sm font-medium truncate">{user.name}</p>
            <p className="text-xs text-gray-400">{ROLE_LABELS[user.role]}</p>
            <button onClick={logout} className="text-xs text-gray-400 hover:text-rose-600 mt-1">
              Sair
            </button>
          </div>
        )}

        {integrations && (
          <div className="px-4 py-4 border-t border-gray-100 text-xs text-gray-400 space-y-0.5">
            <p>Integrações</p>
            <IntegrationStatus name="ClickUp" configured={integrations.clickup} />
            <IntegrationStatus name="GitLab" configured={integrations.gitlab} />
          </div>
        )}
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="sticky top-0 z-30 bg-[#f7f7fb]/90 backdrop-blur border-b border-gray-200 px-8 py-3 flex items-center gap-3">
          <button
            onClick={() => setPaletteOpen(true)}
            className="flex-1 max-w-md flex items-center gap-2 px-3 h-9 rounded-lg border border-gray-200 bg-white text-sm text-gray-400 hover:border-gray-300"
          >
            <span aria-hidden="true">🔎</span>
            <span className="flex-1 text-left">Buscar no Hub…</span>
            <kbd className="text-[10px] border border-gray-200 rounded px-1.5 py-0.5">{isMac ? "⌘K" : "Ctrl K"}</kbd>
          </button>
          <div className="flex-1" />
          <NotificationBell />
          <button
            onClick={() => setAssistantOpen(true)}
            className="h-9 px-3.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 flex items-center gap-1.5"
          >
            <span aria-hidden="true">✨</span> Assistente de IA
          </button>
        </header>

        <main className="flex-1 min-w-0">
          {/* A chave por rota faz o limite de erro se recuperar ao navegar para outra tela. */}
          <ErrorBoundary key={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AssistantPanel open={assistantOpen} onClose={() => setAssistantOpen(false)} />
    </div>
  );
}

function IntegrationStatus({ name, configured }: { name: string; configured: boolean }) {
  return (
    <p className={`font-medium ${configured ? "text-emerald-700" : "text-amber-700"}`}>
      {configured ? "●" : "○"} {name} {configured ? "conectado" : "aguardando token"}
    </p>
  );
}
