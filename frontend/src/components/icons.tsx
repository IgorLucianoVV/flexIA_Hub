/**
 * Ícones do FlexIA Hub, desenhados para o produto (sem biblioteca externa).
 *
 * Todos seguem a mesma gramática: grade 24×24, traço de 1,75 com pontas arredondadas e
 * um "nó" — o ponto cheio que representa a IA conectando as coisas. O traço usa a cor do
 * texto (currentColor); o nó usa a variável CSS --icon-accent (índigo por padrão, definida em
 * index.css), que pode ser trocada por contexto, ex.: `[--icon-accent:white]` num botão escuro.
 *
 * Por padrão os ícones são decorativos (aria-hidden). Passe `title` quando o ícone for o único
 * conteúdo de um elemento sem rótulo próprio.
 */
import type { ReactNode } from "react";

export interface IconProps {
  className?: string;
  title?: string;
}

function Svg({ className = "h-4 w-4", title, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {children}
    </svg>
  );
}

/** O nó de destaque, assinatura visual dos ícones. */
function Node({ cx, cy, r = 1.9 }: { cx: number; cy: number; r?: number }) {
  return <circle cx={cx} cy={cy} r={r} fill="var(--icon-accent, currentColor)" stroke="none" />;
}

/** Visão geral: painel com a linha de tendência terminando no nó. */
export function IconOverview(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="3" y="3" width="18" height="18" rx="4.5" />
      <path d="M7 16l3.2-3.6 2.8 2.1 3.2-4.3" />
      <Node cx={16.6} cy={9.9} />
    </Svg>
  );
}

/** Catálogo de Conhecimento: camadas de conhecimento empilhadas. */
export function IconCatalog(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M12 3.5l8.5 4.25L12 12 3.5 7.75z" />
      <path d="M3.5 12.25L12 16.5l8.5-4.25" />
      <path d="M3.5 16.5L12 20.75l8.5-4.25" />
      <Node cx={12} cy={7.75} r={1.6} />
    </Svg>
  );
}

/** Ativação: a jornada do cliente, do ponto de partida até o nó de chegada. */
export function IconActivation(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="4.75" cy="19" r="1.75" />
      <path d="M6.5 19c4.5 0 2.5-7 6-7s1.5-6.5 5-6.5" />
      <circle cx="12.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <Node cx={19} cy={5.5} r={2.1} />
    </Svg>
  );
}

/** Clientes — Visão 360: a pessoa dentro da órbita que dá a volta completa. */
export function IconClients(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="10.25" r="2.75" />
      <path d="M7.75 17.25a4.25 4.25 0 0 1 8.5 0" />
      <path d="M20.5 12A8.5 8.5 0 1 1 17.5 5.5" />
      <Node cx={17.5} cy={5.5} />
    </Svg>
  );
}

/** Fórum: duas conversas sobrepostas. */
export function IconForum(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 7V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M4 9a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2H9.5L6 19v-3a2 2 0 0 1-2-2z" />
      <circle cx="7.5" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="11.5" r="0.9" fill="currentColor" stroke="none" />
      <Node cx={12.5} cy={11.5} r={1.1} />
    </Svg>
  );
}

/** Administração: controles deslizantes; um deles é o nó. */
export function IconAdmin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 7h7M15 7h5M4 12h3M11 12h9M4 17h10M18 17h2" />
      <circle cx="13" cy="7" r="2" />
      <circle cx="9" cy="12" r="2" />
      <Node cx={16} cy={17} r={2.1} />
    </Svg>
  );
}

/** Busca. */
export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="10.5" cy="10.5" r="6.25" />
      <path d="M15.25 15.25L20 20" />
      <Node cx={10.5} cy={10.5} r={1.5} />
    </Svg>
  );
}

/** Assistente de IA: a faísca e o nó. */
export function IconSpark(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.5 3.5c.6 4.3 2.2 5.9 6.5 6.5-4.3.6-5.9 2.2-6.5 6.5-.6-4.3-2.2-5.9-6.5-6.5 4.3-.6 5.9-2.2 6.5-6.5z" />
      <Node cx={18} cy={18} r={1.9} />
    </Svg>
  );
}

/** Notificações: o sino com o nó de aviso. */
export function IconBell(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 16.5V11a6 6 0 0 1 9.5-4.9" />
      <path d="M18 11v5.5l1.5 2h-15L6 16.5" />
      <path d="M10 20a2 2 0 0 0 4 0" />
      <Node cx={18} cy={5.75} r={2.1} />
    </Svg>
  );
}

export function IconThumbUp(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M7.5 10.5V20" />
      <path d="M7.5 10.5l3.6-6.3a1.8 1.8 0 0 1 3.3 1.3L13.6 9H18a2 2 0 0 1 2 2.4l-1.3 6.4A2.7 2.7 0 0 1 16 20H4.5v-9.5z" />
    </Svg>
  );
}

export function IconThumbDown(p: IconProps) {
  return (
    <Svg {...p}>
      <g transform="matrix(1 0 0 -1 0 24)">
        <path d="M7.5 10.5V20" />
        <path d="M7.5 10.5l3.6-6.3a1.8 1.8 0 0 1 3.3 1.3L13.6 9H18a2 2 0 0 1 2 2.4l-1.3 6.4A2.7 2.7 0 0 1 16 20H4.5v-9.5z" />
      </g>
    </Svg>
  );
}

/** Tópico fixado. */
export function IconPin(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.5 3.5h5l-.8 5.2 3.3 3.3H7l3.3-3.3z" />
      <path d="M12 12v8.5" />
    </Svg>
  );
}

export function IconDocument(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6 4.5a1 1 0 0 1 1-1h7l4 4v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1z" />
      <path d="M14 3.5v4h4" />
      <path d="M9 12h6M9 15.5h4" />
    </Svg>
  );
}

export function IconTask(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <path d="M8.5 12.2l2.4 2.3 4.6-4.8" />
    </Svg>
  );
}

/** Sincronizar o índice do Assistente. */
export function IconSync(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4.5 12a7.5 7.5 0 0 1 13.1-5" />
      <path d="M19.5 12a7.5 7.5 0 0 1-13.1 5" />
      <path d="M17.9 3.4v3.9H14" />
      <path d="M6.1 20.6v-3.9H10" />
    </Svg>
  );
}

/** Alerta/risco. Sem nó de destaque: herda inteiro a cor do aviso. */
export function IconAlert(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M10.3 4.3a2 2 0 0 1 3.4 0l7.1 12.2a2 2 0 0 1-1.7 3H4.9a2 2 0 0 1-1.7-3z" />
      <path d="M12 9.5v3.8" />
      <circle cx="12" cy="16.3" r="1.05" fill="currentColor" stroke="none" />
    </Svg>
  );
}

export function IconArrowRight(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5 12h14M13.5 6.5L19 12l-5.5 5.5" />
    </Svg>
  );
}

export function IconChevronDown(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M6.5 9.5l5.5 5.5 5.5-5.5" />
    </Svg>
  );
}

/**
 * Marca do FlexIA Hub: um "F" de traço flexível — a haste que se curva no topo — e o nó de
 * IA na ponta da barra do meio. A mesma arte está em public/favicon.svg.
 */
export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} role="img" aria-label="FlexIA Hub">
      <rect width="32" height="32" rx="8" fill="#4f46e5" />
      <path d="M11 24V13.5A5.5 5.5 0 0 1 16.5 8H22" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <path d="M11 16.5h5.5" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
      <circle cx="21.25" cy="16.5" r="2.4" fill="#a5b4fc" />
    </svg>
  );
}
