import { useState } from "react";
import type { useDash } from "../context/DashboardContext";
import { exportCsv, exportXlsx } from "../lib/reports";
import { IcDownload, IcFile, IcChevron } from "../lib/icons";

/**
 * One control for the three ways this report leaves the product.
 *
 * They are not alternatives to pick between at random; they suit different
 * readers, and the labels say which is which rather than naming a file
 * extension at somebody who does not think in file extensions:
 *
 *  - PDF for a person. It is what gets attached to an email to a sponsor, and
 *    the only one that looks the same on every machine it lands on.
 *  - Excel for someone who will sort, filter or chart it. Five sheets, formatted.
 *  - CSV for a system. Plain text, no formatting, nothing to strip out.
 *
 * All three carry the same header, the same footer and the same figures, because
 * the reader who matters most sees whichever one the client happened to send.
 *
 * The PDF goes through the browser's own print dialogue rather than a rendering
 * library. It costs nothing, it prints exactly what is on the page, and the
 * client picks the paper size their sponsor expects. The print stylesheet forces
 * the light palette, since a client exporting in dark mode would otherwise send
 * a page of white text on white paper.
 */
export default function ExportMenu({ dash }: { dash: ReturnType<typeof useDash> }) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <span className="menu-anchor">
      <button className="btn btn--sm btn--primary" onClick={() => setOpen((v) => !v)}
              aria-haspopup="menu" aria-expanded={open} disabled={!dash.hasData}>
        <IcDownload style={{ width: 15, height: 15 }} /> Export
        <IcChevron style={{ width: 14, height: 14, opacity: 0.75 }} />
      </button>
      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={close} />
          <div className="pop" role="menu" style={{ top: 36, right: 0, minWidth: 268 }}>
            <button role="menuitem" onClick={() => { close(); window.print(); }}>
              <IcFile />
              <span style={{ textAlign: "left" }}>
                <b style={{ display: "block" }}>PDF</b>
                <span className="muted" style={{ fontSize: 11 }}>To send to a client or sponsor</span>
              </span>
            </button>
            <button role="menuitem" onClick={() => { close(); exportXlsx(dash); }}>
              <IcDownload />
              <span style={{ textAlign: "left" }}>
                <b style={{ display: "block" }}>Excel workbook</b>
                <span className="muted" style={{ fontSize: 11 }}>Five sheets, to sort and chart</span>
              </span>
            </button>
            <hr />
            <button role="menuitem" onClick={() => { close(); exportCsv(dash); }}>
              <IcDownload />
              <span style={{ textAlign: "left" }}>
                <b style={{ display: "block" }}>CSV</b>
                <span className="muted" style={{ fontSize: 11 }}>Plain text, for another system</span>
              </span>
            </button>
          </div>
        </>
      )}
    </span>
  );
}
