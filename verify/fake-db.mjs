/**
 * Minimal fake of the supabase-js surface that netlify/functions/_sync.ts and
 * _lib.ts actually use. Records every write.
 *
 * Chains supported (exactly the ones the real code builds):
 *   db.from(t).select(cols).eq(c,v).single()
 *   db.from(t).select(cols).eq(c,v).order(c,{ascending}).limit(n).maybeSingle()
 *   db.from(t).upsert(rows, { onConflict })            (awaited directly)
 *   db.from(t).upsert(row,  { onConflict }).select(c).single()   (_lib.saveAccount)
 *   db.from(t).update(obj).eq(c,v)                     (awaited directly)
 */

export function makeFakeDb({ seed = {}, log = () => {} } = {}) {
  /** @type {Array<{table:string,op:string,opts:any,filters:any[],rows:any[]}>} */
  const writes = [];
  /** @type {Array<{table:string,op:string,cols:string,filters:any[],terminal:string,returned:any}>} */
  const reads = [];

  const settle = (value) => ({
    then: (res, rej) => Promise.resolve(value).then(res, rej),
    catch: (rej) => Promise.resolve(value).catch(rej),
    finally: (f) => Promise.resolve(value).finally(f),
  });

  function selectBuilder(table, cols) {
    const filters = [];
    const rowsFor = () => {
      const fn = seed[table];
      return typeof fn === "function" ? fn(filters) : (Array.isArray(fn) ? fn : []);
    };
    const record = (terminal, returned) => {
      reads.push({ table, op: "select", cols, filters: [...filters], terminal, returned });
      log(`  DB  READ  ${table}.select(${cols}) ${JSON.stringify(filters)} -> ${terminal} => ${JSON.stringify(returned)}`);
      return returned;
    };
    const b = {
      eq(c, v) { filters.push(["eq", c, v]); return b; },
      order(c, o) { filters.push(["order", c, o]); return b; },
      limit(n) { filters.push(["limit", n]); return b; },
      single() { const r = rowsFor(); return settle(record("single", { data: r[0] ?? null, error: r.length ? null : { message: "no rows" } })); },
      maybeSingle() { const r = rowsFor(); return settle(record("maybeSingle", { data: r[0] ?? null, error: null })); },
      then(res, rej) { const r = rowsFor(); return Promise.resolve(record("await", { data: r, error: null })).then(res, rej); },
    };
    return b;
  }

  return {
    _writes: writes,
    _reads: reads,
    from(table) {
      return {
        select: (cols) => selectBuilder(table, cols),
        upsert(rows, opts) {
          const arr = Array.isArray(rows) ? rows : [rows];
          const w = { table, op: "upsert", opts: opts ?? null, filters: [], rows: arr };
          writes.push(w);
          log(`  DB  WRITE ${table}.upsert  rows=${arr.length}  opts=${JSON.stringify(opts ?? null)}`);
          const res = { data: arr.map((r, i) => ({ id: `${table}-generated-${i}`, ...r })), error: null };
          const thenable = {
            ...settle(res),
            select: () => ({
              single: () => settle({ data: res.data[0] ?? null, error: null }),
              maybeSingle: () => settle({ data: res.data[0] ?? null, error: null }),
            }),
          };
          return thenable;
        },
        update(obj) {
          const filters = [];
          const w = { table, op: "update", opts: null, filters, rows: [obj] };
          const b = {
            eq(c, v) {
              filters.push(["eq", c, v]);
              writes.push(w);
              log(`  DB  WRITE ${table}.update ${JSON.stringify(obj)} where ${c}=${v}`);
              return settle({ data: [obj], error: null });
            },
            then(res, rej) { writes.push(w); return Promise.resolve({ data: [obj], error: null }).then(res, rej); },
          };
          return b;
        },
      };
    },
  };
}
