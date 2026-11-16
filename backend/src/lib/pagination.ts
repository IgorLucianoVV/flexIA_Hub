export interface PaginationParams {
  limit: number;
  offset: number;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Lê `limit`/`offset` da query string com defaults e limites sãos. */
export function parsePagination(
  query: Record<string, string | undefined>,
  defaultLimit: number = DEFAULT_LIMIT
): PaginationParams {
  let limit = Number(query.limit);
  if (!Number.isFinite(limit) || limit <= 0) limit = defaultLimit;
  limit = Math.min(Math.floor(limit), MAX_LIMIT);

  let offset = Number(query.offset);
  if (!Number.isFinite(offset) || offset < 0) offset = 0;
  offset = Math.floor(offset);

  return { limit, offset };
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export function paginatedResponse<T>(items: T[], total: number, pagination: PaginationParams): Paginated<T> {
  return { items, total, limit: pagination.limit, offset: pagination.offset };
}
