import { useState } from "react";
import { useElementWidth } from "../../hooks/useElementWidth";
import { compact, full, shortDate, ratioPct } from "../../lib/format";

export interface SplitDay {
  date: string;
  /** null means Instagram did not report the split that day. Not zero. */
  followers: number | null;
  nonFollowers: number | null;
}

/**
 * Where the reach came from, day by day: existing followers against everyone
 * else.
 *
 * The upper band is the number a sponsor is actually buying. Paying to reach an
 * audience that already follows the account is paying for something the creator
 * had anyway, and no native tool draws this line — Instagram reports one reach
 * figure and the split only as a static percentage, so the SHAPE of it over time
 * is invisible.
 *
 * Two categorical series, so colour carries identity: blue and orange, which
 * separate at dE 29.6 under the worst colour-vision deficiency and again in
 * greyscale. Both bands are also directly labelled, so the chart survives being
 * printed in black and white, which is how a media kit usually arrives.
 *
 * Days where the split was not reported BREAK the bands rather than dropping to
 * zero. This account has stretches of exactly that, and a band falling to the
 * floor would read as "we reached nobody new", which is a far worse thing to say
 * than "we do not know".
 */
export default function SplitArea({ days, height = 220 }: { days: SplitDay[]; height?: number }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const known = days.filter((d) => d.followers !== null && d.nonFollowers !== null);
  if (known.length < 2) return null;

  const W = Math.max(width, 260);
  const padL = 46, padR = 10, padT = 12, padB = 22;
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, height - padT - padB);

  const total = (d: SplitDay) =>
    d.followers === null || d.nonFollowers === null ? null : d.followers + d.nonFollowers;
  const yMax = Math.max(1, ...days.map((d) => total(d) ?? 0));

  const X = (i: number) => padL + (days.length === 1 ? plotW / 2 : (plotW * i) / (days.length - 1));
  const Y = (v: number) => padT + plotH - (v / yMax) * plotH;

  /*
   * Runs of consecutive reported days.
   *
   * Each run is its own path. Interpolating across a gap would draw a confident
   * straight line through days nobody measured, which is the chart-shaped version
   * of writing a zero into the database.
   */
  const runs: number[][] = [];
  let run: number[] = [];
  days.forEach((d, i) => {
    if (total(d) === null) { if (run.length) runs.push(run); run = []; }
    else run.push(i);
  });
  if (run.length) runs.push(run);

  const band = (idx: number[], top: (d: SplitDay) => number, bottom: (d: SplitDay) => number) => {
    const up = idx.map((i) => `${X(i)},${Y(top(days[i]))}`);
    const down = [...idx].reverse().map((i) => `${X(i)},${Y(bottom(days[i]))}`);
    return `M${up.join("L")}L${down.join("L")}Z`;
  };

  const sumF = days.reduce((a, d) => a + (d.followers ?? 0), 0);
  const sumN = days.reduce((a, d) => a + (d.nonFollowers ?? 0), 0);
  const active = hover !== null ? days[hover] : null;
  const activeTotal = active ? total(active) : null;

  return (
    <div ref={ref}>
      <div className="row" style={{ gap: 14, flexWrap: "wrap", marginBottom: 6, fontSize: 11.5 }}>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--ig)" }} />
          <span className="text-2">New people</span>
          <b className="tnum">{ratioPct(sumN, sumF + sumN).toFixed(0)}%</b>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--fb)" }} />
          <span className="text-2">Already followed you</span>
          <b className="tnum">{ratioPct(sumF, sumF + sumN).toFixed(0)}%</b>
        </span>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {active && activeTotal !== null
            ? `${shortDate(active.date)} · ${full(active.nonFollowers ?? 0)} new of ${full(activeTotal)}`
            : `${full(sumN)} new people reached`}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img"
           aria-label="Reach split between existing followers and new people"
           onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={padL} x2={W - padR} y1={Y(yMax * f)} y2={Y(yMax * f)} stroke="var(--grid)" strokeWidth={1} />
            <text x={padL - 7} y={Y(yMax * f) + 3.5} textAnchor="end" fontSize={9.5} fill="var(--muted)">
              {compact(Math.round(yMax * f))}
            </text>
          </g>
        ))}

        {runs.map((idx, k) => (
          <g key={k}>
            {/* Followers on the floor, new people stacked above: the band a
                sponsor cares about sits at the top where its thickness reads. */}
            <path d={band(idx, (d) => d.followers ?? 0, () => 0)} fill="var(--fb)" opacity={0.85} />
            <path d={band(idx, (d) => (d.followers ?? 0) + (d.nonFollowers ?? 0), (d) => d.followers ?? 0)}
                  fill="var(--ig)" opacity={0.85} />
            {/* A 2px surface-coloured seam, so the two fills never appear to
                blend into a third colour where they meet. */}
            <path d={`M${idx.map((i) => `${X(i)},${Y(days[i].followers ?? 0)}`).join("L")}`}
                  fill="none" stroke="var(--panel)" strokeWidth={2} />
          </g>
        ))}

        {days.map((d, i) =>
          total(d) === null ? null : (
            <rect key={d.date} x={X(i) - plotW / days.length / 2} y={padT}
                  width={Math.max(2, plotW / days.length)} height={plotH}
                  fill="transparent" onMouseEnter={() => setHover(i)} />
          ))}

        {active && activeTotal !== null && (
          <line x1={X(hover as number)} x2={X(hover as number)} y1={padT} y2={padT + plotH}
                stroke="var(--text-2)" strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" />
        )}

        <text x={padL} y={height - 6} fontSize={9.5} fill="var(--muted)">{shortDate(days[0].date)}</text>
        <text x={W - padR} y={height - 6} textAnchor="end" fontSize={9.5} fill="var(--muted)">
          {shortDate(days[days.length - 1].date)}
        </text>
      </svg>
    </div>
  );
}
