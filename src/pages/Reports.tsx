import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import { exportCsv, exportXlsx } from "../lib/reports";
import { buildSnapshot } from "../lib/snapshot";
import EmptyState from "../components/EmptyState";
import ReportSheet from "../components/ReportSheet";
import ShareButton from "../components/ShareButton";
import { IcPlug, IcDownload, IcFile } from "../lib/icons";
import type { Platform } from "../lib/types";

export default function Reports() {
  const dash = useDash();
  const snap = useMemo(
    () => (dash.connectedPlatforms.length ? buildSnapshot(dash) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dash.metrics, dash.content, dash.audience, dash.range, dash.scope, dash.connectedPlatforms],
  );

  if (dash.loading) return <div className="panel" style={{ height: 240 }}><div className="panel__body"><div className="sk" style={{ height: 200 }} /></div></div>;
  if (!snap)
    return <div className="panel"><EmptyState icon={<IcPlug />} title="Connect an account first"
      action={<Link className="btn btn--primary" to="/connections">Go to Connections</Link>}>
      Reports are generated from your real synced data. Connect a platform to produce one.
    </EmptyState></div>;

  const scopeLabel = dash.scope === "all" ? "All platforms" : PLATFORMS[dash.scope as Platform].name;

  return (
    <div className="report">
      <div className="report__bar">
        <div>
          <h2 style={{ margin: 0, fontSize: 17 }}>Performance report</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>{scopeLabel} · last {dash.range} days</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <ShareButton snap={snap} />
          {/*
            * The workbook comes first and is the primary button. CSV stays for
            * anything that has to be machine-read, but it is not the file to
            * hand to a sponsor: it can carry no heading, no column width and no
            * second sheet, so it always arrives looking like a database dump.
            */}
          <button className="btn btn--sm btn--primary" onClick={() => exportXlsx(dash)}><IcDownload style={{ width: 15, height: 15 }} /> Excel report</button>
          <button className="btn btn--sm" onClick={() => exportCsv(dash)}><IcDownload style={{ width: 15, height: 15 }} /> CSV</button>
          <button className="btn btn--sm btn--primary" onClick={() => window.print()}><IcFile style={{ width: 15, height: 15 }} /> Print / Save PDF</button>
        </div>
      </div>

      <ReportSheet snap={snap} />
    </div>
  );
}
