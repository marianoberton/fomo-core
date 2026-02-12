/**
 * Pagination utilities for API list endpoints.
 *
 * Provides a Zod schema for parsing `?limit=&offset=` query params
 * and a helper to slice arrays into paginated responses.
 */
import { z } from 'zod';

/** Zod schema for pagination query parameters. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Paginated response envelope for list endpoints. */
export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

/**
 * Slice an array into a paginated response.
 *
 * @param all - Full result set.
 * @param limit - Max items per page.
 * @param offset - Number of items to skip.
 * @returns Paginated response with items, total, limit, and offset.
 */
export function paginate<T>(all: T[], limit: number, offset: number): PaginatedResponse<T> {
  return {
    items: all.slice(offset, offset + limit),
    total: all.length,
    limit,
    offset,
  };
}
