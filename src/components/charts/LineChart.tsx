import { useMemo, useState } from "react";
import { useElementWidth } from "../../hooks/useElementWidth";
import { compact, full, shortDate } from "../../lib/format";

export interface Series {
  key: string;
  label: string;
  color: string; // css color value
  points: { date: string; value: number }[];
}

interface Props {
  series: Series[];
  height?: number;
  legend?: boolean;
}

/** Multi-series area+line chart with a shared crosshair tooltip. */
export default function LineChart({ series, height = 240, legend = true }: Props) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState<number | null>(null);

  const visible = series.filter((s) => !hidden.has(s.key) && s.points.length > 0);
  // Series can differ in length (e.g. a Page synced before its linked IG account),
  // so the axis follows the longest one and every lookup is bounds-checked.
  const axis = series.reduce<Series | undefined>((a, s) => (!a || s.points.length > a.points.length ? s : a), undefined);
  const axisPoints = axis?.points ?? [];
  const n = axisPoints.length;
  const W = Math.max(width, 240);
  const padL = 44, padR = 12, padT = 10, padB = 24;

  const yMax = useMemo(() => {
    let m = 0;
    for (const s of visible) for (const p of s.points) m = Math.max(m, p.value);
    return m * 1.14 || 1;
  }, [visible, yMax_dep(visible)]);

  if (n === 0) return <div ref={ref} style={{ height }} />;

  const X = (i: number) => padL + (W - padL - padR) * (n < 2 ? 0.5 : i / (n - 1));
  const Y = (v: number) => padT + (height - padT - padB) * (1 - v / yMax);

  const yticks = 4;
  const step = Math.max(1, Math.round(n / 5));

  return (
    <div className="chart" ref={ref}>
      <svg viewBox={`0 0 ${W} ${height}`} height={height} role="img" aria-label="Trend chart"
        onMouseMove={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const mx = ((e.clientX - rect.left) / rect.width) * W;
          let i = Math.round((mx - padL) / ((W - padL - padR) / Math.max(1, n - 1)));
          i = Math.min(n - 1, Math.max(0, i));
          setHover(i);
        }}
        onMouseLeave={() => setHover(null)}
      >
        {/* gridlines + y labels */}
        {Array.from({ length: yticks + 1 }, (_, t) => {
          const v = (yMax * t) / yticks, y = Y(v);
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
          const area = `${line} L${X(end).toFixed(1)} ${Y(0)} L${X(0).toFixed(1)} ${Y(0)} Z`;
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

      {hover !== null && (
        <div className="tooltip" style={{
          left: `${(X(hover) / W) * 100}%`,
          top: `${(Y(Math.max(0, ...visible.map((s) => s.points[hover]?.value ?? 0))) / height) * 100}%`,
          opacity: 1,
        }}>
          <div className="d">{shortDate((axisPoints[hover] ?? axisPoints[axisPoints.length - 1]).date)}</div>
          {visible.map((s) => s.points[hover] && (
            <div className="r" key={s.key}>
              <i style={{ background: s.color }} />{s.label}<b>{full(s.points[hover].value)}</b>
            </div>
          ))}
        </div>
      )}

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
