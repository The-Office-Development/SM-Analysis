import { Link } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import {
  seriesByDay, followersByDay, sum, latest, stockDelta, momentum, engagementRate,
} from "../lib/api";
import { compact, full, pctPlain, ratioPct, shortDate } from "../lib/format";
import type { Platform } from "../lib/types";
import StatCard from "../components/StatCard";
import LineChart, { type Series } from "../components/charts/LineChart";
import BarList from "../components/BarList";
import EmptyState from "../components/EmptyState";
import { PlatformBadge } from "../components/PlatformTile";
import { DiscoveryPanel, ChurnPanel, FormatPanel, ReachDriversPanel } from "../components/SponsorPanels";
import { IcPlug, IcRefresh, IcSpark, IcClock, IcContent, IcAlert } from "../lib/icons";

export default function Overview() {
  const dash = useDash();
  if (dash.loading) return <Skeletons />;
  if (dash.connectedPlatforms.length === 0) return <ConnectPrompt />;
  if (!dash.hasData) return <NoData onSync={() => dash.sync()} syncing={dash.syncing} />;

  const { metrics, scope } = dash;
  const platforms: Platform[] = scope === "all" ? dash.connectedPlatforms : [scope];

  const follSeries = followersByDay(metrics, scope);
  const reachSeries = seriesByDay(metrics, scope, "reach");
  const viewSeries = seriesByDay(metrics, scope, "views");
  const engSeries = seriesByDay(metrics, scope, "engagements");

  const growth: Series[] = platforms.map((p) => ({
    key: p, label: PLATFORMS[p].name, color: PLATFORMS[p].color,
    points: followersByDay(metrics, p),
  }));

  // funnel from real rows
  const impressions = sum(seriesByDay(metrics, scope, "impressions"));
  const reachTotal = sum(reachSeries);
  const engTotal = sum(engSeries);
  const scopedContent = dash.content.filter((c) => scope === "all" ? platforms.includes(c.platform) : c.platform === scope);

  /*
   * Split the fetched window in half to compare like with like — the same
   * approach periodCompare() uses, and for the same reason: only one range of
   * data is fetched, so the "previous period" has to come out of it. Reach is
   * summed over each half and posts are bucketed by the midpoint date, so the
   * two halves are equal-length and directly comparable.
   */
  const midpoint = reachSeries.length >= 4 ? reachSeries[Math.floor(reachSeries.length / 2) - 1]?.date ?? null : null;
  const half = Math.floor(reachSeries.length / 2);
  const priorReach = midpoint ? reachSeries.slice(0, half).reduce((a, x) => a + x.value, 0) : null;
  const currentReach = midpoint ? reachSeries.slice(reachSeries.length - half).reduce((a, x) => a + x.value, 0) : null;
  const priorContent = midpoint ? scopedContent.filter((c) => c.published_at.slice(0, 10) <= midpoint) : [];
  const recentContent = midpoint ? scopedContent.filter((c) => c.published_at.slice(0, 10) > midpoint) : [];
  const deep = scopedContent.reduce((s, c) => s + c.shares + c.saves, 0);
  const funnel = [
    { k: "Impressions", v: impressions, c: "var(--fb)" },
    { k: "Accounts reached", v: reachTotal, c: "var(--text)" },
    { k: "Engagements", v: engTotal, c: "var(--ig)" },
    { k: "Shares & saves", v: deep, c: "var(--tt)" },
  ];
  const fMax = Math.max(...funnel.map((f) => f.v), 1);

  // share of reach
  const shareRows = dash.connectedPlatforms.map((p) => ({
    key: p, label: PLATFORMS[p].name, color: PLATFORMS[p].color,
    value: sum(seriesByDay(metrics, p, "reach")),
  }));
  const shareTotal = shareRows.reduce((s, r) => s + r.value, 0) || 1;

  return (
    <>
      <div className="kpis">
        <StatCard label="Followers" value={compact(latest(follSeries))} delta={stockDelta(follSeries)} spark={follSeries.map((d) => d.value)} color="var(--text-2)" />
        <StatCard label="Reach" value={compact(reachTotal)} delta={momentum(reachSeries)} spark={reachSeries.map((d) => d.value)} color="var(--fb)" />
        <StatCard label="Video views" value={compact(sum(viewSeries))} delta={momentum(viewSeries)} spark={viewSeries.map((d) => d.value)} color="var(--tt)" />
        <StatCard label="Engagement rate" value={pctPlain(engagementRate(metrics, scope))} delta={momentum(engSeries)} spark={engSeries.map((d) => d.value)} color="var(--ig)" />
      </div>

      <div className="dash">
        <section className="panel col-2">
          <div className="panel__head"><h3>Audience growth</h3><span className="sub">Followers · last {dash.range} days</span></div>
          <div className="panel__body"><LineChart series={growth} height={264} /></div>
        </section>

        <section className="panel">
          <div className="panel__head"><IcSpark style={{ width: 16, height: 16, color: "var(--text-2)" }} /><h3>Insights</h3></div>
          <div className="panel__body stack" style={{ gap: 12 }}>
            {buildInsights(dash).map((ins, i) => (
              <div key={i} className="banner" style={{ background: "var(--panel-sunk)" }}>
                <ins.Icon style={{ color: ins.color }} />
                <div className="bt"><b>{ins.title}</b><p>{ins.body}</p></div>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__head"><h3>Engagement funnel</h3><span className="sub">{dash.range}d</span></div>
          <div className="panel__body stack" style={{ gap: 12 }}>
            {funnel.map((f, i) => (
              <div key={f.k} className="stack" style={{ gap: 5 }}>
                <div className="row" style={{ justifyContent: "space-between", fontSize: 12.5, fontWeight: 550 }}>
                  <span className="text-2">{f.k}</span><span className="tnum">{full(f.v)}</span>
                </div>
                <div style={{ height: 22, borderRadius: 6, background: "var(--panel-sunk)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${ratioPct(f.v, fMax)}%`, background: f.c, borderRadius: 6, transition: "width .5s" }} />
                </div>
                <span className="muted" style={{ fontSize: 11 }}>{i ? `${ratioPct(f.v, funnel[i - 1].v).toFixed(1)}% of previous` : "top of funnel"}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel__head"><h3>Share of reach</h3><span className="sub">by platform</span></div>
          <div className="panel__body">
            <BarList keyWidth={92} rows={shareRows.map((r) => ({
              key: r.key, label: r.label, value: r.value, color: r.color,
              display: `${ratioPct(r.value, shareTotal).toFixed(0)}%`,
            }))} />
          </div>
        </section>

        {/*
          * The interpretation layer — the reason this costs 50 JD and not $20.
          * Everything above is a chart any tool draws; these four answer the
          * questions a client actually asks and a sponsor actually pays for.
          */}
        <DiscoveryPanel metrics={metrics} scope={scope} />
        <ChurnPanel metrics={metrics} scope={scope} />
        <FormatPanel content={scopedContent} />
        <ReachDriversPanel
          current={recentContent}
          previous={priorContent}
          currentReach={currentReach}
          previousReach={priorReach}
        />

        <section className="panel col-3">
          <div className="panel__head"><h3>Top performing content</h3><span className="spacer" /><Link className="btn btn--sm btn--ghost" to="/content">View all</Link></div>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Post</th><th>Platform</th><th className="num">Views</th><th className="num">Engagements</th><th className="num">Shares</th><th className="num">Saves</th></tr></thead>
              <tbody>
                {scopedContent.slice(0, 6).map((c) => (
                  <tr key={c.id}>
                    <td><div className="stack"><span style={{ fontWeight: 550 }}>{c.title}</span><span className="muted" style={{ fontSize: 11 }}>{c.media_type} · {shortDate(c.published_at)}</span></div></td>
                    <td><PlatformBadge platform={c.platform} /></td>
                    <td className="num tnum">{compact(c.views)}</td>
                    <td className="num tnum">{compact(c.likes + c.comments + c.shares + c.saves)}</td>
                    <td className="num tnum">{compact(c.shares)}</td>
                    <td className="num tnum">{compact(c.saves)}</td>
                  </tr>
                ))}
                {scopedContent.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>No posts synced for this scope yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}

/* ------------------------------- insights -------------------------------- */
function buildInsights(dash: ReturnType<typeof useDash>) {
  const out: { title: string; body: string; color: string; Icon: typeof IcSpark }[] = [];
  const platforms = dash.scope === "all" ? dash.connectedPlatforms : [dash.scope];

  const byEr = platforms
    .map((p) => ({ p, er: engagementRate(dash.metrics, p) }))
    .sort((a, b) => b.er - a.er);
  if (byEr[0]) {
    out.push({
      title: `${PLATFORMS[byEr[0].p].name} leads on engagement`,
      body: `Converting reach at ${byEr[0].er.toFixed(1)}%. Lean into the formats working there.`,
      color: PLATFORMS[byEr[0].p].color, Icon: IcSpark,
    });
  }
  // best time from audience
  const aud = dash.audience.find((a) => platforms.includes(a.platform));
  if (aud?.active_hours?.length) {
    let bd = 0, bh = 0, bv = -1;
    aud.active_hours.forEach((row, d) => row.forEach((v, h) => { if (v > bv) { bv = v; bd = d; bh = h; } }));
    const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][bd];
    out.push({ title: "Post around your peak window", body: `Your audience is most active ${dow} ${(bh % 12) || 12}${bh < 12 ? "am" : "pm"}.`, color: "var(--fb)", Icon: IcClock });
  }
  const reachMom = momentum(seriesByDay(dash.metrics, dash.scope, "reach"));
  if (reachMom < 0) {
    out.push({ title: "Reach cooled this period", body: `Down ${Math.abs(reachMom).toFixed(1)}% vs the prior window. Try more native video and reply early.`, color: "var(--warn)", Icon: IcAlert });
  } else {
    out.push({ title: "Momentum is building", body: `Reach is up ${reachMom.toFixed(1)}% period over period. Keep your cadence steady.`, color: "var(--pos)", Icon: IcSpark });
  }
  return out.slice(0, 3);
}

/* ------------------------------- states ---------------------------------- */
function ConnectPrompt() {
  return (
    <div className="panel"><EmptyState icon={<IcPlug />} title="Connect your first account"
      action={<Link className="btn btn--primary" to="/connections">Go to Connections</Link>}>
      PulseBoard shows real numbers only. Connect Facebook, Instagram or TikTok to start pulling your metrics.
    </EmptyState></div>
  );
}
function NoData({ onSync, syncing }: { onSync: () => void; syncing: boolean }) {
  return (
    <div className="panel"><EmptyState icon={<IcContent />} title="No metrics synced yet"
      action={<button className="btn btn--primary" onClick={onSync} disabled={syncing}><IcRefresh className={syncing ? "spin" : ""} /> {syncing ? "Syncing…" : "Run first sync"}</button>}>
      Your accounts are connected. Run a sync to pull the latest followers, reach and content from the platform APIs.
    </EmptyState></div>
  );
}
function Skeletons() {
  return (
    <>
      <div className="kpis">{[0, 1, 2, 3].map((i) => <div key={i} className="kpi"><div className="sk" style={{ height: 12, width: 70 }} /><div className="sk" style={{ height: 26, width: 100 }} /><div className="sk" style={{ height: 14, width: 50 }} /></div>)}</div>
      <div className="dash"><div className="panel col-2" style={{ height: 320 }}><div className="panel__body"><div className="sk" style={{ height: 260 }} /></div></div><div className="panel" style={{ height: 320 }}><div className="panel__body"><div className="sk" style={{ height: 260 }} /></div></div></div>
    </>
  );
}
