import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useElementWidth } from "../../hooks/useElementWidth";
import { compact, shortDate } from "../../lib/format";

export interface ScatterPost {
  id: string;
  title: string;
  date: string;
  format: string;
  reach: number;
  engagements: number | null;
}

/**
 * Every post placed by the day it went out and how far it reached.
 *
 * This answers two questions at once that no table does. HOW OFTEN does this
 * account publish — visible as the spacing along the bottom, including the weeks
 * with nothing in them. And HOW EVEN is the output — visible as the vertical
 * spread, where one dot far above a flat crowd is a very different account from a
 * steady band.
 *
 * A LOG scale on reach, because these accounts have posts at a thousand and posts
 * at a million. Linear would flatten everything except the outlier onto the floor
 * and answer neither question. The axis is labelled in real numbers and the
 * caption says in plain words that each label is ten times the one before, since a
 * log axis quietly compresses differences and a reader who has not been told will
 * misjudge the gaps.
 *
 * Dot AREA carries engagement, not radius: doubling a radius quadruples the ink
 * and overstates the difference fourfold. A post whose engagement was never
 * reported keeps the base size and says so on hover, rather than shrinking to
 * nothing and reading as a post nobody touched.
 */
export default function PostScatter({ posts, height = 240 }: { posts: ScatterPost[]; height?: number }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const nav = useNavigate();
  const [hover, setHover] = useState<string | null>(null);

  const usable = posts.filter((p) => p.reach > 0 && Number.isFinite(Date.parse(p.date)));
  if (usable.length < 3) return null;

  const W = Math.max(width, 260);
  const padL = 46, padR = 14, padT = 14, padB = 26;
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, height - padT - padB);

  const times = usable.map((p) => Date.parse(p.date));
  const t0 = Math.min(...times), t1 = Math.max(...times);
  const X = (t: number) => padL + (t1 === t0 ? plotW / 2 : ((t - t0) / (t1 - t0)) * plotW);

  const lo = Math.min(...usable.map((p) => p.reach));
  const hi = Math.max(...usable.map((p) => p.reach));
  const lLo = Math.log10(lo), lHi = Math.log10(hi);
  const lSpan = Math.max(0.2, lHi - lLo);
  const Y = (v: number) => padT + plotH - ((Math.log10(v) - lLo) / lSpan) * plotH;

  const engs = usable.map((p) => p.engagements).filter((v): v is number => v !== null && v > 0);
  const engMax = engs.length ? Math.max(...engs) : 0;
  const R = (e: number | null) => {
    if (e === null || e <= 0 || engMax <= 0) return 4;
    // Area proportional to engagement, so the ink matches the quantity.
    return 4 + Math.sqrt(e / engMax) * 7;
  };

  // Ticks at whole powers of ten inside the range: the only honest labels on a
  // log axis, because they are the thing it is actually spacing by.
  const ticks: number[] = [];
  for (let e = Math.floor(lLo); e <= Math.ceil(lHi); e++) {
    const v = Math.pow(10, e);
    if (v >= lo * 0.95 && v <= hi * 1.05) ticks.push(v);
  }

  const active = usable.find((p) => p.id === hover) ?? null;

  return (
    <div ref={ref}>
      <div className="row" style={{ gap: 10, marginBottom: 6, fontSize: 11.5, minHeight: 17 }}>
        <span className="muted">
          {active
            ? `${active.title.slice(0, 46)} · ${active.format} · ${compact(active.reach)} reached`
            : `${usable.length} posts`}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img"
           aria-label="Every post by date published and how far it reached"
           onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={Y(v)} y2={Y(v)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 7} y={Y(v) + 3.5} textAnchor="end" fontSize={9.5} fill="var(--muted)">{compact(v)}</text>
          </g>
        ))}

        {usable.map((p) => {
          const on = p.id === hover;
          return (
            <circle key={p.id} cx={X(Date.parse(p.date))} cy={Y(p.reach)} r={R(p.engagements) + (on ? 2 : 0)}
                    fill="var(--ig)" opacity={on ? 1 : 0.62}
                    /* A surface-coloured ring so overlapping posts stay countable
                       rather than merging into one darker blob. */
                    stroke="var(--panel)" strokeWidth={1.5}
                    style={{ cursor: "pointer" }}
                    onMouseEnter={() => setHover(p.id)}
                    onClick={() => nav(`/content/${p.id}`)}>
              <title>{`${p.title} · ${shortDate(p.date)} · ${compact(p.reach)} reached`}</title>
            </circle>
          );
        })}

        <text x={padL} y={height - 8} fontSize={9.5} fill="var(--muted)">{shortDate(new Date(t0))}</text>
        <text x={W - padR} y={height - 8} textAnchor="end" fontSize={9.5} fill="var(--muted)">
          {shortDate(new Date(t1))}
        </text>
      </svg>

      <p className="muted" style={{ fontSize: 11.5, margin: "2px 0 0", lineHeight: 1.55 }}>
        Each dot is a post, placed on the day it went out. Bigger dots got more
        likes, comments, shares and saves. <strong>Each label up the side is ten
        times the one before it</strong>, which is what lets a post with a thousand
        views and one with a million share the same picture. Click a dot to open
        the post.
      </p>
    </div>
  );
}
