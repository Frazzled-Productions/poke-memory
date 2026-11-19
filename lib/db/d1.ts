/**
 * The subset of Cloudflare's D1 API the app uses, as structural types (decision
 * 0018). The real binding (`D1Database` from @cloudflare/workers-types) is
 * assignable to these, which worker/d1-compat.ts checks against the Workers
 * types; lib/db/testing/sqliteD1.ts implements them over node:sqlite for tests.
 * Kept local so lib/ never pulls the Workers globals into the Next.js tsconfig.
 */

export type D1Value = string | number | boolean | null | ArrayBuffer;

export interface D1MetaLike {
  changes: number;
  last_row_id: number;
  duration: number;
  [key: string]: unknown;
}

export interface D1ResultLike<T = Record<string, unknown>> {
  results: T[];
  success: boolean;
  meta: D1MetaLike;
}

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(colName?: string): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  run<T = Record<string, unknown>>(): Promise<D1ResultLike<T>>;
  raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[]>;
}

export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  /** Runs every statement in one transaction: all succeed or none apply. */
  batch<T = Record<string, unknown>>(
    statements: D1PreparedStatementLike[],
  ): Promise<D1ResultLike<T>[]>;
  exec(query: string): Promise<{ count: number; duration: number }>;
}

/** The R2 calls the backup job needs (design D10). */
export interface R2BucketLike {
  put(key: string, value: string | ArrayBuffer | ReadableStream, options?: unknown): Promise<unknown>;
  get(key: string): Promise<{ text(): Promise<string> } | null>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: { prefix?: string; cursor?: string; limit?: number }): Promise<{
    objects: { key: string; uploaded: Date }[];
    truncated: boolean;
    cursor?: string;
  }>;
}
