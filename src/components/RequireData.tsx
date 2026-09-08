import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import EmptyState from "./EmptyState";
import { IcPlug, IcContent, IcRefresh } from "../lib/icons";

/** Gates analytics pages behind connected accounts + synced data. */
export default function RequireData({ children }: { children: ReactNode }) {
  const dash = useDash();
  if (dash.loading) {
    return <div className="panel"><div className="panel__body"><div className="sk" style={{ height: 260 }} /></div></div>;
  }
  if (dash.error) {
    return <div className="panel"><EmptyState icon={<IcContent />} title="Couldn’t load data">{dash.error}</EmptyState></div>;
  }
  if (dash.connectedPlatforms.length === 0) {
    return (
      <div className="panel"><EmptyState icon={<IcPlug />} title="Connect an account first"
        action={<Link className="btn btn--primary" to="/connections">Go to Connections</Link>}>
        Connect Facebook, Instagram or TikTok to see real analytics here.
      </EmptyState></div>
    );
  }
  if (!dash.hasData) {
    return (
      <div className="panel"><EmptyState icon={<IcRefresh />} title="No data for this scope yet"
        action={<button className="btn btn--primary" onClick={() => dash.sync()} disabled={dash.syncing}><IcRefresh className={dash.syncing ? "spin" : ""} /> Run a sync</button>}>
        Your numbers appear here on their own, usually within fifteen minutes of connecting.
      </EmptyState></div>
    );
  }
  return <>{children}</>;
}
