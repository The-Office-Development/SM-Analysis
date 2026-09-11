import { useMemo, useRef, useState } from "react";
import { useElementWidth } from "../../hooks/useElementWidth";
import { compact, full, shortDate } from "../../lib/format";

export interface Series {
  key: string;
  label: string;
  color: string; // css color value
  points: { date: string; value: number }[];
}

interface Props {
  /**
   * Where the y-axis starts. "zero" (default) for magnitudes like reach and
   * views. "auto" for a series whose zero is not a real possibility and whose
   * MOVEMENT is the subject — a follower count above all.
   */
  baseline?: "zero" | "auto";
  series: Series[];
  height?: number;
  legend?: boolean;
}

/** Multi-series area+line chart with a shared crosshair tooltip. */
export default function LineChart({ series, height = 240, legend = true, baseline = "zero" }: Props) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);
  /**
   * True while a finger or button is held down, so a drag keeps reading.
   *
   * A REF, not state, and that distinction is load-bearing. React had not
   * committed `setScrubbing(true)` before the first pointermove arrived, so the
   * opening movement of a drag was discarded by the guard below and a quick
   * flick registered nothing at all. A ref updates synchronously, and nothing
   * renders from this value, so state bought nothing and cost the first frame.
   */
  const scrubbing = useRef(false);

  const visible = series.filter((s) => !hidden.has(s.key) && s.points.length > 0);
  // Series can differ in length (e.g. a Page synced before its linked IG account),
  // so the axis follows the longest one and every lookup is bounds-checked.
  const axis = series.reduce<Series | undefined>((a, s) => (!a || s.points.length > a.points.length ? s : a), undefined);
  const axisPoints = axis?.points ?? [];
  const n = axisPoints.length;
  const W = Math.max(width, 240);
  const padL = 44, padR = 12, padT = 10, padB = 24;

  /*
   * Where the y-axis starts.
   *
   * "zero" is right for reach, views and engagement: zero is a meaningful floor
   * and the height of the line carries the magnitude.
   *
   * "auto" is right for a follower count, where zero is not a real possibility
   * and anchoring there hides the only thing anyone is looking at. A 1,080
   * follower account that loses 7 people over a month draws a change of 0.6% of
   * the chart height against a zero baseline — a flat line describing a real
   * decline. That is a wrong number told in pixels.
   *
   * A truncated axis can also mislead in the other direction, by making a small
   * movement look dramatic, so it is not the default and the axis labels always
   * print the true values rather than an offset. The reader can see the floor.
   */
  const { yMin, yMax } = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const s of visible) for (const p of s.points) { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); }
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return { yMin: 0, yMax: 1 };
    if (baseline === "zero") return { yMin: 0, yMax: hi * 1.14 || 1 };

    // Pad by a fraction of the SPREAD, not of the value, so the line is not
    // pinned to the frame. A flat series gets a small symmetric window instead
    // of a zero-height one.
    const spread = hi - lo;
    const pad = spread > 0 ? spread * 0.25 : Math.max(1, Math.abs(hi) * 0.01);
    return { yMin: Math.max(0, lo - pad), yMax: hi + pad };
  }, [visible, baseline, yMax_dep(visible)]);

  if (n === 0) return <div ref={ref} style={{ height }} />;

  const X = (i: number) => padL + (W - padL - padR) * (n < 2 ? 0.5 : i / (n - 1));
  const Y = (v: number) => padT + (height - padT - padB) * (1 - (v - yMin) / Math.max(1e-9, yMax - yMin));

  const yticks = 4;
  const step = Math.max(1, Math.round(n / 5));

  /**
   * Which data point a screen x sits over.
   *
   * Shared by every pointer handler so a mouse and a finger cannot disagree
   * about where they are, and clamped to the series so dragging past either end
   * pins to the first or last day rather than reading undefined.
   */
  const indexAt = (clientX: number, el: SVGSVGElement): number => {
    const rect = el.getBoundingClientRect();
    if (!rect.width) return 0;
    const mx = ((clientX - rect.left) / rect.width) * W;
    const i = Math.round((mx - padL) / ((W - padL - padR) / Math.max(1, n - 1)));
    return Math.min(n - 1, Math.max(0, i));
  };

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${height}`} height={height} role="img" aria-label="Trend chart"
        /*
         * POINTER events, not mouse events.
         *
         * A phone fires no mousemove, so on a touch screen the crosshair could
         * only ever be summoned by a tap that also counted as a click — which
         * meant the chart was, in practice, unreadable on the device most
         * clients open it on. Pointer events cover mouse, touch and stylus in
         * one path, so there is one interaction to reason about rather than two
         * that drift.
         *
         * setPointerCapture is what makes it a SCRUBBER rather than a tap: once
         * a finger is down the element keeps receiving moves even when the
         * finger travels outside the chart, so dragging off the edge and back
         * does not drop the readout.
         */
        style={{
          // Vertical page scrolling still works; horizontal movement is ours.
          // `none` would trap the page whenever a finger landed on the chart,
          // and `auto` would let the browser steal the drag as a scroll.
          touchAction: "pan-y",
          // Stops a long press selecting the SVG or raising the iOS callout.
          userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
        }}
        onPointerDown={(e) => {
          scrubbing.current = true;
          e.currentTarget.setPointerCapture?.(e.pointerId);
          setHover(indexAt(e.clientX, e.currentTarget));
        }}
        onPointerMove={(e) => {
          // A mouse reads on hover; a finger only once it is down. Without this
          // a passing touch would leave a crosshair stranded on the chart.
          if (e.pointerType !== "mouse" && !scrubbing.current) return;
          setHover(indexAt(e.clientX, e.currentTarget));
        }}
        onPointerUp={(e) => {
          scrubbing.current = false;
          e.currentTarget.releasePointerCapture?.(e.pointerId);
          // The readout stays after a finger lifts. On a phone it is the only
          // way to actually read the value you stopped on, and it clears on the
          // next touch elsewhere.
          if (e.pointerType === "mouse") setHover(null);
        }}
        onPointerCancel={() => { scrubbing.current = false; }}
        onPointerLeave={(e) => { if (e.pointerType === "mouse") setHover(null); }}
      >
        {/* gridlines + y labels */}
        {Array.from({ length: yticks + 1 }, (_, t) => {
          const v = yMin + ((yMax - yMin) * t) / yticks, y = Y(v);
          return (
            <g key={t}>
              <line x1={padL} x2={W - padR} y1={y} y2={y} stroke="var(--grid)" strokeWidth={1} />
              <text x={padL - 8} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--muted)">{compact(v)}</text>
            </g>
          );
        })}
        {/* x labels */}
        {axisPoints.map((p, i) =>
          i % step === 0 ? (
            <text key={i} x={X(i)} y={height - 7} textAnchor="middle" fontSize={10} fill="var(--muted)">
              {shortDate(p.date)}
            </text>
          ) : null
        )}
        {/* series */}
        {visible.map((s) => {
          const end = s.points.length - 1;
          const line = s.points.map((p, i) => `${i ? "L" : "M"}${X(i).toFixed(1)} ${Y(p.value).toFixed(1)}`).join(" ");
          // Close the fill on the axis FLOOR, not on zero. With a truncated
          // baseline Y(0) sits below the plot area, so the gradient spilled past
          // the bottom of the chart.
          const floorY = Y(yMin);
          const area = `${line} L${X(end).toFixed(1)} ${floorY} L${X(0).toFixed(1)} ${floorY} Z`;
          const gid = `grad-${s.key}`;
          return (
            <g key={s.key}>
              <defs>
                <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0" stopColor={s.color} stopOpacity={visible.length > 1 ? 0.14 : 0.2} />
                  <stop offset="1" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <path d={area} fill={`url(#${gid})`} />
              <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
              <circle cx={X(end)} cy={Y(s.points[end].value)} r={3} fill={s.color} stroke="var(--panel)" strokeWidth={2} />
            </g>
          );
        })}
        {/* crosshair */}
        {hover !== null && (
          <>
            <line x1={X(hover)} x2={X(hover)} y1={padT} y2={height - padB} stroke="var(--border-strong)" strokeWidth={1} />
            {visible.map((s) => s.points[hover] && (
              <circle key={s.key} cx={X(hover)} cy={Y(s.points[hover].value)} r={3.4} fill={s.color} stroke="var(--panel)" strokeWidth={2} />
            ))}
          </>
        )}
      </svg>

      {hover !== null && (() => {
        /*
         * Keep the readout on screen.
         *
         * The tooltip is centred over the point and floats above it, which is
         * right in the middle of a wide chart and wrong at both ends: on a phone
         * the box is a large fraction of the screen, so a crosshair near either
         * edge pushed half of it outside the panel. Scrubbing to the newest day —
         * the one people actually drag to — put it off the right edge every time.
         *
         * Rather than measure the box, the anchor moves: near the left edge it
         * grows rightwards, near the right edge leftwards, and in between it stays
         * centred. And if the point sits high in the plot the box flips BELOW it,
         * because otherwise it is clipped by the top of the panel.
         */
        const fx = X(hover) / W;
        const anchorX = fx < 0.18 ? "0" : fx > 0.82 ? "-100%" : "-50%";
        const topFrac = Y(Math.max(...visible.map((s) => s.points[hover]?.value ?? yMin))) / height;
        const below = topFrac < 0.28;
        return (
        <div className="tooltip" style={{
          transform: `translate(${anchorX}, ${below ? "12px" : "calc(-100% - 12px)"})`,
          left: `${fx * 100}%`,
          // Position on the HIGHEST value at this index. Math.max(0, ...) assumed a
          // zero floor, which is wrong once the axis can start elsewhere: on a
          // follower chart every value exceeds 0, so the 0 was harmless there, but
          // a series that dips below its own baseline would have pinned the
          // tooltip to the wrong row. Use the series values alone.
          top: `${topFrac * 100}%`,
          opacity: 1,
        }}>
          <div className="d">{shortDate((axisPoints[hover] ?? axisPoints[axisPoints.length - 1]).date)}</div>
          {visible.map((s) => s.points[hover] && (
            <div className="r" key={s.key}>
              <i style={{ background: s.color }} />{s.label}<b>{full(s.points[hover].value)}</b>
            </div>
          ))}
        </div>
        );
      })()}

      {legend && series.length > 1 && (
        <div className="legend" style={{ marginTop: 12 }}>
          {series.map((s) => (
            <button key={s.key} className={hidden.has(s.key) ? "off" : ""}
              onClick={() => {
                setHidden((prev) => {
                  const next = new Set(prev);
                  if (next.has(s.key)) next.delete(s.key);
                  else if (next.size < series.length - 1) next.add(s.key);
                  return next;
                });
              }}>
              <i style={{ background: s.color }} />{s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Stable dependency for the yMax memo (series values change identity on refetch). */
function yMax_dep(series: Series[]): string {
  return series.map((s) => s.key + s.points.length + (s.points[s.points.length - 1]?.value ?? 0)).join("|");
}
