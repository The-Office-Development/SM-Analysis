import { useState } from "react";
import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import { compact, pctPlain, shortDate } from "../lib/format";
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
  const [sortKey, setSortKey] = useState<SortKey>("views");
  const [dir, setDir] = useState<-1 | 1>(-1);

  const platforms: Platform[] = dash.scope === "all" ? dash.connectedPlatforms : [dash.scope];
  const items = dash.content.filter((c) => platforms.includes(c.platform));

  const totalViews = items.reduce((s, c) => s + c.views, 0);
  const totalEng = items.reduce((s, c) => s + c.likes + c.comments + c.shares + c.saves, 0);
  const avgEr = items.length ? (items.reduce((s, c) => s + (c.reach ? (c.likes + c.comments + c.shares + c.saves) / c.reach : 0), 0) / items.length) * 100 : 0;

  const sorted = [...items].sort((a, b) => {
    const av = a[sortKey], bv = b[sortKey];
    if (typeof av === "string" && typeof bv === "string") return dir * av.localeCompare(bv);
    return dir * ((av as number) - (bv as number));
  });

  function toggle(k: SortKey) {
    if (k === sortKey) setDir((d) => (d === 1 ? -1 : 1));
    else { setSortKey(k); setDir(-1); }
  }

  return (
    <>
      <div className="kpis">
        <StatCard label="Posts synced" value={compact(items.length)} />
        <StatCard label="Total views" value={compact(totalViews)} />
        <StatCard label="Total engagements" value={compact(totalEng)} />
        <StatCard label="Avg engagement rate" value={pctPlain(avgEr)} />
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel__head"><h3>All content</h3><span className="sub">{items.length} posts · click a column to sort</span></div>
        <div className="table-wrap table-wrap--sticky">
          <table className="data">
            <thead>
              <tr>
                {COLS.map((c) => (
                  <th key={c.key} className={c.num ? "num" : ""} onClick={() => toggle(c.key)}>
                    {c.label}{sortKey === c.key && <span className="arrow"> {dir === 1 ? "▲" : "▼"}</span>}
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
                    <div className="stack">
                      {c.permalink
                        ? <a href={c.permalink} target="_blank" rel="noreferrer" style={{ fontWeight: 550, textDecoration: "underline", textUnderlineOffset: 2 }}>{c.title}</a>
                        : <span style={{ fontWeight: 550 }}>{c.title}</span>}
                      <span className="muted" style={{ fontSize: 11 }}>{c.media_type} · {shortDate(c.published_at)}</span>
                    </div>
                  </td>
                  <td className="num tnum">{compact(c.views)}</td>
                  <td className="num tnum">{compact(c.reach)}</td>
                  <td className="num tnum">{compact(c.likes)}</td>
                  <td className="num tnum">{compact(c.comments)}</td>
                  <td className="num tnum">{compact(c.shares)}</td>
                  <td className="num tnum">{compact(c.saves)}</td>
                  <td className="num tnum">{c.avg_watch_seconds != null ? `${c.avg_watch_seconds}s` : "—"}</td>
                  <td className="num tnum">{c.retention_pct != null ? `${c.retention_pct}%` : "—"}</td>
                  <td><PlatformBadge platform={c.platform} /></td>
                </tr>
              ))}
              {sorted.length === 0 && (
                <tr><td colSpan={COLS.length + 3} className="muted" style={{ textAlign: "center", padding: 24 }}>
                  No posts synced for this scope yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
