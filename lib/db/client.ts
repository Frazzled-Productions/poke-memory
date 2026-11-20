/**
 * The browser's data client (design D5): the subset of the supabase-js query
 * builder the app uses, sent as JSON to POST /api/db (lib/db/gateway.ts has
 * the wire format), which runs it pinned to the session user.
 *
 *   const db = createDataClient();
 *   const { data, error } = await db
 *     .from("card_reviews")
 *     .select("card_type,subject_key")
 *     .eq("user_id", userId)
 *     .order("subject_key", { ascending: true })
 *     .range(0, 999);
 *
 * Like supabase-js, a query is a thenable builder that resolves to
 * { data, error, count } with error = { code, message, details, hint }, and it
 * never throws: a network failure or an unreadable response becomes an error
 * whose code (NETWORK_ERROR_CODE, or "HTTP_<status>") the sync layer treats as
 * transient (not 42xxx, not class 22 or 23). Requests go to the same origin
 * with the session cookie.
 */

/** The error code for a request that never got an answer. */
export const NETWORK_ERROR_CODE = "NETWORK_ERROR";

export interface DataClientError {
  code: string;
  message: string;
  details: string | null;
  hint: string | null;
}

/**
 * The resolved value of every query. `data` is untyped, as with an untyped
 * supabase-js client: call sites cast to their row shape.
 */
export interface DataResponse {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  error: DataClientError | null;
  count: number | null;
}

type FilterOp = "eq" | "neq" | "gt" | "gte" | "lt" | "lte" | "in" | "is" | "not-is";

interface WireFilter {
  column: string;
  op: FilterOp;
  value: unknown;
}

interface WireOrder {
  column: string;
  ascending?: boolean;
  nullsFirst?: boolean;
}

type Row = Record<string, unknown>;

type Transport = (body: Record<string, unknown>) => Promise<DataResponse>;

function columnList(columns: string): string[] | "*" {
  const list = columns
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c !== "");
  return list.length === 0 || (list.length === 1 && list[0] === "*") ? "*" : list;
}

/**
 * One query. Every filter and modifier returns the builder, and awaiting it
 * sends the request (once; awaiting again reuses the first result).
 */
export class DataQuery implements PromiseLike<DataResponse> {
  private kind: "select" | "upsert" | "insert" | "update" | "delete" | null = null;
  private columns: string[] | "*" | undefined;
  private filters: WireFilter[] = [];
  private orders: WireOrder[] = [];
  private rangeValue: [number, number] | undefined;
  private limitValue: number | undefined;
  private countValue: "exact" | undefined;
  private headValue = false;
  private singleValue: "maybe" | "one" | undefined;
  private rows: Row | Row[] | undefined;
  private values: Row | undefined;
  private onConflict: string | undefined;
  private ignoreDuplicates: boolean | undefined;
  private result: Promise<DataResponse> | null = null;

  constructor(
    private readonly table: string,
    private readonly transport: Transport,
  ) {}

  select(columns = "*", options: { count?: "exact"; head?: boolean } = {}): this {
    // After a write, supabase-js's .select() asks for the written rows back;
    // the app never does that, so only a plain read sets the kind.
    if (this.kind === null) this.kind = "select";
    this.columns = columnList(columns);
    if (options.count) this.countValue = options.count;
    if (options.head) this.headValue = true;
    return this;
  }

  upsert(rows: Row | Row[], options: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.kind = "upsert";
    this.rows = rows;
    this.onConflict = options.onConflict;
    this.ignoreDuplicates = options.ignoreDuplicates;
    return this;
  }

  insert(rows: Row | Row[]): this {
    this.kind = "insert";
    this.rows = rows;
    return this;
  }

  update(values: Row): this {
    this.kind = "update";
    this.values = values;
    return this;
  }

  delete(): this {
    this.kind = "delete";
    return this;
  }

  private filter(column: string, op: FilterOp, value: unknown): this {
    this.filters.push({ column, op, value });
    return this;
  }

