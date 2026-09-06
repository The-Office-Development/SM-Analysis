import { useParams, Link } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import { metric, sumKnown, full, shortDate } from "../lib/format";
import { postContext, ageHours, tooEarly } from "../lib/insights";
import { PlatformBadge } from "../components/PlatformTile";
import RequireData from "../components/RequireData";
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
  return <RequireData><PostDetailInner /></RequireData>;
}

const METRICS = [
  { key: "views", label: "Views", hint: "Times it was played or displayed" },
  { key: "reach", label: "Reach", hint: "Distinct accounts that saw it" },
  { key: "likes", label: "Likes", hint: null },
  { key: "comments", label: "Comments", hint: null },
  { key: "shares", label: "Shares", hint: "Sent to someone else — the strongest distribution signal" },
  { key: "saves", label: "Saves", hint: "Kept for later — intent, not just approval" },
] as const;

function PostDetailInner() {
  const { id } = useParams<{ id: string }>();
  const dash = useDash();
  const post = dash.content.find((c) => c.id === id);

  if (!post) {
    return (
      <div className="panel">
        <div className="panel__body stack" style={{ gap: 10 }}>
          <h3 style={{ margin: 0 }}>That post is not in the current window</h3>
          <p className="muted" style={{ margin: 0, fontSize: 13 }}>
            It may fall outside the selected date range, or belong to an account that is
            no longer connected. Content shows the 25 most recent posts per account.
          </p>
          <Link to="/content" className="btn" style={{ alignSelf: "start" }}>Back to Content</Link>
        </div>
      </div>
    );
  }

  const hours = ageHours(post.published_at);
  const young = tooEarly(post.published_at);
  const engagement = sumKnown(post.likes, post.comments, post.shares, post.saves);
  // A rate needs a denominator that exists. Reach of null gives no rate at all
  // rather than a rate computed against a fabricated zero.
  const engRate = engagement !== null && post.reach !== null && post.reach > 0
    ? (engagement / post.reach) * 100 : null;

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
          </div>
          <h2 style={{ margin: 0, fontSize: 19, lineHeight: 1.35 }}>
            {post.title || "Untitled"}
          </h2>

          {young && (
            <p className="muted" style={{ margin: 0, fontSize: 12.5, padding: "8px 10px",
                 border: "1px solid var(--border)", borderRadius: 8 }}>
              <strong>Too early to judge.</strong> Instagram is still counting, and reports
              nothing at all for the first stretch after publishing. Numbers below will keep
              climbing for a day or more — a low figure now is not a verdict.
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__head">
          <h3>How it performed</h3>
          <span className="sub">against your median {post.media_type.toLowerCase()}</span>
        </div>
        <div className="panel__body">
          <div className="bars">
            {METRICS.map((m) => {
              const value = post[m.key];
              const ctx = postContext(post, dash.content, m.key);
              return (
                <div key={m.key} style={{ display: "grid", gridTemplateColumns: "104px 1fr auto",
                       gap: 12, alignItems: "baseline", padding: "7px 0" }}>
                  <span className="muted" style={{ fontSize: 12.5 }}>{m.label}</span>
                  <span style={{ fontSize: 12, color: "var(--text-2)" }}>
                    {value === null
                      ? "not reported"
                      : ctx.vsMedian === null
                        ? (ctx.sample === 0 ? "no other post of this format to compare" : "")
                        : <>
                            {ctx.vsMedian >= 1
                              ? `${((ctx.vsMedian - 1) * 100).toFixed(0)}% above`
                              : `${((1 - ctx.vsMedian) * 100).toFixed(0)}% below`}{" "}
                            median of {full(ctx.median ?? 0)}
                            <span className="muted"> · {ctx.sample} post{ctx.sample === 1 ? "" : "s"}</span>
                            {ctx.sample < 3 && <span className="muted"> (too few to lean on)</span>}
                          </>}
                  </span>
                  <span className="tnum" style={{ fontSize: 17, fontWeight: 600 }}>{metric(value)}</span>
                </div>
              );
            })}
          </div>
          {METRICS.some((m) => post[m.key] === null) && (
            <p className="muted" style={{ fontSize: 12, marginTop: 12, marginBottom: 0 }}>
              "Not reported" means Instagram did not return that figure — most often because
              the post predates this account becoming professional, in which case it never
              will. It does not mean zero.
            </p>
          )}
        </div>
      </div>

      <div className="panel">
        <div className="panel__head"><h3>Derived</h3><span className="sub">only where the inputs exist</span></div>
        <div className="panel__body">
          <div className="bars">
            <Derived label="Engagement rate" value={engRate === null ? null : `${engRate.toFixed(1)}%`}
                     why="Interactions divided by reach. Needs both." />
            <Derived label="Total interactions" value={engagement === null ? null : full(engagement)}
                     why="Likes, comments, shares and saves that were reported." />
            <Derived label="Shares per 1k reach"
                     value={post.shares !== null && post.reach !== null && post.reach > 0
                       ? ((post.shares / post.reach) * 1000).toFixed(1) : null}
                     why="How hard it travelled beyond the people it reached." />
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
