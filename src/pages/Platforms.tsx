import { useDash } from "../context/DashboardContext";
import { PLATFORMS } from "../lib/platforms";
import { followersByDay, seriesByDay, sum, latest, stockDelta, engagementRate } from "../lib/api";
import { compact, metric, pctPlain } from "../lib/format";
import { totalReported } from "../lib/insights";
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
            /*
             * metric(), not compact(). A platform that does not report a figure
             * at all yields an empty series, and summing that gives 0 — which
             * this tile showed as "VIEWS 30D · 0" for a LinkedIn page, a number
             * LinkedIn has never once produced.
             */
            { k: `Reach ${dash.range}d`, v: metric(totalReported(seriesByDay(dash.metrics, p, "reach"))) },
            { k: `Views ${dash.range}d`, v: metric(totalReported(seriesByDay(dash.metrics, p, "views"))) },
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
                {/*
                  * baseline="auto", because this is a FOLLOWER COUNT.
                  *
                  * Zero is not a real possibility for a stock like this, and
                  * anchoring there hides the only thing anyone is looking at: an
                  * account at 1.1K losing a handful of people drew a change of a
                  * fraction of one per cent of the chart height — a dead flat
                  * line sitting above a "-0.1%" that plainly says otherwise. The
                  * Overview chart was fixed for exactly this; this one was
                  * missed, because the default is right for flows and wrong for
                  * stocks and the caller has to remember which it has.
                  *
                  * The reach comparison below keeps the zero baseline: reach can
                  * genuinely be zero, and its height is the magnitude.
                  */}
                <LineChart series={[{ key: p, label: PLATFORMS[p].name, color: PLATFORMS[p].color, points: foll }]}
                           height={120} legend={false} baseline="auto" />
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
