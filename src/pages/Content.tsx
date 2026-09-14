import { useState } from "react";
import { Link } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import { compact, metric, sumKnown, pctPlain, shortDate, timeAgo } from "../lib/format";
import type { ContentItem, Platform } from "../lib/types";
import { PlatformBadge } from "../components/PlatformTile";
import StatCard from "../components/StatCard";
import RequireData from "../components/RequireData";

type SortKey = keyof Pick<ContentItem, "views" | "likes" | "comments" | "shares" | "saves" | "reach" | "published_at" | "title">;

const COLS: { key: SortKey; label: string; num: boolean }[] = [
  { key: "title", label: "Post", num: false },
  { key: "views", label: "Views", num: true },
  { key: "reach", label: "Reach", num: true },
  { key: "likes", label: "Likes", num: true },
  { key: "comments", label: "Comments", num: true },
  { key: "shares", label: "Shares", num: true },
  { key: "saves", label: "Saves", num: true },
];

export default function Content() {
  return <RequireData><ContentInner /></RequireData>;
}

function ContentInner() {
  const dash = useDash();
  // The global range governs daily metrics. Posts have their own time
  // dimension, and hiding a year-old post that is still the account's best does
  // not serve anyone — so the list defaults to everything and this toggle makes
  // the range control MEAN something here rather than sit inert.
  const [inRange, setInRange] = useState(false);
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [dir, setDir] = useState<-1 | 1>(-1);

  const platforms: Platform[] = dash.scope === "all" ? dash.connectedPlatforms : [dash.scope];
  const cutoff = new Date(Date.now() - dash.range * 86400000).toISOString();
  const items = dash.content.filter(
    (c) => platforms.includes(c.platform) && (!inRange || c.published_at >= cutoff),
  );

  // Totals sum what was reported. An unreported post contributes nothing rather
  // than a fabricated zero, and a post with no reach is skipped in the rate
  // rather than counted as a 0% performer.
  //
  // A LinkedIn post's `views` column holds IMPRESSIONS, a different quantity, so
  // it is never added to other platforms' views: a LinkedIn-only list totals
  // impressions, and a mixed list totals views without the LinkedIn posts. And a
  // total or rate with nothing behind it is unknown, not 0 — with LinkedIn
  // selected no post has reach, and this card used to read "0.0%".
  const onlyLinkedIn = platforms.length === 1 && platforms[0] === "linkedin";
  const viewRows = items.filter((c) => onlyLinkedIn || c.platform !== "linkedin");
  const totalViews = sumKnown(...viewRows.map((c) => c.views));
  const totalEng = sumKnown(...items.map((c) => sumKnown(c.likes, c.comments, c.shares, c.saves)));
  const erRows = items.filter((c) => c.reach !== null && c.reach > 0);
  const avgEr = erRows.length
    ? (erRows.reduce((s, c) => s + (sumKnown(c.likes, c.comments, c.shares, c.saves) ?? 0) / (c.reach as number), 0) / erRows.length) * 100
    : null;
  const viewsLabel = onlyLinkedIn ? "Impressions" : "Views";

  const sorted = [...items].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
    // Unknown sorts last in both directions; ordering it as 0 ranks a figure nobody reported.
    if (av === null || av === undefined) return bv === null || bv === undefined ? 0 : 1;
    if (bv === null || bv === undefined) return -1;
    return dir * ((av as number) - (bv as number));
  });

  function toggle(k: SortKey) {
    if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setDir(-1); }
  }

  // The most recent read across the listed posts. See the note beside its use.
  const lastRead = timeAgo(
    items.reduce<string | null>(
      (best, i) => (i.checked_at && (!best || i.checked_at > best) ? i.checked_at : best), null),
  );

  return (
    <>
      <div className="kpis">
        <StatCard label="Posts stored" value={compact(items.length)} />
        <StatCard label={`Total ${viewsLabel.toLowerCase()}`} value={metric(totalViews)} />
        <StatCard label="Total engagements" value={metric(totalEng)} />
        <StatCard label="Avg engagement rate" value={avgEr === null ? "n/a" : pctPlain(avgEr)} />
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel__head" style={{ gap: 10, flexWrap: "wrap" }}>
          <h3>{inRange ? "Published in range" : "All content"}</h3>
          <span className="sub">
            {items.length} post{items.length === 1 ? "" : "s"} · click a column to sort
            {/*
              * The freshest stamp across the listed posts, not each post's own.
              * A timestamp on every row would be noise, and the honest summary of
              * a table is its most recent read: it answers "how current is this
              * screen?", which is the question someone holding their phone next
              * to it is actually asking.
              */}
            {lastRead && ` · read from ${platforms.length === 1 ? PLATFORMS[platforms[0]].name : "the platforms"} ${lastRead}`}
          </span>
          <span style={{ marginLeft: "auto", display: "flex", gap: 4 }}>
            <button type="button" className={`btn btn--sm${inRange ? "" : " btn--on"}`}
                    onClick={() => setInRange(false)}>All time</button>
            <button type="button" className={`btn btn--sm${inRange ? " btn--on" : ""}`}
                    onClick={() => setInRange(true)}>Last {dash.range}d</button>
          </span>
        </div>
        <div className="table-wrap table-wrap--sticky">
          <table className="data">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} className={c.num ? "num" : ""} onClick={() => toggle(c.key)}>
                    {c.key === "views" && onlyLinkedIn ? "Impressions"
                      : c.key === "views" && platforms.includes("linkedin") ? "Views / impr."
                      : c.key === "shares" && onlyLinkedIn ? "Reposts" : c.label}{sortKey === c.key && <span className="arrow"> {dir === 1 ? "▲" : "▼"}</span>}
                  </th>
                ))}
                <th className="num">Watch</th>
                <th className="num">Retention</th>
                <th>Platform</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((c) => (
                <tr key={c.id}>
                  <td>
                    {/* The TITLE opens the post's own page; the arrow opens
                        Instagram. Nesting the external anchor inside the router
                        Link would be invalid HTML and would swallow it.
                        cell-clamp is load-bearing: an Instagram caption is a wall
                        of hashtags, and without a cap the first column widens
                        until every numeric column is pushed off the screen. */}
                    <div className="stack cell-clamp">
                      <span style={{ display: "flex", gap: 6, alignItems: "baseline", minWidth: 0 }}>
                        <Link to={`/content/${c.id}`} style={{ fontWeight: 550, overflow: "hidden",
                              textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.title || "Untitled"}</Link>
                        {c.permalink && (
                          <a href={c.permalink} target="_blank" rel="noreferrer"
                             className="muted" style={{ fontSize: 11 }}
                             aria-label="Open on the platform">↗</a>
                        )}
                      </span>
                      <span className="muted" style={{ fontSize: 11 }}>{c.media_type} · {shortDate(c.published_at)}</span>
                    </div>
                  </td>
                  <td className="num tnum">{metric(c.views)}</td>
                  <td className="num tnum">{metric(c.reach)}</td>
                  <td className="num tnum">{metric(c.likes)}</td>
                  <td className="num tnum">{metric(c.comments)}</td>
                  <td className="num tnum">{metric(c.shares)}</td>
                  <td className="num tnum">{metric(c.saves)}</td>
                  <td className="num tnum">{c.avg_watch_seconds != null ? `${c.avg_watch_seconds}s` : "n/a"}</td>
                  <td className="num tnum">{c.retention_pct != null ? `${c.retention_pct}%` : "n/a"}</td>
                  <td><PlatformBadge platform={c.platform} /></td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={COLS.length + 3} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  {platforms.length === 1 && platforms[0] === "linkedin"
                    && dash.accounts.filter((a) => a.platform === "linkedin").every((a) => a.auth_mode === "linkedin_member")
                    ? "LinkedIn does not let apps list a personal profile's posts, so there is no per-post table for it."
                    : "No posts synced for this scope yet."}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
