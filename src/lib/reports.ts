import type { useDash } from "../context/DashboardContext";
import { seriesByDay, sum } from "./api";
import { PLATFORMS } from "./platforms";

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
 * Quote a CSV field AND neutralise spreadsheet formula injection.
 *
 * Quoting alone does not stop Excel or Google Sheets evaluating a field that
 * begins with = + - @ tab or CR. Post titles come from platform captions, and
 * these exports get emailed to sponsors, so the blast radius is the client's
 * commercial contacts rather than the client.
 */
const esc = (s: string) => {
  const v = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${v.replace(/"/g, '""')}"`;
};

/** Build a CSV of the current dashboard scope/window from real synced data. */
export function buildCsv(dash: Dash): string {
  const scopeLabel = dash.scope === "all" ? "All platforms" : PLATFORMS[dash.scope].name;
  const rows: string[] = [];
  rows.push("PulseBoard export");
  rows.push(`Generated,${new Date().toISOString()}`);
  rows.push(`Window,${dash.range} days`);
  rows.push(`Scope,${scopeLabel}`);
  rows.push("");
  rows.push("Platform,Followers,Reach,Views,Engagements");
  for (const p of dash.connectedPlatforms) {
    const foll = seriesByDay(dash.metrics, p, "followers");
    const reach = sum(seriesByDay(dash.metrics, p, "reach"));
    const views = sum(seriesByDay(dash.metrics, p, "views"));
    const eng = sum(seriesByDay(dash.metrics, p, "engagements"));
    rows.push(`${PLATFORMS[p].name},${foll[foll.length - 1]?.value ?? 0},${reach},${views},${eng}`);
  }
  rows.push("");
  rows.push("Content,Platform,Type,Published,Views,Likes,Comments,Shares,Saves");
  for (const c of dash.content.slice(0, 200)) {
    rows.push([
      esc(c.title), esc(PLATFORMS[c.platform].name), esc(c.media_type), c.published_at.slice(0, 10),
      c.views, c.likes, c.comments, c.shares, c.saves,
    ].join(","));
  }
  return rows.join("\n");
}

export function exportCsv(dash: Dash) {
  download(`pulseboard-${dash.range}d.csv`, buildCsv(dash));
}
