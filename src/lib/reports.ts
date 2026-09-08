import type { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "./platforms";
import { buildCsv } from "./csvReport";

type Dash = ReturnType<typeof useDash>;

export function download(name: string, content: string | Blob, type = "text/csv;charset=utf-8") {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = document.createElement("a");
  const href = URL.createObjectURL(blob);
  a.href = href;
  a.download = name;
  a.click();
  // Revoking synchronously can race the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(href), 30_000);
}



/**
 * Turn the dashboard into the CSV input and hand the browser a file.
 *
 * The decisions about what a sponsor reads all live in csvReport.ts, which is
 * pure and tested. This is the part that touches the DOM and knows the platform
 * display names, and it deliberately contains no judgement of its own.
 */
export function exportCsv(dash: Dash) {
  const csv = buildCsv({
    range: dash.range,
    scope: dash.scope,
    accounts: dash.accounts,
    metrics: dash.metrics,
    content: dash.content,
    platformName: (p) => PLATFORMS[p].name,
  });
  const scope = dash.scope === "all" ? "all" : dash.scope;
  const stamp = new Date().toISOString().slice(0, 10);
  download(`pulseboard-${scope}-${dash.range}d-${stamp}.csv`, csv);
}
