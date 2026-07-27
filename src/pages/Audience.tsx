import { Fragment } from "react";
import { useDash } from "../context/DashboardContext";
import { followersByDay } from "../lib/api";
import { pctPlain } from "../lib/format";
import type { AudienceSnapshot, Platform } from "../lib/types";
import BarList from "../components/BarList";
import RequireData from "../components/RequireData";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const agePrefix = (k: string) => parseInt(k, 10) || 0;

export default function Audience() {
  return <RequireData><AudienceInner /></RequireData>;
}

function AudienceInner() {
  const dash = useDash();
  const platforms: Platform[] = dash.scope === "all" ? dash.connectedPlatforms : [dash.scope];

  const parts = platforms
    .map((p) => {
      const snap = dash.audience.find((a) => a.platform === p);
      const foll = followersByDay(dash.metrics, p);
      const weight = foll[foll.length - 1]?.value ?? 0;
      return snap ? { snap, weight: weight || 1 } : null;
    })
    .filter((x): x is { snap: AudienceSnapshot; weight: number } => x !== null);

  if (parts.length === 0) {
    return (
      <div className="panel"><div className="panel__body muted" style={{ textAlign: "center", padding: 34 }}>
        No audience snapshot has synced yet for this scope. Audience demographics come from Instagram &amp; Facebook and populate after the next sync (they require the insights permissions).
      </div></div>
    );
  }
  const mergeDist = (pick: (s: AudienceSnapshot) => Record<string, number>) => {
    const acc: Record<string, number> = {};
    for (const { snap, weight } of parts) {
      const dist = pick(snap) ?? {};
      for (const k of Object.keys(dist)) acc[k] = (acc[k] ?? 0) + dist[k] * weight;
    }
    const total = Object.values(acc).reduce((s, v) => s + v, 0) || 1;
    for (const k of Object.keys(acc)) acc[k] /= total;
    return acc;
  };

  const age = mergeDist((s) => s.age);
  const gender = mergeDist((s) => s.gender);
  const countries = mergeDist((s) => s.countries);

  const heat: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const { snap, weight } of parts) {
    if (!snap.active_hours) continue;
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) heat[d][h] += (snap.active_hours[d]?.[h] ?? 0) * weight;
  }
  let hMax = 0;
  for (const row of heat) for (const v of row) hMax = Math.max(hMax, v);
  const hasHeat = hMax > 0;
  hMax = hMax || 1;

  const ageRows = Object.entries(age).sort((a, b) => agePrefix(a[0]) - agePrefix(b[0]))
    .map(([k, v]) => ({ key: k, label: k, value: v, display: pctPlain(v * 100, 0), color: "var(--text)" }));
  const countryRows = Object.entries(countries).sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([k, v]) => ({ key: k, label: k, value: v, display: pctPlain(v * 100, 0), color: "var(--fb)" }));

  const female = gender["female"] ?? 0;
  const male = gender["male"] ?? 0;
  const other = Math.max(0, 1 - female - male);
  const hasGender = female + male + other > 0.001;

  return (
    <div className="dash">
      <section className="panel">
        <div className="panel__head"><h3>Age distribution</h3></div>
        <div className="panel__body">
          {ageRows.length ? <BarList keyWidth={64} rows={ageRows} /> : <Unavailable />}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head"><h3>Gender</h3></div>
        <div className="panel__body stack" style={{ gap: 14 }}>
          {hasGender ? (
            <>
              <div style={{ display: "flex", height: 12, borderRadius: 20, overflow: "hidden", gap: 2 }}>
                <div style={{ width: `${female * 100}%`, background: "var(--ig)" }} />
                <div style={{ width: `${male * 100}%`, background: "var(--fb)" }} />
                {other > 0.001 && <div style={{ width: `${other * 100}%`, background: "var(--muted)" }} />}
              </div>
              <BarList keyWidth={90} rows={[
                { key: "f", label: "Women", value: female, display: pctPlain(female * 100, 0), color: "var(--ig)" },
                { key: "m", label: "Men", value: male, display: pctPlain(male * 100, 0), color: "var(--fb)" },
                ...(other > 0.001 ? [{ key: "o", label: "Other", value: other, display: pctPlain(other * 100, 0), color: "var(--muted)" }] : []),
              ]} />
            </>
          ) : <Unavailable />}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head"><h3>Top locations</h3></div>
        <div className="panel__body">
          {countryRows.length ? <BarList keyWidth={130} rows={countryRows} /> : <Unavailable />}
        </div>
      </section>

      <section className="panel col-3">
        <div className="panel__head"><h3>Best time to post</h3><span className="sub">follower activity by weekday &amp; hour · UTC</span></div>
        <div className="panel__body">
          {hasHeat ? (
            <>
              {/* 25 columns never fit a phone legibly — scroll it rather than
                  shrink the cells into an unreadable smear. */}
              <div className="heat-wrap">
                <div className="heat">
                  <span />
                  {Array.from({ length: 24 }, (_, h) => <span className="hh" key={h}>{h % 3 === 0 ? (h % 12 || 12) : ""}</span>)}
                  {heat.map((row, d) => (
                    <Fragment key={d}>
                      <span className="lbl">{DOW[d]}</span>
                      {row.map((v, h) => (
                        <span className="cell" key={`${d}-${h}`} title={`${DOW[d]} ${(h % 12) || 12}${h < 12 ? "am" : "pm"} · ${((v / hMax) * 100).toFixed(0)}% of peak`}
                          style={{ opacity: 0.12 + (v / hMax) * 0.88 }} />
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
              <div className="heatscale">Less<i style={{ opacity: 0.2 }} /><i style={{ opacity: 0.5 }} /><i style={{ opacity: 0.75 }} /><i style={{ opacity: 1 }} />More</div>
            </>
          ) : <Unavailable label="Activity-by-hour needs the online-followers insight, which appears after a full day of data." />}
        </div>
      </section>
    </div>
  );
}

function Unavailable({ label }: { label?: string }) {
  return <div className="muted" style={{ fontSize: 12.5, padding: "12px 2px" }}>{label ?? "Not available for the connected platform(s) yet."}</div>;
}
