import type { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "./platforms";
import type { Platform } from "./types";
import { buildCsv } from "./csvReport";
import { buildWorkbook } from "./xlsxReport";

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
function csvInput(dash: Dash) {
  return {
    range: dash.range,
    scope: dash.scope,
    accounts: dash.accounts,
    metrics: dash.metrics,
    content: dash.content,
    platformName: (p: Platform) => PLATFORMS[p].name,
  };
}

const fileStem = (dash: Dash) =>
  `pulseboard-${dash.scope === "all" ? "all" : dash.scope}-${dash.range}d-`
  + new Date().toISOString().slice(0, 10);

/**
 * The formatted workbook. This is the one to hand somebody.
 *
 * CSV cannot carry a heading, a column width, a thousands separator or a second
 * sheet, so it arrives looking like a database dump however carefully it was
 * built — in front of the sponsor the client is trying to persuade.
 */
export function exportXlsx(dash: Dash) {
  const bytes = buildWorkbook(csvInput(dash));
  download(
    `${fileStem(dash)}.xlsx`,
    // The cast is the narrowing TypeScript will not do on its own: a Uint8Array
    // is typed over ArrayBufferLike, which includes SharedArrayBuffer, and Blob
    // accepts only a plain ArrayBuffer. Ours is always plain — it is allocated
    // in buildXlsx.
    new Blob([bytes.buffer as ArrayBuffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
}

/** The same report as plain text, kept for anything that has to be machine-read. */
export function exportCsv(dash: Dash) {
  download(`${fileStem(dash)}.csv`, buildCsv(csvInput(dash)));
}
