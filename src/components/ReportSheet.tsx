import { compact, metric, full } from "../lib/format";
import type { ReportSnapshot } from "../lib/snapshot";
import { reportIdentity, footerLine, PROVENANCE_NOTE, TZ_LABEL } from "../lib/reportMeta";

const delta = (n: number | null) => {
  if (n === null) return <span className="delta --flat muted">n/a</span>;
  const r = Math.round(n);
  return <span className={`delta ${r > 0 ? "--pos" : r < 0 ? "--neg" : "--flat"}`}>{r > 0 ? "+" : ""}{r}%</span>;
};

/** Pure, print-friendly render of a report snapshot. Shared by the live
 *  Reports page and the public /r/:slug viewer so they never drift. */
export default function ReportSheet({ snap }: { snap: ReportSnapshot }) {
  // Optional: links shared before the analysis existed still render.
  const analysis = snap.analysis;
  // The account's own calendar, matching every date printed below it. A report
  // whose header is in the reader's timezone and whose rows are in Amman days
  // invites exactly the discrepancy the rest of this product works to prevent.
  const id = reportIdentity({
    account: snap.account ?? "", scopeLabel: snap.scopeLabel,
    range: snap.range, generatedAt: snap.generatedAt,
  });
  return (
    <div className="sheet">
      <header className="sheet__head">
        <span className="brandmark">
          <span className="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l2.5-7 4 15 3-9 2 3h4.5" /></svg></span>
          <b>PulseBoard</b>
        </span>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Performance report</div>
          <div style={{ fontSize: 12.5, fontWeight: 550 }}>{id.account}</div>
          <div className="muted" style={{ fontSize: 12 }}>
            {id.scopeLabel} · {id.rangeLabel.toLowerCase()}
          </div>
          <div className="muted" style={{ fontSize: 11 }}>
            Generated {id.generated} · {TZ_LABEL}
          </div>
        </div>
      </header>

      <h4 className="sheet__h">Headline metrics</h4>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Metric</th><th className="num">Total</th><th className="num">Trend</th></tr></thead>
          <tbody>
            {snap.headline.map((h) => (
              <tr key={h.label}><td>{h.label}</td><td className="num tnum">{full(h.total)}</td><td className="num">{delta(h.deltaPct)}</td></tr>
            ))}
            <tr><td>Engagement rate</td><td className="num tnum">{snap.engagementRate.toFixed(1)}%</td><td className="num muted">n/a</td></tr>
          </tbody>
        </table>
      </div>

      <h4 className="sheet__h">By platform</h4>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Platform</th><th className="num">Followers</th><th className="num">Reach</th><th className="num">Views</th><th className="num">Engagements</th></tr></thead>
          <tbody>
            {snap.platforms.map((p) => (
              <tr key={p.name}>
                <td>{p.name}</td>
                <td className="num tnum">{compact(p.followers)}</td>
                <td className="num tnum">{compact(p.reach)}</td>
                <td className="num tnum">{compact(p.views)}</td>
                <td className="num tnum">{compact(p.engagements)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {snap.top.length > 0 && <>
        <h4 className="sheet__h">Top content</h4>
        <div className="table-wrap">
          <table className="data">
            <thead><tr><th>Post</th><th>Platform</th><th className="num">Views</th><th className="num">Likes</th><th className="num">Comments</th></tr></thead>
            <tbody>
              {snap.top.map((c, i) => (
                <tr key={i}>
                  <td className="cell-clamp">{c.title}</td>
                  <td>{c.platform}</td>
                  <td className="num tnum">{metric(c.views)}</td>
                  <td className="num tnum">{metric(c.likes)}</td>
                  <td className="num tnum">{metric(c.comments)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      <div className="sheet__cols">
        {snap.windows.length > 0 && <div>
          <h4 className="sheet__h">Best times to post</h4>
          <ul className="sheet__list">{snap.windows.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>}
        <div>
          <h4 className="sheet__h">Notable moves</h4>
          {snap.alerts.length === 0
            ? <p className="muted" style={{ fontSize: 12.5 }}>Nothing unusual this period.</p>
            : <ul className="sheet__list">{snap.alerts.map((a, i) => <li key={i}>{a.label} {a.kind === "drop" ? "dropped" : "spiked"} {Math.abs(Math.round(a.deltaPct))}% on {a.date}</li>)}</ul>}
        </div>
      </div>

      {/*
        * The interpretation half of the report.
        *
        * Everything above is a measurement; these four are worked out from the
        * history stored for this account, which is why a report is worth reading
        * rather than skimming.
        *
        * Rendered from the snapshot, so a SHARED link shows exactly the same
        * thing with no database behind it.
        */}
      {analysis && (
        <>
          <h4 className="sheet__h">Deeper analysis</h4>

          {analysis.timing.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <b style={{ fontSize: 12.5 }}>When posts performed</b>
              <ul className="sheet__list">
                {analysis.timing.map((t) => (
                  <li key={t.label}>
                    {t.label}: {t.lift >= 1
                      ? `${Math.round((t.lift - 1) * 100)}% above this account's typical post`
                      : `${Math.round((1 - t.lift) * 100)}% below typical`}{" "}
                    ({t.posts} posts)
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                Measured on results: each post compared with the typical post of
                the same kind on this account.
              </p>
            </div>
          )}

          {analysis.multiples.length > 0 && (
            <div style={{ marginBottom: 10 }}>
              <b style={{ fontSize: 12.5 }}>Reach against the following at the time</b>
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>Post</th><th className="num">Reach</th><th className="num">Followers then</th><th className="num">Times over</th></tr></thead>
                  <tbody>
                    {analysis.multiples.map((m, i) => (
                      <tr key={i}>
                        <td className="cell-clamp">{m.title}</td>
                        <td className="num tnum">{full(m.reach)}</td>
                        <td className="num tnum">{full(m.followers)}</td>
                        <td className="num tnum"><b>{m.times.toFixed(1)}x</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="sheet__cols">
            {analysis.concentration && (
              <div>
                <b style={{ fontSize: 12.5 }}>How concentrated the reach is</b>
                <p style={{ fontSize: 12.5, margin: "4px 0 0" }}>
                  {analysis.concentration.postsForHalf} of{" "}
                  {analysis.concentration.posts} posts carry half of all reach.
                  The single best post is{" "}
                  {Math.round(analysis.concentration.topSharePct)}% of it.
                </p>
                <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                  A month built on one post reads as a collapse the next month
                  through nobody's fault. This says which kind of month it was.
                </p>
              </div>
            )}

            <div>
              <b style={{ fontSize: 12.5 }}>Days that cost followers</b>
              {!analysis.costReported ? (
                <p className="muted" style={{ fontSize: 12.5, margin: "4px 0 0" }}>
                  Instagram did not report follower losses for this account, so
                  this could not be looked at.
                </p>
              ) : analysis.costDays.length === 0 ? (
                <p style={{ fontSize: 12.5, margin: "4px 0 0" }}>
                  No day stood out. Losses stayed near the usual{" "}
                  {full(analysis.costTypical ?? 0)} a day.
                </p>
              ) : (
                <>
                  <ul className="sheet__list">
                    {analysis.costDays.map((d) => (
                      <li key={d.date}>
                        {d.date}: lost {full(d.unfollows)} against a usual{" "}
                        {full(d.typical)}. Published: {d.posts.join(", ")}
                      </li>
                    ))}
                  </ul>
                  <p className="muted" style={{ fontSize: 11, margin: "2px 0 0" }}>
                    These posts went out on those days. That is not proof they
                    caused it.
                  </p>
                </>
              )}
            </div>
          </div>
        </>
      )}

      {/*
        * The footer every export shares.
        *
        * Two jobs. It tells a sponsor what a blank means and why a single day can
        * differ from the Instagram app, which is the argument this product would
        * otherwise lose by default. And it is the only marketing surface here: a
        * report reaches people who have never heard of PulseBoard, are looking
        * at evidence of what it does, and have no other way to find it.
        */}
      <footer className="sheet__foot">
        <p style={{ margin: "0 0 6px" }}>{PROVENANCE_NOTE}</p>
        <p style={{ margin: 0 }}>{footerLine(id)}</p>
      </footer>
    </div>
  );
}
