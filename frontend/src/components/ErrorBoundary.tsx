import { Component, type ErrorInfo, type ReactNode } from "react";

interface State {
  error: Error | null;
}

/**
 * Sem isto, um erro de renderização em qualquer componente deixava a tela inteira em
 * branco. Com o limite de erro, só a área afetada mostra uma mensagem e o resto do app
 * (menu, navegação) continua funcionando.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Erro de renderização:", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-8 max-w-xl mx-auto">
        <div className="bg-white border border-rose-200 rounded-xl p-6">
          <h2 className="font-semibold text-rose-700">Algo deu errado nesta tela</h2>
          <p className="text-sm text-gray-600 mt-2">
            O restante do Hub continua funcionando. Tente de novo; se o erro persistir, avise o time com a mensagem abaixo.
          </p>
          <pre className="mt-3 text-xs text-gray-500 bg-gray-50 rounded-lg p-3 overflow-x-auto">{this.state.error.message}</pre>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-4 px-3.5 py-2 text-sm font-medium rounded-lg bg-indigo-600 text-white hover:bg-indigo-700"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    );
  }
}
