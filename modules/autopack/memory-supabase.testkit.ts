/**
 * Tiny in-memory stand-in for the supabase-js query builder, enough for AutoPack tests.
 * Supports select / insert / update with eq, is, in, contains-free filters, order, limit,
 * single and maybeSingle. Not a general fake: unknown methods throw so tests fail loudly.
 */

type Row = Record<string, unknown>;
type Filter = (row: Row) => boolean;

let idCounter = 0;
export function testUuid() {
  idCounter += 1;
  return `00000000-0000-4000-8000-${String(idCounter).padStart(12, "0")}`;
}

export function memorySupabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [name, rows] of Object.entries(seed)) tables[name] = rows.map((row) => ({ ...row }));
  const calls: Array<{ table: string; op: string; payload?: unknown }> = [];

  function table(name: string) {
    tables[name] ??= [];
    return tables[name];
  }

  function builder(name: string) {
    let op: "select" | "insert" | "update" | "delete" = "select";
    let payload: Row | Row[] | null = null;
    let returning = false;
    const filters: Filter[] = [];
    let orderBy: { column: string; ascending: boolean } | null = null;
    let limitTo: number | null = null;
    let headCount = false;

    const run = (): { data: unknown; error: null; count?: number } => {
      const rows = table(name);
      if (op === "insert") {
        const list = (Array.isArray(payload) ? payload : [payload]) as Row[];
        const now = new Date().toISOString();
        const inserted = list.map((row) => ({ id: testUuid(), created_at: now, ...row }));
        rows.push(...inserted);
        calls.push({ table: name, op, payload });
        return { data: returning ? inserted : null, error: null };
      }
      let matched = rows.filter((row) => filters.every((filter) => filter(row)));
      if (op === "update") {
        for (const row of matched) Object.assign(row, payload);
        calls.push({ table: name, op, payload });
        return { data: returning ? matched.map((row) => ({ ...row })) : null, error: null };
      }
      if (op === "delete") {
        tables[name] = rows.filter((row) => !matched.includes(row));
        calls.push({ table: name, op });
        return { data: returning ? matched : null, error: null };
      }
      if (orderBy) {
        const { column, ascending } = orderBy;
        matched = [...matched].sort((left, right) =>
          String(left[column] ?? "").localeCompare(String(right[column] ?? "")) * (ascending ? 1 : -1)
        );
      }
      if (limitTo != null) matched = matched.slice(0, limitTo);
      if (headCount) return { data: null, error: null, count: matched.length };
      return { data: matched.map((row) => ({ ...row })), error: null };
    };

    const api = {
      select(_columns?: string, options?: { count?: string; head?: boolean }) {
        if (op === "select") headCount = Boolean(options?.head);
        else returning = true;
        return api;
      },
      insert(value: Row | Row[]) {
        op = "insert";
        payload = value;
        return api;
      },
      update(value: Row) {
        op = "update";
        payload = value;
        return api;
      },
      delete() {
        op = "delete";
        return api;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return api;
      },
      is(column: string, value: unknown) {
        filters.push((row) => (value === null ? row[column] == null : row[column] === value));
        return api;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return api;
      },
      order(column: string, options?: { ascending?: boolean }) {
        orderBy ??= { column, ascending: options?.ascending !== false };
        return api;
      },
      limit(count: number) {
        limitTo = count;
        return api;
      },
      async single() {
        const result = run();
        const list = (result.data as Row[] | null) ?? [];
        return list.length === 1
          ? { data: list[0], error: null }
          : { data: null, error: { message: `expected one row, got ${list.length}` } };
      },
      async maybeSingle() {
        const result = run();
        const list = (result.data as Row[] | null) ?? [];
        return { data: list[0] ?? null, error: null };
      },
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        try {
          return Promise.resolve(run()).then(resolve, reject);
        } catch (error) {
          return Promise.reject(error).then(resolve, reject);
        }
      },
    };
    return api;
  }

  return {
    client: { from: (name: string) => builder(name) } as never,
    tables,
    calls,
    rows: (name: string) => table(name),
  };
}
