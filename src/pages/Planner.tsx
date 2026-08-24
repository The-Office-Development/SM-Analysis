import { Fragment, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { useToast } from "../context/ToastContext";
import { PLATFORMS } from "../lib/platforms";
import { seriesByDay, followersByDay, sum, latest } from "../lib/api";
import { fetchGoals, createGoal, deleteGoal } from "../lib/api";
import { activeGrid, bestTimes, anomalies, DOW_SHORT, fmtHour, BEST_TIME_NOTE } from "../lib/analytics";
import { compact, ratioPct } from "../lib/format";
import EmptyState from "../components/EmptyState";
import { IcClock, IcTarget, IcAlert, IcSpark, IcPlug, IcCheck, IcUp, IcDown } from "../lib/icons";
import type { Goal, GoalMetric, Platform, Scope } from "../lib/types";

const METRICS: { key: GoalMetric; label: string }[] = [
  { key: "followers", label: "Followers" },
  { key: "reach", label: "Reach" },
  { key: "views", label: "Video views" },
  { key: "engagements", label: "Engagements" },
];

export default function Planner() {
  const dash = useDash();
  const toast = useToast();
  const platforms: Platform[] = dash.scope === "all" ? dash.connectedPlatforms : [dash.scope];

  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalsLoaded, setGoalsLoaded] = useState(false);
  useEffect(() => {
    fetchGoals().then((g) => { setGoals(g); setGoalsLoaded(true); }).catch(() => setGoalsLoaded(true));
  }, []);

  const grid = useMemo(() => activeGrid(dash.audience, platforms), [dash.audience, platforms]);
  const gridMax = Math.max(...grid.flat(), 0);
  const windows = useMemo(() => bestTimes(dash.audience, platforms, 5), [dash.audience, platforms]);
  const alerts = useMemo(() => anomalies(dash.metrics, dash.scope), [dash.metrics, dash.scope]);

  function goalCurrent(g: Goal): number {
    const scope = g.scope as Scope;
    if (g.metric === "followers") return latest(followersByDay(dash.metrics, scope));
    return sum(seriesByDay(dash.metrics, scope, g.metric));
  }

  async function addGoal(metric: GoalMetric, scope: Scope, target: number, due: string) {
    try {
      const g = await createGoal({ metric, scope, target, due_date: due || null });
      setGoals((prev) => [...prev, g]);
      toast("Goal added.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not add goal.");
    }
  }
  async function removeGoal(id: string) {
    setGoals((prev) => prev.filter((g) => g.id !== id));
    try { await deleteGoal(id); } catch { /* re-fetch would resync; ignore */ }
  }

  if (dash.loading) return <div className="panel" style={{ height: 240 }}><div className="panel__body"><div className="sk" style={{ height: 200 }} /></div></div>;
  if (dash.connectedPlatforms.length === 0)
    return <div className="panel"><EmptyState icon={<IcPlug />} title="Connect an account first"
      action={<Link className="btn btn--primary" to="/connections">Go to Connections</Link>}>
      The planner works off your real audience-activity and metrics. Connect a platform to unlock best-time windows, alerts and goals.
    </EmptyState></div>;

  return (
    <div className="dash">
      {/* -------- best time to post -------- */}
      <section className="panel col-2">
        <div className="panel__head"><IcClock style={{ width: 16, height: 16, color: "var(--text-2)" }} /><h3>Best time to post</h3><span className="sub" title={BEST_TIME_NOTE}>when your audience is online · platform timezone</span></div>
        <div className="panel__body">
          {gridMax > 0 ? (
            <>
              {/* 25 columns never fit a phone legibly — scroll it rather than
                  shrink the cells into an unreadable smear. */}
              <div className="heat-wrap">
                <div className="heat">
                  <div />
                  {Array.from({ length: 24 }).map((_, h) => <div key={h} className="hh">{h % 6 === 0 ? fmtHour(h) : ""}</div>)}
                  {DOW_SHORT.map((d, di) => (
                    <Fragment key={d}>
                      <div className="lbl">{d}</div>
                      {grid[di].map((v, hi) => (
                        <div key={hi} className="cell" title={`${d} ${fmtHour(hi)}`}
                          style={{ opacity: gridMax ? Math.max(0.05, v / gridMax) : 0.05 }} />
                      ))}
                    </Fragment>
                  ))}
                </div>
              </div>
              <div className="heatscale"><span>Quieter</span><i style={{ opacity: .15 }} /><i style={{ opacity: .45 }} /><i style={{ opacity: .8 }} /><i /><span>Peak</span></div>
            </>
          ) : (
            <p className="muted" style={{ fontSize: 13 }}>No audience-activity data yet. Instagram &amp; Facebook expose this after a sync; TikTok's basic API does not.</p>
          )}
        </div>
      </section>

      <section className="panel">
        <div className="panel__head"><IcSpark style={{ width: 16, height: 16, color: "var(--text-2)" }} /><h3>Top windows</h3></div>
        <div className="panel__body stack" style={{ gap: 12 }}>
          {windows.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Sync IG or FB to see your peak posting windows.</p>}
          {windows.map((w, i) => (
            <div key={i} className="stack" style={{ gap: 5 }}>
              <div className="row" style={{ justifyContent: "space-between", fontSize: 13, fontWeight: 550 }}>
                <span>{i === 0 && <IcTarget style={{ width: 13, height: 13, color: "var(--pos)", marginRight: 6, verticalAlign: "-2px" }} />}{w.label}</span>
                <span className="muted tnum">{Math.round(w.score * 100)}</span>
              </div>
              <div style={{ height: 7, borderRadius: 20, background: "var(--panel-sunk)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${w.score * 100}%`, background: i === 0 ? "var(--pos)" : "var(--tt)", borderRadius: 20 }} />
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* -------- alerts -------- */}
      <section className="panel col-3">
        <div className="panel__head"><IcAlert style={{ width: 16, height: 16, color: "var(--warn)" }} /><h3>Alerts</h3><span className="sub">unusual moves in the last {dash.range} days</span></div>
        <div className="panel__body stack" style={{ gap: 10 }}>
          {alerts.length === 0 && <p className="muted" style={{ fontSize: 13 }}>Nothing unusual — your metrics are moving within their normal range. ✓</p>}
          {alerts.map((a, i) => (
            <div key={i} className="banner" style={{ borderColor: a.kind === "drop" ? "var(--neg-weak)" : "var(--pos-weak)" }}>
              {a.kind === "drop" ? <IcDown style={{ color: "var(--neg)" }} /> : <IcUp style={{ color: "var(--pos)" }} />}
              <div className="bt">
                <b>{a.label} {a.kind === "drop" ? "dropped" : "spiked"} {Math.abs(a.deltaPct).toFixed(0)}%</b>
                <p>{a.date} · {compact(a.value)} vs a typical {compact(a.expected)}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* -------- goals -------- */}
      <section className="panel col-3">
        <div className="panel__head"><IcTarget style={{ width: 16, height: 16, color: "var(--text-2)" }} /><h3>Goals</h3><span className="spacer" /></div>
        <div className="panel__body stack" style={{ gap: 14 }}>
          {goalsLoaded && goals.length === 0 && <p className="muted" style={{ fontSize: 13 }}>No goals yet. Set a target below and track your progress toward it.</p>}
          {goals.map((g) => {
            const cur = goalCurrent(g);
            const pct = Math.min(100, ratioPct(cur, g.target));
            const done = cur >= g.target;
            const scopeLabel = g.scope === "all" ? "All platforms" : PLATFORMS[g.scope as Platform].name;
            const mLabel = METRICS.find((m) => m.key === g.metric)?.label ?? g.metric;
            return (
              <div key={g.id} className="stack" style={{ gap: 6 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>
                    {done && <IcCheck style={{ width: 14, height: 14, color: "var(--pos)", marginRight: 6, verticalAlign: "-2px" }} />}
                    {mLabel} · {scopeLabel}
                  </span>
                  <span className="row" style={{ gap: 10 }}>
                    <span className="tnum" style={{ fontSize: 13, fontWeight: 600 }}>{compact(cur)} / {compact(g.target)}</span>
                    <button className="iconbtn" style={{ width: 26, height: 26 }} title="Remove goal" onClick={() => removeGoal(g.id)}>×</button>
                  </span>
                </div>
                <div style={{ height: 9, borderRadius: 20, background: "var(--panel-sunk)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: done ? "var(--pos)" : "var(--ink)", borderRadius: 20, transition: "width .5s" }} />
                </div>
                <span className="muted" style={{ fontSize: 11 }}>{pct.toFixed(0)}% of target{g.due_date ? ` · by ${g.due_date}` : ""}{done ? " · reached 🎉" : ""}</span>
              </div>
            );
          })}
          <GoalForm platforms={dash.connectedPlatforms} onAdd={addGoal} />
        </div>
      </section>
    </div>
  );
}

function GoalForm({ platforms, onAdd }: { platforms: Platform[]; onAdd: (m: GoalMetric, s: Scope, t: number, d: string) => void }) {
  const [metric, setMetric] = useState<GoalMetric>("followers");
  const [scope, setScope] = useState<Scope>("all");
  const [target, setTarget] = useState("");
  const [due, setDue] = useState("");
  const n = Number(target);
  return (
    <form className="goalform" onSubmit={(e) => { e.preventDefault(); if (n > 0) { onAdd(metric, scope, Math.round(n), due); setTarget(""); setDue(""); } }}>
      <select className="input" value={metric} onChange={(e) => setMetric(e.target.value as GoalMetric)} aria-label="Metric">
        {METRICS.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
      </select>
      <select className="input" value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="Scope">
        <option value="all">All platforms</option>
        {platforms.map((p) => <option key={p} value={p}>{PLATFORMS[p].name}</option>)}
      </select>
      <input className="input" type="number" min={1} placeholder="Target" value={target} onChange={(e) => setTarget(e.target.value)} aria-label="Target value" />
      <input className="input" type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="Due date (optional)" />
      <button className="btn btn--primary" type="submit" disabled={!(n > 0)}>Add goal</button>
    </form>
  );
}
