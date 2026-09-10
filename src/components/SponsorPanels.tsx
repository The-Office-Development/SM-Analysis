import { discovery, churn, formatPerformance, reachDrivers } from "../lib/insights";
import { compact } from "../lib/format";
import type { MetricPoint, ContentItem, Scope } from "../lib/types";
import SplitArea, { type SplitDay } from "./charts/SplitArea";

/**
 * The panels the product is actually sold on.
 *
 * PROJECT-STATE.md §1 is blunt about this: a client is buying the work, not a
 * login, and 50 JD is indefensible against a $20 tool that draws the same reach
 * chart. What is NOT in the $20 tool is on this page — how much of your reach
 * was strangers, how many people left while others arrived, what each format
 * returns per post, and why reach moved.
 *
 * Every panel here renders "not reported" rather than a zero when the platform
 * did not return the underlying figure. A "0% discovery" badge on an account
 * that actually reached forty thousand strangers is a wrong number in a media
 * kit, and CLAUDE.md §2 ranks that above an outage.
 */

function Unavailable({ what }: { what: string }) {
  return (
    <p className="muted" style={{ fontSize: 13, margin: 0 }}>
      {what} has not been reported for this account yet. It appears once a sync
      returns the breakdown. It is not zero, it is unknown.
    </p>
  );
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export function DiscoveryPanel(
  { metrics, scope, days }: { metrics: MetricPoint[]; scope: Scope; days?: SplitDay[] },
) {
  const d = discovery(metrics, scope);
  const hasTrend = (days ?? []).some((x) => x.followers !== null && x.nonFollowers !== null);
  return (
    <section className={"panel" + (hasTrend ? " col-2" : "")}>
      <div className="panel__head">
        <h3>Who you reached</h3>
        <span className="sub">followers vs new people</span>
      </div>
      <div className="panel__body stack" style={{ gap: 12 }}>
        {d.discoveryRate === null ? <Unavailable what="Reach among followers versus new people" /> : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 30, fontWeight: 650, letterSpacing: "-.02em" }}>{pct(d.discoveryRate)}</span>
              <span className="muted" style={{ fontSize: 13 }}>of reach was people who don't follow you</span>
            </div>
            {/*
              * One bar, two parts — the comparison is the whole point.
              *
              * Painted from --fb and --ig, the same two tokens the trend below
              * uses, so "already followed you" is one colour and "new people" is
              * the other everywhere on this page. It previously read
              * `var(--brand, …)` and `var(--ok, …)`, and NEITHER token exists in
              * this stylesheet, so it had always been drawing its hardcoded
              * fallbacks: an off-system blue and green that matched nothing else
              * and put the same two categories in different colours in different
              * places. The pair here separates at dE 29.6 under the worst colour
              * vision deficiency, where blue against green does not.
              */}
            <div style={{ display: "flex", height: 10, borderRadius: 5, overflow: "hidden", background: "var(--border)" }}>
              <div style={{ width: pct(1 - d.discoveryRate), background: "var(--fb)" }} />
              <div style={{ width: pct(d.discoveryRate), background: "var(--ig)" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
              <span className="muted">Existing followers {compact(d.followers ?? 0)}</span>
              <span className="muted">New people {compact(d.nonFollowers ?? 0)}</span>
            </div>
            <p className="muted" style={{ fontSize: 12, margin: 0 }}>
              This is the number a sponsor is buying: reach among people who do not
              already follow you is new audience for their brand.
              {d.partial && " Some reach could not be attributed to either group, so the split covers less than total reach."}
            </p>
            {/* The same fact over time. The headline says how much; this says
                whether it is holding, growing or was one good week. */}
            {hasTrend && <SplitArea days={days as SplitDay[]} height={188} />}
          </>
        )}
      </div>
    </section>
  );
}

