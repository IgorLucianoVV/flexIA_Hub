import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import { Dashboard } from "./pages/Dashboard";
import { Catalogo } from "./pages/Catalogo";
import { Ativacao } from "./pages/Ativacao";
import { Clientes } from "./pages/Clientes";
import { Cliente360Page } from "./pages/Cliente360";
import { ForumPage } from "./pages/Forum";
import { ForumThreadPage } from "./pages/ForumThread";
import { LoginPage } from "./pages/Login";
import { RegisterPage } from "./pages/Register";
import { ForgotPasswordPage } from "./pages/ForgotPassword";
import { ResetPasswordPage } from "./pages/ResetPassword";
import { AdminPage } from "./pages/Admin";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AuthProvider } from "./AuthContext";
import { RequireAuth } from "./RequireAuth";

// A página do item traz o leitor de Markdown e o editor de anexos: só é baixada quando aberta.
const CatalogoItemPage = lazy(() => import("./pages/CatalogoItem").then((m) => ({ default: m.CatalogoItemPage })));

function NotFound() {
  return (
    <div className="p-8 text-sm text-gray-500">
      Página não encontrada. Use o menu ao lado ou a busca (Ctrl+K) para chegar aonde queria.
    </div>
  );
}

function App() {
  return (
    <ErrorBoundary>
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="login" element={<LoginPage />} />
          <Route path="cadastro" element={<RegisterPage />} />
          <Route path="esqueci-senha" element={<ForgotPasswordPage />} />
          <Route path="redefinir-senha" element={<ResetPasswordPage />} />
          <Route
            element={
              <RequireAuth>
                <Layout />
              </RequireAuth>
            }
          >
            <Route index element={<Dashboard />} />
            <Route path="catalogo" element={<Catalogo />} />
            <Route
              path="catalogo/:id"
              element={
                <Suspense fallback={<p className="p-8 text-sm text-gray-400">Carregando…</p>}>
                  <CatalogoItemPage />
                </Suspense>
              }
            />
            <Route path="ativacao" element={<Ativacao />} />
            <Route path="clientes" element={<Clientes />} />
            <Route path="clientes/:id" element={<Cliente360Page />} />
            <Route path="forum" element={<ForumPage />} />
            <Route path="forum/:id" element={<ForumThreadPage />} />
            <Route path="admin" element={<AdminPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
    </ErrorBoundary>
  );
}

export default App;
