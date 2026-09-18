/**
 * An in-memory stand-in for the Supabase client that ACTUALLY APPLIES filters.
 *
 * The previous fake recorded .eq()/.limit()/onConflict and ignored them, which
 * meant a mutation writing rows under another tenant's account_id produced
 * identical output to correct code. Filters are applied here so tenant isolation
 * and merge behaviour are observable.
 */
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * `makeDb(seed, { failWrites: { audience_snapshots: "..." } })` makes every
 * write to that table resolve as PostgREST does when it refuses one: no rows
 * stored, no exception, `{ data: null, error }`.
 *
 * That resolve-don't-throw shape is the whole reason unchecked writes are
 * invisible, so a fake that can only succeed cannot test for them. The message
 * defaults to the real 42703 an unapplied migration produces — 0015 adds
 * `dimensions` to audience_snapshots, and until it is applied this is verbatim
 * what Supabase answers.
 */
const UNAPPLIED_MIGRATION = { code: "42703", message: 'column "dimensions" of relation "audience_snapshots" does not exist' };

export function makeDb(seed = {}, opts = {}) {
  const tables = new Map();
  for (const [name, rows] of Object.entries(seed)) tables.set(name, rows.map((r) => ({ ...r })));
  const rowsOf = (t) => { if (!tables.has(t)) tables.set(t, []); return tables.get(t); };
  const failWrites = opts.failWrites ?? {};
  const writeError = (t) => {
    if (!(t in failWrites)) return null;
    const v = failWrites[t];
    return v === true ? UNAPPLIED_MIGRATION
      : typeof v === "string" ? { code: "42703", message: v }
      : v;
  };

  /*
   * Embedded selects, `select("...,social_accounts!inner(id,user_id)")`.
   *
   * PostgREST resolves the relation through a foreign key; a fake cannot, so
   * each supported embed names its key here, copied from the schema. Only
   * `!inner` is modelled: it drops a row whose relation does not match, which
   * is what makes `.eq("social_accounts.user_id", uid)` an ownership check.
   * Without this, refresh-post's tenant join could not be tested at all.
   */
  const EMBED_KEYS = {
    "content.social_accounts": "account_id",   // content.account_id -> social_accounts.id
  };

  function query(table) {
    let rows = rowsOf(table).map((r) => ({ ...r }));
    const preds = [];
    const embeds = [];
    const api = {
      select(cols) {
        for (const m of String(cols ?? "").matchAll(/(\w+)!inner\(/g)) {
          const fk = EMBED_KEYS[`${table}.${m[1]}`];
          if (!fk) throw new Error(`fake-supabase: no foreign key known for ${table}.${m[1]}; add it to EMBED_KEYS`);
          embeds.push({ rel: m[1], fk });
        }
        return api;
      },
      eq(c, v) {
        const dot = c.indexOf(".");
        if (dot > 0) { const rel = c.slice(0, dot), col = c.slice(dot + 1); preds.push((r) => r[rel]?.[col] === v); }
        else preds.push((r) => r[c] === v);
        return api;
      },
      neq(c, v) { preds.push((r) => r[c] !== v); return api; },
      gte(c, v) { preds.push((r) => r[c] >= v); return api; },
      lt(c, v) { preds.push((r) => r[c] != null && r[c] < v); return api; },
      lte(c, v) { preds.push((r) => r[c] <= v); return api; },
      in(c, vals) { const set = new Set(vals); preds.push((r) => set.has(r[c])); return api; },
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
        let base = rows;
        for (const { rel, fk } of embeds) {
          base = base
            .map((r) => ({ ...r, [rel]: rowsOf(rel).find((x) => x.id === r[fk]) ?? null }))
            .filter((r) => r[rel] !== null);   // !inner
        }
        let out = base.filter((r) => preds.every((p) => p(r)));
        if (api._order) out.sort((a, b) => (api._order.asc ? 1 : -1) * cmp(a[api._order.c], b[api._order.c]));
        if (api._limit != null) out = out.slice(0, api._limit);
        return out;
      },
      _run() {
        // A refused write changes nothing and throws nothing — the only trace is
        // the `error` a caller has to bother reading.
        if (api._mutation && writeError(table)) return { data: null, error: writeError(table) };
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
    const failed = writeError(table);
    if (failed) {
      const refused = {
        select() { return refused; },
        single() { return Promise.resolve({ data: null, error: failed }); },
        then(res) { return Promise.resolve({ data: null, error: failed }).then(res); },
      };
      return refused;
    }
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
    // Just enough auth for a handler: `users` maps an access token to a user id.
    auth: {
      getUser: async (token) => {
        const id = opts.users?.[token];
        return id ? { data: { user: { id } }, error: null } : { data: { user: null }, error: { message: "invalid token" } };
      },
      admin: { deleteUser: async () => ({ data: null, error: null }) },
    },
    _rows: (t) => rowsOf(t).map((r) => ({ ...r })),
    /*
     * Replace a table's contents. `_rows` deliberately hands out copies, so a
     * test that edits what it returns edits nothing and then asserts against
     * the unchanged original — a test that cannot fail. This is the supported
     * way to set up a variant.
     */
    _seed: (t, rows) => { tables.set(t, rows.map((r) => ({ ...r }))); },
    _tables: tables,
  };
}
