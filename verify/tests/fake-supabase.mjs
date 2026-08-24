/**
 * An in-memory stand-in for the Supabase client that ACTUALLY APPLIES filters.
 *
 * The previous fake recorded .eq()/.limit()/onConflict and ignored them, which
 * meant a mutation writing rows under another tenant's account_id produced
 * identical output to correct code. Filters are applied here so tenant isolation
 * and merge behaviour are observable.
 */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

export function makeDb(seed = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, rows.map((r) => ({ ...r })));
  const rowsOf = (t) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t); };

  function query(table) {
    let rows = rowsOf(table).map((r) => ({ ...r }));
    const preds = [];
    const api = {
      select() { return api; },
      eq(c, v) { preds.push((r) => r[c] === v); return api; },
      neq(c, v) { preds.push((r) => r[c] !== v); return api; },
      gte(c, v) { preds.push((r) => r[c] >= v); return api; },
      lte(c, v) { preds.push((r) => r[c] <= v); return api; },
      order(c, o = {}) { api._order = { c, asc: o.ascending !== false }; return api; },
      /** Minimal PostgREST `or` support: "col.is.null,col.lt.value" (OR of terms). */
      or(expr) {
        const terms = String(expr).split(",").map((t) => {
          const [col, op, ...rest] = t.split(".");
          const val = rest.join(".");
          if (op === "is" && val === "null") return (r) => r[col] === null || r[col] === undefined;
          if (op === "lt") return (r) => r[col] != null && r[col] < val;
          if (op === "eq") return (r) => String(r[col]) === val;
          return () => false;
        });
        preds.push((r) => terms.some((t) => t(r)));
        return api;
      },
      not(col, op, val) {
        if (op === "is" && (val === null || val === "null")) preds.push((r) => r[col] !== null && r[col] !== undefined);
        else preds.push((r) => r[col] !== val);
        return api;
      },
      limit(n) { api._limit = n; return api; },
      _apply() {
        let out = rows.filter((r) => preds.every((p) => p(r)));
        if (api._order) out.sort((a, b) => (api._order.asc ? 1 : -1) * cmp(a[api._order.c], b[api._order.c]));
        if (api._limit != null) out = out.slice(0, api._limit);
        return out;
      },
      _run() {
        if (api._mutation?.type === "delete") {
          tables.set(table, rowsOf(table).filter((r) => !preds.every((p) => p(r))));
          return { data: null, error: null };
        }
        if (api._mutation?.type === "update") {
          // Return the rows actually changed, as PostgREST does with ?select= —
          // this is what makes a conditional update usable as a lock.
          const changed = [];
          for (const r of rowsOf(table)) {
            if (preds.every((p) => p(r))) { Object.assign(r, api._mutation.patch); changed.push({ ...r }); }
          }
          return { data: changed, error: null };
        }
        return { data: api._apply(), error: null };
      },
      then(res) { return Promise.resolve(api._run()).then(res); },
      maybeSingle() { const o = api._apply(); return Promise.resolve({ data: o[0] ?? null, error: null }); },
      single() {
        const o = api._apply();
        return Promise.resolve(o.length ? { data: o[0], error: null } : { data: null, error: { message: "no rows" } });
      },
      // update()/delete() stay chainable, as in the real client: the filters are
      // applied by the caller AFTER the verb (.update({...}).eq("id", x)).
      delete() { api._mutation = { type: "delete" }; return api; },
      update(patch) { api._mutation = { type: "update", patch }; return api; },
    };
    return api;
  }

  function upsert(table, payload, opts = {}) {
    const list = Array.isArray(payload) ? payload : [payload];
    const keys = (opts.onConflict ?? "").split(",").map((s) => s.trim()).filter(Boolean);
    const store = rowsOf(table);
    const written = [];
    for (const row of list) {
      const hit = keys.length ? store.find((r) => keys.every((k) => r[k] === row[k])) : undefined;
      if (hit) Object.assign(hit, row);
      else store.push({ id: row.id ?? `${table}-${store.length + 1}`, ...row });
      written.push(row);
    }
    const chain = {
      select() { return chain; },
      single() {
        const last = written[written.length - 1];
        const keys2 = keys.length ? keys : ["id"];
        const found = store.find((r) => keys2.every((k) => r[k] === last[k]));
        return Promise.resolve({ data: found ?? last, error: null });
      },
      then(res) { return Promise.resolve({ data: written, error: null }).then(res); },
    };
    return chain;
  }

  return {
    from(table) {
      const q = query(table);
      return Object.assign(q, {
        upsert: (payload, opts) => upsert(table, payload, opts),
        insert: (payload) => upsert(table, payload, {}),
      });
    },
    _rows: (t) => rowsOf(t).map((r) => ({ ...r })),
    _tables: tables,
  };
}