export function ChurnPanel({ metrics, scope }: { metrics: MetricPoint[]; scope: Scope }) {
  const c = churn(metrics, scope);
  return (
    <section className="panel">
      <div className="panel__head">
        <h3>Growth, with the losses</h3>
        <span className="sub">gained and lost</span>
      </div>
      <div className="panel__body stack" style={{ gap: 12 }}>
        {c.gained === null && c.lost === null ? <Unavailable what="Follows and unfollows" /> : (
          <>
            {/*
              * `?? 0` is forbidden on these three. null means the platform did
              * not report the figure, and rendering that as 0 states something
              * we do not know: "nobody left" is a claim, not an absence.
              *
              * This is not hypothetical. unfollows has been null on every day
              * ever stored, across two accounts, while follows is populated —
              * so the both-null guard above never fires and this row would have
              * shown a sponsor "Lost -0" next to real growth, with a Net that
              * quietly treats unknown churn as none.
              */}
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap" }}>
              <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Gained</div>
                <div style={{ fontSize: 22, fontWeight: 620 }}>
                  {c.gained === null ? <span className="muted">not reported</span> : `+${compact(c.gained)}`}</div></div>
              <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Lost</div>
                <div style={{ fontSize: 22, fontWeight: 620 }}>
                  {c.lost === null ? <span className="muted">not reported</span> : `−${compact(c.lost)}`}</div></div>
              <div><div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".06em" }}>Net</div>
                <div style={{ fontSize: 22, fontWeight: 620 }}>
                  {c.gained === null || c.lost === null
                    ? <span className="muted">not reported</span>
                    : `${(c.net ?? 0) >= 0 ? "+" : ""}${compact(c.net ?? 0)}`}</div></div>
            </div>
            {c.lost === null && c.gained !== null && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Instagram is not returning unfollows for this account, so losses
                and the net cannot be shown. Growth above counts arrivals only.
              </p>
            )}
            {c.churnRate !== null && (
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                {Math.round(c.churnRate * 100)} people left for every 100 who arrived.
                {c.churnRate > 0.7 && " Most tools show only the net, which would have hidden this."}
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export function FormatPanel({ content }: { content: ContentItem[] }) {
  const rows = formatPerformance(content);
  return (
    <section className="panel">
      <div className="panel__head">
        <h3>What each format returns</h3>
        <span className="sub">median reach per post</span>
      </div>
      <div className="panel__body">
        {rows.length === 0 ? <Unavailable what="Per-format performance" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Format</th><th className="num">Posts</th><th className="num">Median reach</th><th className="num">Save rate</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.format}>
                    <td style={{ fontWeight: 550 }}>{r.format}</td>
                    <td className="num tnum">{r.posts}</td>
                    <td className="num tnum">{compact(r.medianReach)}</td>
                    <td className="num tnum">{r.saveRate === null ? "n/a" : `${(r.saveRate * 100).toFixed(2)}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="muted" style={{ fontSize: 12, margin: "10px 0 0" }}>
          The typical post, not the average. One post that took off should not describe what a
          format normally does. Saves are the strongest distribution signal
          Instagram exposes, and a like count hides them.
        </p>
      </div>
    </section>
  );
}

export function ReachDriversPanel(
  { current, previous, currentReach, previousReach }:
  { current: ContentItem[]; previous: ContentItem[]; currentReach: number | null; previousReach: number | null },
) {
  const drivers = reachDrivers(current, previous, currentReach, previousReach);
  return (
    <section className="panel">
      <div className="panel__head">
        <h3>Why reach moved</h3>
        <span className="sub">vs the previous period</span>
      </div>
      <div className="panel__body stack" style={{ gap: 10 }}>
        {drivers.length === 0 ? (
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>
            Not enough history in both periods to attribute the change. Nothing is
            shown rather than a guess.
          </p>
        ) : drivers.map((d) => (
          <div key={d.label} style={{ display: "flex", gap: 12, alignItems: "baseline" }}>
            <span style={{
              fontSize: 15, fontWeight: 620, minWidth: 88, textAlign: "right",
              fontVariantNumeric: "tabular-nums",
              color: d.effect >= 0 ? "var(--ok, #2f9e6e)" : "var(--bad, #c4503c)",
            }}>
              {d.effect >= 0 ? "+" : "−"}{compact(Math.abs(Math.round(d.effect)))}
            </span>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontWeight: 550, display: "block" }}>{d.label}</span>
              <span className="muted" style={{ fontSize: 12 }}>{d.detail}</span>
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