  eq(column: string, value: unknown): this {
    return this.filter(column, "eq", value);
  }
  neq(column: string, value: unknown): this {
    return this.filter(column, "neq", value);
  }
  gt(column: string, value: unknown): this {
    return this.filter(column, "gt", value);
  }
  gte(column: string, value: unknown): this {
    return this.filter(column, "gte", value);
  }
  lt(column: string, value: unknown): this {
    return this.filter(column, "lt", value);
  }
  lte(column: string, value: unknown): this {
    return this.filter(column, "lte", value);
  }
  in(column: string, values: readonly unknown[]): this {
    return this.filter(column, "in", [...values]);
  }
  is(column: string, value: null | boolean): this {
    return this.filter(column, "is", value);
  }
  /**
   * Only the form the app uses, not(column, "is", null | boolean). Any other
   * operator is sent as is and the gateway refuses it (42883).
   */
  not(column: string, operator: "is", value: null | boolean): this {
    return this.filter(column, `not-${operator}` as FilterOp, value);
  }

  order(column: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}): this {
    this.orders.push({ column, ...options });
    return this;
  }

  range(from: number, to: number): this {
    this.rangeValue = [from, to];
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  maybeSingle(): this {
    this.singleValue = "maybe";
    return this;
  }

  single(): this {
    this.singleValue = "one";
    return this;
  }

  /** The JSON body this query sends (lib/db/gateway.ts). */
  toWire(): Record<string, unknown> {
    const filters = this.filters.length > 0 ? this.filters : undefined;
    switch (this.kind) {
      case null:
      case "select":
        return {
          kind: "select",
          table: this.table,
          columns: this.columns,
          filters,
          order: this.orders.length > 0 ? this.orders : undefined,
          range: this.rangeValue,
          limit: this.limitValue,
          count: this.countValue,
          head: this.headValue || undefined,
          single: this.singleValue,
        };
      case "upsert":
        return {
          kind: "upsert",
          table: this.table,
          rows: this.rows,
          onConflict: this.onConflict,
          ignoreDuplicates: this.ignoreDuplicates,
        };
      case "insert":
        return { kind: "insert", table: this.table, rows: this.rows };
      case "update":
        return { kind: "update", table: this.table, values: this.values, filters };
      case "delete":
        return { kind: "delete", table: this.table, filters };
    }
  }

  then<TResult1 = DataResponse, TResult2 = never>(
    onfulfilled?: ((value: DataResponse) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    this.result ??= this.transport(this.toWire());
    return this.result.then(onfulfilled, onrejected);
  }
}

export interface DataClient {
  from(table: string): DataQuery;
  rpc(name: string, args?: Record<string, unknown>): PromiseLike<DataResponse>;
}

export interface CreateDataClientOptions {
  /** Defaults to the global fetch, looked up on each request. */
  fetch?: typeof fetch;
  /** Prefix for /api/db; default "" (same origin). */
  baseUrl?: string;
}

function clientError(code: string, message: string): DataResponse {
  return { data: null, error: { code, message, details: null, hint: null }, count: null };
}

function isError(value: unknown): value is DataClientError {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DataClientError).code === "string" &&
    typeof (value as DataClientError).message === "string"
  );
}

export function createDataClient(options: CreateDataClientOptions = {}): DataClient {
  const url = `${options.baseUrl ?? ""}/api/db`;

  const transport: Transport = async (body) => {
    let response: Response;
    try {
      const doFetch = options.fetch ?? globalThis.fetch;
      response = await doFetch(url, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch (err) {
      return clientError(NETWORK_ERROR_CODE, err instanceof Error ? err.message : String(err));
    }
    let parsed: unknown;
    try {
      parsed = await response.json();
    } catch {
      return clientError(`HTTP_${response.status}`, `unreadable response (HTTP ${response.status})`);
    }
    const payload = (typeof parsed === "object" && parsed !== null ? parsed : {}) as Record<string, unknown>;
    const error = isError(payload.error)
      ? {
          code: payload.error.code,
          message: payload.error.message,
          details: payload.error.details ?? null,
          hint: payload.error.hint ?? null,
        }
      : null;
    if (!response.ok && error === null) {
      return clientError(`HTTP_${response.status}`, `request failed (HTTP ${response.status})`);
    }
    return {
      data: error === null ? (payload.data ?? null) : null,
      error,
      count: typeof payload.count === "number" ? payload.count : null,
    };
  };

  return {
    from: (table) => new DataQuery(table, transport),
    rpc: (name, args) => transport({ kind: "rpc", name, args: args ?? {} }),
  };
}
