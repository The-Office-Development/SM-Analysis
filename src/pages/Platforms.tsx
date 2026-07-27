import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import { followersByDay, seriesByDay, sum, latest, stockDelta, engagementRate } from "../lib/api";
import { compact, pctPlain } from "../lib/format";
import PlatformTile from "../components/PlatformTile";
import Delta from "../components/Delta";
import LineChart, { type Series } from "../components/charts/LineChart";
import RequireData from "../components/RequireData";

export default function Platforms() {
  return <RequireData><PlatformsInner /></RequireData>;
}

function PlatformsInner() {
  const dash = useDash();
  const platforms = dash.connectedPlatforms;

  const comparison: Series[] = platforms.map((p) => ({
    key: p, label: PLATFORMS[p].name, color: PLATFORMS[p].color,
    points: seriesByDay(dash.metrics, p, "reach"),
  }));

  return (
    <>
      {/* min() lets the track fall below 300px on a narrow phone instead of
          overflowing the grid container. */}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill,minmax(min(300px,100%),1fr))" }}>
        {platforms.map((p) => {
          const foll = followersByDay(dash.metrics, p);
          const acct = dash.accounts.find((a) => a.platform === p && a.status === "connected");
          const stat = [
            { k: "Followers", v: compact(latest(foll)), delta: stockDelta(foll) },
            { k: "Eng. rate", v: pctPlain(engagementRate(dash.metrics, p)) },
            { k: `Reach ${dash.range}d`, v: compact(sum(seriesByDay(dash.metrics, p, "reach"))) },
            { k: `Views ${dash.range}d`, v: compact(sum(seriesByDay(dash.metrics, p, "views"))) },
          ];
          return (
            <section className="panel" key={p}>
              <div className="panel__head">
                <PlatformTile platform={p} size={26} />
                <div><h3>{PLATFORMS[p].name}</h3><span className="sub">@{acct?.username ?? "account"}</span></div>
              </div>
              <div className="panel__body stack" style={{ gap: 16 }}>
                <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  {stat.map((s) => (
                    <div key={s.k}>
                      <div className="muted" style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".04em" }}>{s.k}</div>
                      <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-.02em", marginTop: 2, display: "flex", alignItems: "center", gap: 8 }}>
                        <span className="tnum">{s.v}</span>{s.delta !== undefined && <Delta value={s.delta} />}
                      </div>
                    </div>
                  ))}
                </div>
                <LineChart series={[{ key: p, label: PLATFORMS[p].name, color: PLATFORMS[p].color, points: foll }]} height={120} legend={false} />
              </div>
            </section>
          );
        })}
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel__head"><h3>Reach comparison</h3><span className="sub">last {dash.range} days</span></div>
        <div className="panel__body"><LineChart series={comparison} height={260} /></div>
      </section>
    </>
  );
}
