// Harness-only post-processor.
//   1. adds ".js" to the relative import specifiers tsc preserves verbatim
//      (the app is bundled by Vite, so the source has no extensions),
//   2. replaces the ONE module that touches the network/env boundary
//      (lib/supabase.js -> import.meta.env + createClient) with a stub.
// No file under src/ is touched; only the emitted JS in verify/build-fe/.
import { readdirSync, statSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "build-fe");

function walk(dir) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) {
      const src = readFileSync(p, "utf8");
      const out = src.replace(
        /(from\s+["'])(\.\.?\/[^"']+?)(["'])/g,
        (m, a, spec, b) => (spec.endsWith(".js") ? m : `${a}${spec}.js${b}`),
      );
      if (out !== src) writeFileSync(p, out);
    }
  }
}
walk(ROOT);

writeFileSync(
  join(ROOT, "lib", "supabase.js"),
  `// harness stub — the real module reads import.meta.env (Vite-only) and opens
// a Supabase client. Nothing in this verification calls it: we exercise the
// pure aggregation/render code with rows supplied directly.
export const isConfigured = true;
const die = () => { throw new Error("supabase client used unexpectedly"); };
export const supabase = new Proxy({}, { get: die });
`,
);
console.log("fixup ok");
