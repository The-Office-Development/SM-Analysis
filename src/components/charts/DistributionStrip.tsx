import { useState } from "react";
import { compact } from "../../lib/format";

export interface StripPoint {
  id: string;
  label: string;
  value: number;
}

/**
 * Every post on one axis, with one of them marked.
 *
 * "#1 of 12" is a fact; this is the same fact as a picture, and the picture
 * carries something the rank cannot — the SHAPE. Being top of a tight cluster
 * is a different achievement from being an outlier ten times above everything
 * else, and a creator should be able to tell those apart at a glance.
 *
 * LOG SCALE, deliberately.
 *
 * This account has posts at 1,000 views and one at 4,800,000. On a linear axis
 * every post except the outlier collapses onto the left edge, which is a chart
 * that answers nothing. A log axis spreads them by ORDER OF MAGNITUDE, which is
 * how this kind of distribution is actually shaped.
 *
 * That is not a free choice: a log axis flattens differences and can make a 10x
 * gap look modest. So it is labelled in plain words underneath rather than left
 * for the reader to infer, and the tick labels print real values, never
 * exponents.
 *
 * Zero and negatives cannot be placed on a log axis at all. They are drawn in a
 * separate slot at the left rather than dropped, because a post with zero saves
 * is a fact worth seeing and silently omitting it would misstate the count.
 */
export default function DistributionStrip({
  points, highlightId, height = 74,
}: { points: StripPoint[]; highlightId: string; height?: number }) {
  const [hover, setHover] = useState<string | null>(null);
  if (points.length < 2) return null;

  const positives = points.filter((p) => p.value > 0);
  const zeros = points.filter((p) => p.value <= 0);
  if (!positives.length) return null;

  const lo = Math.min(...positives.map((p) => p.value));
  const hi = Math.max(...positives.map((p) => p.value));
  const logLo = Math.log10(lo), logHi = Math.log10(hi);
  const span = Math.max(1e-9, logHi - logLo);

  // Leave room on the left for the zero slot when anything lands there.
  const padL = zeros.length ? 46 : 14, padR = 14, W = 600;
  const X = (v: number) => padL + (W - padL - padR) * ((Math.log10(v) - logLo) / span);
  const rowY = height - 30;

  // Ticks at whole powers of ten inside the range — the only labels that are
  // honest on a log axis, because they are the thing it is actually spacing by.
  const ticks: number[] = [];
  for (let e = Math.floor(logLo); e <= Math.ceil(logHi); e++) {
    const v = Math.pow(10, e);
    if (v >= lo && v <= hi) ticks.push(v);
  }

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} width="100%" height={height} role="img"
           aria-label="Where this post sits among all posts">
        <line x1={padL} x2={W - padR} y1={rowY} y2={rowY} stroke="var(--border)" strokeWidth={1} />

        {ticks.map((v) => (
          <g key={v}>
            <line x1={X(v)} x2={X(v)} y1={rowY - 4} y2={rowY + 4} stroke="var(--border)" strokeWidth={1} />
            <text x={X(v)} y={rowY + 17} textAnchor="middle" fontSize={9.5} fill="var(--muted)">{compact(v)}</text>
          </g>
        ))}

        {zeros.length > 0 && (
          <g>
            <text x={14} y={rowY + 17} fontSize={9.5} fill="var(--muted)">0</text>
            <line x1={38} x2={38} y1={rowY - 22} y2={rowY + 6} stroke="var(--border)"
                  strokeWidth={1} strokeDasharray="2 3" />
          </g>
        )}

        {[...zeros.map((p) => ({ p, x: 22 })), ...positives.map((p) => ({ p, x: X(p.value) }))]
          .map(({ p, x }) => {
            const isMe = p.id === highlightId;
            return (
              <circle key={p.id} cx={x} cy={rowY - 13} r={isMe ? 6 : 3.5}
                      fill={isMe ? "var(--brand, #4f7cff)" : "var(--text-2)"}
                      opacity={isMe ? 1 : 0.42}
                      stroke={isMe ? "var(--panel)" : "none"} strokeWidth={2}
                      onMouseEnter={() => setHover(p.id)} onMouseLeave={() => setHover(null)}
                      style={{ cursor: "default" }}>
                <title>{`${p.label}: ${compact(p.value)}`}</title>
              </circle>
            );
          })}
      </svg>

      <p className="muted" style={{ fontSize: 11.5, margin: "2px 0 0" }}>
        Each dot is one of your posts. The big one is this post.{" "}
        <strong>Each label along the bottom is ten times the one before it.</strong>{" "}
        That is what lets a post with a thousand views and a post with a million
        views both fit on the same line, so the gaps between dots show how far
        apart posts really are.
        {zeros.length > 0 && ` ${zeros.length} post${zeros.length === 1 ? "" : "s"} had none of this, shown separately on the far left.`}
        {hover && ` · ${points.find((p) => p.id === hover)?.label}`}
      </p>
    </div>
  );
}
