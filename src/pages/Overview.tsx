import { Link } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import {
  seriesByDay, followersByDay, sum, latest, stockDelta, momentum, engagementRate,
} from "../lib/api";
import { compact, metric, sumKnown, full, pctPlain, ratioPct, shortDate } from "../lib/format";
import type { Platform } from "../lib/types";
import StatCard from "../components/StatCard";
import LineChart, { type Series } from "../components/charts/LineChart";
import FlowBars from "../components/charts/FlowBars";
import PostScatter from "../components/charts/PostScatter";
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

  /*
   * Rows for the three charts below, taken from the stored days directly rather
   * than through seriesByDay().
   *
   * seriesByDay drops any day the platform did not report, which is right for a
   * line but wrong here: these charts have to be able to draw a GAP. A day
   * Instagram never reported must not arrive looking like a day when nobody
   * joined, nobody left, or nobody new was reached.
   */
  const dayRows = [...metrics]
    .filter((m) => scope === "all" || m.platform === scope)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const byDate = new Map<string, { gained: number | null; lost: number | null; f: number | null; nf: number | null }>();
  for (const m of dayRows) {
    const prev = byDate.get(m.date);
    const add = (a: number | null | undefined, b: number | null | undefined) =>
      typeof a === "number" || typeof b === "number" ? (a ?? 0) + (b ?? 0) : null;
    byDate.set(m.date, {
      gained: add(prev?.gained, m.follows),
      lost: add(prev?.lost, m.unfollows),
      f: add(prev?.f, m.reach_followers),
      nf: add(prev?.nf, m.reach_non_followers),
    });
  }
  const flowDays = [...byDate.entries()].map(([date, v]) => ({ date, gained: v.gained, lost: v.lost }));
  const splitDays = [...byDate.entries()].map(([date, v]) => ({ date, followers: v.f, nonFollowers: v.nf }));

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
  const deep = scopedContent.reduce((s, c) => s + (sumKnown(c.shares, c.saves) ?? 0), 0);
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
          <div className="panel__body">
            {/* Followers: the movement is the subject, and a zero baseline hides
                it entirely — a real month-long decline drew as a flat line. */}
            <LineChart series={growth} height={264} baseline="auto" />
          </div>
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
                  {/*
                    * Clamp the GEOMETRY, never the number. Meta returns negative
                    * total_interactions when likes or comments are removed —
                    * 2026-09-03 came back as -1 on a live account — and a
                    * negative width is invalid CSS, so the bar silently vanishes
                    * and the row reads as missing rather than negative. The
                    * figure printed beside it stays exactly as reported.
                    */}
                  <div style={{ height: "100%", width: `${Math.min(100, Math.max(0, ratioPct(f.v, fMax)))}%`, background: f.c, borderRadius: 6, transition: "width .5s" }} />
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
          * Three pictures of things the native app never draws.
          *
          * They sit high on the page on purpose. This is the first screen a
          * client sees, and until now it opened with four numbers in boxes and a
          * follower line — which is what every tool shows. What follows is what
          * this product actually knows.
          */}
        {flowDays.some((d) => d.gained !== null || d.lost !== null) && (
          <section className="panel col-2">
            <div className="panel__head">
              <h3>Followers gained and lost</h3>
              <span className="sub">each day · Instagram only shows you the net</span>
            </div>
            <div className="panel__body">
              <FlowBars days={flowDays} />
              <p className="muted" style={{ fontSize: 11.5, margin: "8px 0 0", lineHeight: 1.55 }}>
                A net figure hides half the story. Gaining 412 and losing 392 looks
                identical to gaining 20, and only one of those is a healthy month.
                Days Instagram did not report are left blank rather than drawn as zero.
              </p>
            </div>
          </section>
        )}

        <section className="panel col-3">
          <div className="panel__head">
            <h3>Every post, and how far it got</h3>
            <span className="sub">by the day it went out</span>
          </div>
          <div className="panel__body">
            <PostScatter posts={scopedContent
              .filter((c) => typeof c.reach === "number" && (c.reach as number) > 0)
              .map((c) => ({
                id: c.id,
                title: c.title || "Untitled",
                date: c.published_at,
                format: c.media_type,
                reach: c.reach as number,
                engagements: sumKnown(c.likes, c.comments, c.shares, c.saves),
              }))} />
          </div>
        </section>

        {/*
          * The interpretation layer — the reason this costs 50 JD and not $20.
          * Everything above is a chart any tool draws; these four answer the
          * questions a client actually asks and a sponsor actually pays for.
          */}
        <DiscoveryPanel metrics={metrics} scope={scope} days={splitDays} />
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
                    <td className="num tnum">{metric(c.views)}</td>
                    <td className="num tnum">{metric(sumKnown(c.likes, c.comments, c.shares, c.saves))}</td>
                    <td className="num tnum">{metric(c.shares)}</td>
                    <td className="num tnum">{metric(c.saves)}</td>
                  </tr>
                ))}
                {scopedContent.length === 0 && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>No posts synced for this scope yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      {/*
        * Said here, unprompted, because a client WILL compare one day against
        * the Instagram app and find a gap. Verified 2026-09-08: the app's daily
        * figure cannot be reproduced from the API under ANY 24-hour window (441
        * in the app, 396 from every offset between UTC-14 and UTC+10), while the
        * 30-day totals agree to 0.7%. There is nothing to align to, so the only
        * honest move is to say so first. API-VERIFICATION.md 6.8.
        */}
      <p className="muted" style={{ margin: "18px 2px 0", fontSize: 11.5, lineHeight: 1.6, maxWidth: 760 }}>
        Daily figures here come straight from Instagram's official data feed. The
        Instagram app works out its own daily numbers a slightly different way, so
        one particular day can differ between the two. Over a full month the
        totals line up to within about 1%.
      </p>
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
      Your accounts are connected. Your numbers arrive on their own within about fifteen minutes, or press Sync if you would rather not wait.
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
