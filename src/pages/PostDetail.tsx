import { useParams, Link } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import { metric, sumKnown, full, shortDate, timeAgo } from "../lib/format";
import { postContext, postRank, engagementSplit, ageHours, tooEarly } from "../lib/insights";
import { PlatformBadge } from "../components/PlatformTile";
import RequireData from "../components/RequireData";
import DistributionStrip from "../components/charts/DistributionStrip";
import { useEffect, useRef, useState } from "react";
import { refreshPost } from "../lib/api";
import { isDemoMode } from "../lib/demoData";
import type { ContentItem } from "../lib/types";

/**
 * One post, on its own page.
 *
 * The question this screen exists to answer is "should I keep this?", and a
 * creator asks it within hours of publishing. That shapes everything here:
 *
 *  - Every metric can say "not reported". Instagram returns nothing for a post's
 *    first minutes and keeps counting for days; a 0 would answer "did anyone see
 *    this?" with a confident no at the moment of maximum consequence.
 *  - Nothing is judged before 24 hours. A banner says so rather than letting
 *    someone delete a post that was doing fine.
 *  - Numbers appear beside the median for the SAME format, because 800 reach is
 *    excellent for one account and a failure for another, and a carousel is not
 *    a reel.
 */
export default function PostDetail() {
  /*
   * Keyed on the post id so moving from one post to the next REMOUNTS the inner
   * component. Without it React keeps the same instance across a param change
   * and every piece of state below survives: the freshness stamp, the refreshed
   * figures, and the ref that says the automatic read has already run. The
   * second post would then show the first post's read time over its own numbers
   * and never fetch, which is precisely the mismatch this page exists to
   * prevent.
   */
  const { id } = useParams<{ id: string }>();
  return <RequireData><PostDetailInner key={id} /></RequireData>;
}

const METRICS = [
  { key: "views", label: "Views", hint: "Times it was played or displayed" },
  { key: "reach", label: "Reach", hint: "Distinct accounts that saw it" },
  { key: "likes", label: "Likes", hint: null },
  { key: "comments", label: "Comments", hint: null },
  { key: "shares", label: "Shares", hint: "Sent to someone else. The strongest sign a post is spreading" },
  { key: "saves", label: "Saves", hint: "Kept for later. Someone meant to come back to it" },
] as const;

