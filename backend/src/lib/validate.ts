import { z } from "zod";

/**
 * Validação de entrada com zod. Uso nas rotas:
 *
 *   const body = parse(createClientSchema, req.body);
 *
 * Se os dados não baterem com o schema, o ZodError lançado é convertido em 400 pelo
 * tratamento central de erros (lib/errors.ts), com a lista de campos inválidos.
 */
export function parse<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  return schema.parse(data ?? {});
}

/** Texto obrigatório, sem espaços nas pontas, com tamanho máximo. */
export const text = (max: number, label = "campo") =>
  z
    .string({ error: `${label} é obrigatório` })
    .trim()
    .min(1, `${label} é obrigatório`)
    .max(max, `${label} aceita no máximo ${max} caracteres`);

/** Texto opcional: ausente, null e string vazia viram `undefined`. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `aceita no máximo ${max} caracteres`)
    .nullish()
    .transform((v) => (v ? v : undefined));

/** Data opcional em formato ISO (YYYY-MM-DD ou data-hora completa). */
export const optionalDate = z
  .string()
  .trim()
  .nullish()
  .transform((v) => (v ? v : undefined))
  .refine((v) => v === undefined || !Number.isNaN(Date.parse(v)), "data inválida");

export const id = z.string({ error: "id é obrigatório" }).trim().min(1, "id é obrigatório").max(100);
export const optionalId = z
  .string()
  .trim()
  .max(100)
  .nullish()
  .transform((v) => (v ? v : undefined));

/** Lê um parâmetro de rota como string (o Express 5 tipa `req.params.x` como string | string[]). */
export function param(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] : String(value ?? "");
}

/** Escapa `%`, `_` e `\` para usar texto do usuário dentro de um LIKE sem virar curinga. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
