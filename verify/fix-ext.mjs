// Post-process ONLY our own build output: tsc emits extensionless relative
// imports which Node's ESM loader rejects. Purely mechanical; no semantics change.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
const dir = new URL("./build-ui/", import.meta.url);
for (const f of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
  const p = new URL(f, dir);
  const src = readFileSync(p, "utf8");
  const out = src.replace(/(from\s+")(\.\/[A-Za-z0-9_\-]+)(")/g, "$1$2.js$3");
  if (out !== src) writeFileSync(p, out);
}
console.log("ext fix done");
