import { useState } from "react";
import { useElementWidth } from "../../hooks/useElementWidth";
import { compact, full, shortDate } from "../../lib/format";

export interface FlowDay {
  date: string;
  /** null means the platform did not report it. Not zero. */
  gained: number | null;
  lost: number | null;
}

/**
 * Followers gained and lost, day by day, above and below a zero line.
 *
 * Instagram reports a NET change, and a net hides the business. "+20" and
 * "gained 412, lost 392" are the same number and completely different
 * situations: the second is an account with a retention problem that is buying
 * its growth back every week, and nothing in the native app will ever show it
 * that. Splitting the two directions across a zero line is the whole point, and
 * it is the chart most likely to make a creator sit up.
 *
 * DIVERGING, so colour follows polarity: one hue up, one hue down, nothing in
 * the middle. Green against red sits at the floor of colourblind separation
 * (deuteranopia dE 8.0), which is permitted only where something other than
 * colour also carries the meaning. Here two things do — a bar's SIDE of the zero
 * line, and the labelled axis — so the pair keeps its everyday meaning without
 * resting on it.
 *
 * A day the platform did not report is a GAP. Drawing it as a zero-height bar
 * would say "nobody joined and nobody left", which is a claim, and on this
 * account's history it would be a false one.
 */
export default function FlowBars({ days, height = 210 }: { days: FlowDay[]; height?: number }) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const known = days.filter((d) => d.gained !== null || d.lost !== null);
  if (known.length < 2) return null;

  const W = Math.max(width, 260);
  const padL = 46, padR = 10, padT = 12, padB = 22;
  const plotW = Math.max(1, W - padL - padR);
  const plotH = Math.max(1, height - padT - padB);

  const maxUp = Math.max(1, ...days.map((d) => d.gained ?? 0));
  const maxDown = Math.max(1, ...days.map((d) => d.lost ?? 0));
  // One scale for both directions, so a bar twice as tall means twice as many
  // people whichever way it points. Scaling each side to its own maximum would
  // make a good month and a bad month look identical.
  const span = Math.max(maxUp, maxDown);
  const zeroY = padT + plotH / 2;
  const unit = (plotH / 2) / span;

  const slot = plotW / days.length;
  const barW = Math.max(1.5, Math.min(14, slot * 0.62));
  const X = (i: number) => padL + slot * (i + 0.5);

  const totalGained = days.reduce((a, d) => a + (d.gained ?? 0), 0);
  const totalLost = days.reduce((a, d) => a + (d.lost ?? 0), 0);
  const active = hover !== null ? days[hover] : null;

  const tick = (v: number) => (
    <g key={v}>
      <line x1={padL} x2={W - padR} y1={zeroY - v * unit} y2={zeroY - v * unit}
            stroke="var(--grid)" strokeWidth={1} />
      <text x={padL - 7} y={zeroY - v * unit + 3.5} textAnchor="end" fontSize={9.5} fill="var(--muted)">
        {v === 0 ? "0" : compact(Math.abs(v))}
      </text>
    </g>
  );

  return (
    <div ref={ref}>
      <div className="row" style={{ gap: 14, flexWrap: "wrap", marginBottom: 6, fontSize: 11.5 }}>
        {/* A legend, always, and with the totals beside it so the reader gets the
            headline without decoding the bars first. */}
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--pos)" }} />
          <span className="text-2">Gained</span><b className="tnum">{full(totalGained)}</b>
        </span>
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: 2, background: "var(--neg)" }} />
          <span className="text-2">Lost</span><b className="tnum">{full(totalLost)}</b>
        </span>
        <span className="muted" style={{ marginLeft: "auto" }}>
          {active
            ? `${shortDate(active.date)} · +${active.gained ?? "n/a"} · -${active.lost ?? "n/a"}`
            : `net ${totalGained - totalLost >= 0 ? "+" : ""}${full(totalGained - totalLost)}`}
        </span>
      </div>

      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img"
           aria-label="Followers gained and lost each day"
           onMouseLeave={() => setHover(null)}>
        {[span, span / 2, 0, -span / 2, -span].map(tick)}
        <line x1={padL} x2={W - padR} y1={zeroY} y2={zeroY} stroke="var(--border-strong)" strokeWidth={1} />

        {days.map((d, i) => {
          const x = X(i) - barW / 2;
          const on = hover === i;
          return (
            <g key={d.date}>
              {/* A hit target wider than the bar: at 30 days a bar is a few
                  pixels and nobody can point at it. */}
              <rect x={X(i) - slot / 2} y={padT} width={slot} height={plotH}
                    fill="transparent" onMouseEnter={() => setHover(i)} />
              {d.gained !== null && d.gained > 0 && (
                <rect x={x} y={zeroY - d.gained * unit} width={barW} height={Math.max(1, d.gained * unit)}
                      rx={Math.min(3, barW / 2)} fill="var(--pos)" opacity={on ? 1 : 0.88} pointerEvents="none" />
              )}
              {d.lost !== null && d.lost > 0 && (
                <rect x={x} y={zeroY} width={barW} height={Math.max(1, d.lost * unit)}
                      rx={Math.min(3, barW / 2)} fill="var(--neg)" opacity={on ? 1 : 0.88} pointerEvents="none" />
              )}
            </g>
          );
        })}

        {days.length > 1 && (
          <>
            <text x={padL} y={height - 6} fontSize={9.5} fill="var(--muted)">{shortDate(days[0].date)}</text>
            <text x={W - padR} y={height - 6} textAnchor="end" fontSize={9.5} fill="var(--muted)">
              {shortDate(days[days.length - 1].date)}
            </text>
          </>
        )}
      </svg>
    </div>
  );
}