function PostDetailInner() {
  const { id } = useParams<{ id: string }>();
  const dash = useDash();
  const post = dash.content.find((c) => c.id === id);
  // Hoisted above the early return below: a hook called after a conditional
  // return runs on some renders and not others, and React counts hooks by
  // position. The post can arrive late while data is still loading, which is
  // exactly when the count would change.
  const [stripKey, setStripKey] = useState<typeof METRICS[number]["key"]>("views");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMsg, setRefreshMsg] = useState<string | null>(null);
  const [fresh, setFresh] = useState<Partial<ContentItem> | null>(null);
  /*
   * When these figures were last read. Seeded from the stored stamp and moved
   * forward by any successful read, automatic or manual, so the freshness line
   * never claims an age the numbers on screen no longer have.
   */
  const [checkedAt, setCheckedAt] = useState<string | null>(post?.checked_at ?? null);
  // One automatic read per post per visit. A ref, not state: it must not
  // schedule a render, and it must be consulted before the fetch is started
  // rather than after it resolves, or a double-invoked effect fires twice.
  const autoDone = useRef<string | null>(null);

  /*
   * FETCH ON OPEN.
   *
   * The scheduled sync runs every fifteen minutes, so a post could be a quarter
   * of an hour behind the Instagram app on the client's own phone. Opening the
   * page IS the request to see this post, so it is also the moment to read it:
   * the client never sees a stale post page, and never has to know that a button
   * exists to make it current.
   *
   * Bounded on purpose. It fires once per post per visit, only when the stored
   * figures are older than the threshold, and never in the demo. Each read costs
   * one platform call and one Worker invocation out of an ACCOUNT-wide daily
   * budget shared with everything else on the same Cloudflare account, so an
   * unguarded fetch-on-render would be a self-inflicted outage.
   *
   * Failure is deliberately quiet. Nobody asked for this fetch, so an error
   * banner would be noise about an action the client did not take. The page then
   * shows the stored figures with their true, older read time, which is honest:
   * the fallback is accurate data described accurately, not a blank.
   */
  const AUTO_STALE_MS = 2 * 60_000;
  useEffect(() => {
    if (!post || isDemoMode()) return;
    if (autoDone.current === post.id) return;
    const age = post.checked_at ? Date.now() - Date.parse(post.checked_at) : Infinity;
    if (Number.isFinite(age) && age < AUTO_STALE_MS) return;
    autoDone.current = post.id;

    let cancelled = false;
    setRefreshing(true);
    refreshPost(post.id)
      .then((r) => {
        if (cancelled) return;
        const { refreshed_at: at, ...metrics } = r;
        setFresh(metrics);
        setCheckedAt(at);
      })
      .catch(() => { /* see the note above: stale but true beats an alarm */ })
      .finally(() => { if (!cancelled) setRefreshing(false); });

    return () => { cancelled = true; };
  }, [post?.id, post?.checked_at]);

  if (!post) {
    return (
      <div className="panel">
        <div className="panel__body stack" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>That post is not in the current window</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            It may fall outside the selected date range, or belong to an account that is
            no longer connected.
          </p>
          <Link to="/content" className="btn" style={{ alignSelf: "start" }}>Back to Content</Link>
        </div>
      </div>
    );
  }

  // Freshly fetched numbers win over the stored ones for this render, so the
  // page reflects the refresh without waiting for a full reload of the dashboard.
  const view = fresh ? ({ ...post, ...fresh } as typeof post) : post;
  const hours = ageHours(post.published_at);
  const young = tooEarly(post.published_at);
  // When these figures were read, including by the automatic read above.
  const checked = timeAgo(checkedAt);
  const engagement = sumKnown(view.likes, view.comments, view.shares, view.saves);
  // A rate needs a denominator that exists. Reach of null gives no rate at all
  // rather than a rate computed against a fabricated zero.
  const engRate = engagement !== null && view.reach !== null && view.reach > 0
    ? (engagement / view.reach) * 100 : null;

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="panel">
        <div className="panel__body stack" style={{ gap: 12 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <PlatformBadge platform={post.platform} />
            <span className="muted" style={{ fontSize: 12 }}>
              {post.media_type} · {shortDate(post.published_at)} ·{" "}
              {hours < 48 ? `${Math.round(hours)}h old` : `${Math.round(hours / 24)} days old`}
            </span>
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                 className="muted" style={{ fontSize: 12 }}>
                Open on {PLATFORMS[post.platform].name} ↗
              </a>
            )}
            <button type="button" className="btn btn--sm" disabled={refreshing}
              style={{ marginLeft: "auto" }}
              onClick={async () => {
                setRefreshing(true); setRefreshMsg(null);
                try {
                  const r = await refreshPost(post.id);
                  // refreshed_at is metadata about the fetch, not a column on the post.
                  const { refreshed_at: _t, ...metrics } = r;
                  setFresh(metrics);
                  setCheckedAt(r.refreshed_at);
                  setRefreshMsg(`Updated just now, ${new Date(r.refreshed_at).toLocaleTimeString()}`);
                } catch (e) {
                  setRefreshMsg(e instanceof Error ? e.message : "Could not refresh.");
                } finally { setRefreshing(false); }
              }}>
              {refreshing ? "Checking..." : "Check now"}
            </button>
          </div>
          <h2 style={{ margin: 0, fontSize: 19, lineHeight: 1.35 }}>
            {post.title || "Untitled"}
          </h2>
          {refreshMsg ? (
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {refreshMsg}
              {fresh && " Instagram keeps counting for days, so these will still move."}
            </p>
          ) : (
            /*
             * ALWAYS shown, not only after someone presses "Check now".
             *
             * This is the line that prevents the most likely complaint about this
             * product. A creator publishes, sees a figure in the Instagram app,
             * opens this page and sees a different one. Both are right; they were
             * read minutes apart, and a new post's counters move fast.
             *
             * Before this line the page gave them nothing to reason with, so the
             * only available conclusion was that we are wrong. Naming the moment
             * the figures were taken turns a contradiction into a timestamp, and
             * the button beside it turns it into something they can settle
             * themselves in one click.
             */
            <p className="muted" style={{ margin: 0, fontSize: 12 }}>
              {refreshing
                ? "Reading the latest numbers from Instagram..."
                : checked
                  ? `Read from Instagram ${checked}.`
                  : "Not yet read from Instagram since this page started recording the time."}
              {" "}This page checks Instagram each time you open it. Instagram
              keeps counting for days, so these will still move.
            </p>
          )}

          {young && (
            <p className="muted" style={{ margin: 0, fontSize: 12.5, padding: "8px 10px",
                 border: "1px solid var(--border)", borderRadius: 8 }}>
              <strong>Too early to judge.</strong> Instagram is still counting, and reports
              nothing at all for the first stretch after publishing. Numbers below will keep
              climbing for a day or more, so a low figure now is not a verdict.
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3>How it performed</h3>
          <span className="sub">compared with your typical {post.media_type.toLowerCase()}</span>
        </div>
        <div className="panel__body">
          <div className="bars">
            {METRICS.map((m) => {
              const value = view[m.key];
              const ctx = postContext(view, dash.content, m.key);
              const rk = postRank(view, dash.content, m.key);
              /*
               * The bar is drawn against the account's BEST post, so the length
               * means "how close to your ceiling", and a tick marks the median
               * so the typical case is visible in the same picture. A number on
               * its own cannot say whether it is good; these two references can.
               */
              const scale = rk.best && rk.best > 0 ? rk.best : null;
              const pctOfBest = value !== null && scale ? Math.max(1.5, (value / scale) * 100) : 0;
              const medianMark = ctx.median !== null && scale ? (ctx.median / scale) * 100 : null;
              return (
                <div key={m.key} style={{ padding: "9px 0", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 550 }}>{m.label}</span>
                    <span className="tnum" style={{ fontSize: 17, fontWeight: 600 }}>{metric(value)}</span>
                  </div>

                  {value === null ? (
                    <p className="muted" style={{ fontSize: 11.5, margin: "4px 0 0" }}>
                      Instagram did not give us this figure for this post. It does not mean zero.
                    </p>
                  ) : (
                    <>
                      <div style={{ position: "relative", height: 8, borderRadius: 20,
                             background: "var(--panel-sunk)", overflow: "hidden", margin: "7px 0 5px" }}>
                        <div style={{ display: "block", height: "100%", width: `${pctOfBest}%`,
                               borderRadius: 20, background: "var(--brand, #4f7cff)" }} />
                      </div>
                      {medianMark !== null && (
                        <div style={{ position: "relative", height: 0 }}>
                          <span style={{ position: "absolute", left: `${Math.min(99, medianMark)}%`, top: -12,
                                   width: 2, height: 12, background: "var(--text-2)", opacity: .55 }} />
                        </div>
                      )}
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11.5 }} className="muted">
                        {rk.rank !== null && <span><strong>#{rk.rank}</strong> of {rk.of} posts</span>}
                        {ctx.vsMedian !== null && (
                          <span>
                            {ctx.vsMedian >= 1
                              ? `${((ctx.vsMedian - 1) * 100).toFixed(0)}% above`
                              : `${((1 - ctx.vsMedian) * 100).toFixed(0)}% below`} your typical {post.media_type.toLowerCase()}
                            {ctx.sample < 3 && ` · only ${ctx.sample} to compare`}
                          </span>
                        )}
                        {m.hint && <span>· {m.hint}</span>}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          {METRICS.some((m) => post[m.key] === null) && (
            <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              "n/a" means Instagram did not give us that figure. Most often the post was
              published before this account became a professional account, in which case
              Instagram never will. It does not mean zero.
            </p>
          )}
        </div>
      </div>

      {(() => {
        /*
         * The rank as a picture. "#1 of 12" cannot distinguish topping a tight
         * cluster from being an outlier an order of magnitude clear of
         * everything else, and those mean very different things for what to
         * post next.
         */
        const pool = dash.content.filter((c) => c.platform === post.platform && c[stripKey] !== null);
        if (pool.length < 2) return null;
        return (
          <div className="panel">
            <div className="panel__head" style={{ gap: 8, flexWrap: "wrap" }}>
              <h3>Where it sits</h3>
              <span className="sub">this post against every post we hold</span>
              <span style={{ marginLeft: "auto", display: "flex", gap: 4, flexWrap: "wrap" }}>
                {METRICS.map((m) => (
                  <button key={m.key} type="button"
                          className={`btn btn--sm${stripKey === m.key ? " btn--on" : ""}`}
                          onClick={() => setStripKey(m.key)}>{m.label}</button>
                ))}
              </span>
            </div>
            <div className="panel__body">
              <DistributionStrip
                highlightId={post.id}
                points={pool.map((c) => ({
                  id: c.id,
                  label: `${(c.title || "Untitled").slice(0, 40)} · ${c.media_type}`,
                  value: c[stripKey] as number,
                }))}
              />
            </div>
          </div>
        );
      })()}

      {(() => {
        const split = engagementSplit(view);
        if (!split.total || split.total <= 0) return null;
        const COLORS = ["var(--brand, #4f7cff)", "var(--ok, #2f9e6e)", "#c084fc", "#f59e0b"];
        return (
          <div className="panel">
            <div className="panel__head">
              <h3>What kind of engagement</h3>
              <span className="sub">composition, not just the total</span>
            </div>
            <div className="panel__body stack" style={{ gap: 10 }}>
              <div style={{ display: "flex", height: 12, borderRadius: 6, overflow: "hidden",
                     background: "var(--panel-sunk)" }}>
                {split.parts.map((p, i) => (
                  <div key={p.key} title={`${p.label}: ${full(p.value)}`}
                       style={{ width: `${(p.value / split.total!) * 100}%`, background: COLORS[i % COLORS.length] }} />
                ))}
              </div>
              <div style={{ display: "flex", gap: 14, flexWrap: "wrap", fontSize: 12 }}>
                {split.parts.map((p, i) => (
                  <span key={p.key} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <span style={{ width: 9, height: 9, borderRadius: 3, background: COLORS[i % COLORS.length] }} />
                    {p.label} <strong className="tnum">{full(p.value)}</strong>
                    <span className="muted">{((p.value / split.total!) * 100).toFixed(0)}%</span>
                  </span>
                ))}
              </div>
              <p className="muted" style={{ fontSize: 12, margin: 0 }}>
                Saves and shares take real effort. Someone kept the post or passed it on to
                a friend. A like takes a second. Two posts with the same total can mean very
                different things, and a sponsor is paying for the difference.
                {split.parts.length < 4 && " Components Instagram did not report are omitted rather than drawn as empty."}
              </p>
            </div>
          </div>
        );
      })()}

      <div className="panel">
        <div className="panel__head"><h3>Derived</h3><span className="sub">shown only where we have the numbers to work them out</span></div>
        <div className="panel__body">
          <div className="bars">
            <Derived label="Engagement rate" value={engRate === null ? null : `${engRate.toFixed(1)}%`}
                     why="How many of the people who saw it did something about it." />
            <Derived label="Total interactions" value={engagement === null ? null : full(engagement)}
                     why="Likes, comments, shares and saves added together." />
            <Derived label="Shares per 1,000 people reached"
                     value={view.shares !== null && view.reach !== null && view.reach > 0
                       ? ((view.shares / view.reach) * 1000).toFixed(1) : null}
                     why="How often it got passed on, for every thousand people who saw it." />
          </div>
        </div>
      </div>

      <Link to="/content" className="btn" style={{ alignSelf: "start" }}>← Back to Content</Link>
    </div>
  );
}

function Derived({ label, value, why }: { label: string; value: string | null; why: string }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "150px 1fr auto", gap: 12,
           alignItems: "baseline", padding: "7px 0" }}>
      <span className="muted" style={{ fontSize: 12.5 }}>{label}</span>
      <span className="muted" style={{ fontSize: 11.5 }}>{why}</span>
      <span className="tnum" style={{ fontSize: 17, fontWeight: 600 }}>
        {value ?? <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>not available</span>}
      </span>
    </div>
  );
}

export type { ContentItem };
