import { Link } from "react-router-dom";
import { useMemo } from "react";
import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import ExportMenu from "../components/ExportMenu";
import { buildSnapshot } from "../lib/snapshot";
import EmptyState from "../components/EmptyState";
import ReportSheet from "../components/ReportSheet";
import ShareButton from "../components/ShareButton";
import { IcPlug } from "../lib/icons";
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
          <ExportMenu dash={dash} />
        </div>
      </div>

      <ReportSheet snap={snap} />
    </div>
  );
}
