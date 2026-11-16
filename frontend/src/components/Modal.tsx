import { useEffect, type ReactNode } from "react";

interface Props {
  title: string;
  onClose: () => void;
  children: ReactNode;
  width?: "md" | "lg" | "xl";
}

const WIDTHS = { md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-3xl" };

/** Janela modal: fecha com Esc ou clicando fora. */
export function Modal({ title, onClose, children, width = "md" }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start sm:items-center justify-center p-4 z-50 overflow-y-auto" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`bg-white rounded-xl border border-gray-200 w-full ${WIDTHS[width]} max-h-[90vh] overflow-y-auto shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} aria-label="Fechar" className="text-gray-400 hover:text-gray-700 text-xl leading-none px-1">
            ×
          </button>
        </div>
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}
