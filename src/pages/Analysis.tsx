import { Link } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { compact, full, shortDate } from "../lib/format";
import {
  publishTiming, followerCost, reachMultiples, reachConcentration, TIMING_MIN_POSTS,
} from "../lib/insights";
import BarList from "../components/BarList";
import RequireData from "../components/RequireData";
import { IcClock, IcAlert, IcSpark, IcTarget } from "../lib/icons";

/**
 * The four questions Instagram never answers.
 *
 * Everything else in this product re-presents figures the native app also shows,
 * arranged so they answer something. This page computes things the native app
 * does not compute at all, and each one needs history to exist — which is the
 * whole argument for keeping a client's data rather than reading it live.
 *
 * The discipline is the same as everywhere else and matters more here, because
 * an ANALYSIS cannot be checked against a phone. Where the evidence is thin the
 * page says so in the same breath as the finding, and where it is absent the
 * panel says nothing rather than something reassuring.
 */
export default function Analysis() {
  return <RequireData><AnalysisInner /></RequireData>;
}

/** A finding and the evidence under it, so the second is never lost. */
function Panel({ title, sub, Icon, children }: {
  title: string; sub?: string; Icon: typeof IcClock; children: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel__head">
        <Icon style={{ width: 16, height: 16, color: "var(--text-2)" }} />
        <h3>{title}</h3>
        {sub && <span className="sub">{sub}</span>}
      </div>
      <div className="panel__body stack" style={{ gap: 12 }}>{children}</div>
    </section>
  );
}

const Note = ({ children }: { children: React.ReactNode }) => (
  <p className="muted" style={{ margin: 0, fontSize: 11.5, lineHeight: 1.6 }}>{children}</p>
);

function AnalysisInner() {
  const dash = useDash();
  const content = dash.scope === "all"
    ? dash.content
    : dash.content.filter((c) => c.platform === dash.scope);

  const timing = publishTiming(content);
  const cost = followerCost(dash.metrics, content, dash.scope);
  const multiples = reachMultiples(content, dash.metrics, dash.scope);
  const conc = reachConcentration(content);

  // A lift of 1 is "typical for this account", so the readable form is the
  // distance from 1. Rendering 1.42 raw invites it to be read as a percentage.
  const liftText = (l: number) =>
    l >= 1 ? `${Math.round((l - 1) * 100)}% above typical` : `${Math.round((1 - l) * 100)}% below typical`;

  const ranked = timing.byDay.filter((b) => b.lift !== null);
  const rankedBlocks = timing.byBlock.filter((b) => b.lift !== null);

  return (
    <div className="dash">
      {/* ---- when publishing actually worked ---------------------------- */}
      <Panel title="When your posts actually did well" Icon={IcClock}
             sub={`${timing.measured} post${timing.measured === 1 ? "" : "s"} measured`}>
        {!timing.enough ? (
          <Note>
            Not enough posts yet to say anything useful about timing. This needs a
            stretch of publishing behind it before a pattern means more than luck.
            It fills in on its own as posts accumulate.
          </Note>
        ) : (
          <>
            {ranked.length > 0 && (
              <BarList keyWidth={92} rows={ranked.map((b) => ({
                key: b.key, label: b.label, value: Math.max(0, b.lift as number),
                display: `${(b.lift as number).toFixed(2)}x`,
              }))} />
            )}
            {rankedBlocks.length > 0 && (
              <>
                <div style={{ height: 1, background: "var(--border)" }} />
                <BarList keyWidth={150} rows={rankedBlocks.map((b) => ({
                  key: b.key, label: b.label, value: Math.max(0, b.lift as number),
                  display: `${(b.lift as number).toFixed(2)}x`,
                }))} />
              </>
            )}
            {ranked[0] && (
              <p style={{ margin: 0, fontSize: 13 }}>
                <strong>{ranked[0].label}</strong> is your strongest day so far,{" "}
                {liftText(ranked[0].lift as number)}, across {ranked[0].posts} posts.
              </p>
            )}
            <Note>
              This is measured on results: how the posts you actually published
              did against your own normal, rather than on when your audience is
              online. Each post is compared with the typical post of the same kind,
              so reels are not compared with photos. A day or a time slot needs at
              least {TIMING_MIN_POSTS} posts before it appears here at all. It is
              what has happened, not a promise about what will.
            </Note>
          </>
        )}
      </Panel>

      {/* ---- what a post cost ------------------------------------------- */}
      <Panel title="Days that cost you followers" Icon={IcAlert}
             sub={cost.reported && cost.typical !== null ? `usually ${full(cost.typical)} a day` : undefined}>
        {!cost.reported ? (
          <Note>
            Instagram has not reported follower losses for this account, so there
            is nothing to look at here. It is not that nobody left; it is that we
            cannot see it.
          </Note>
        ) : cost.days.length === 0 ? (
          <Note>
            No day in this window stands out. Losses have stayed close to your
            normal of {full(cost.typical as number)} a day.
          </Note>
        ) : (
          <>
            <div className="stack" style={{ gap: 10 }}>
              {cost.days.slice(0, 5).map((d) => (
                <div key={d.date} className="banner" style={{ background: "var(--panel-sunk)" }}>
                  <div className="bt" style={{ minWidth: 0 }}>
                    <b>{shortDate(d.date)} · lost {full(d.unfollows)}</b>
                    <p style={{ margin: "2px 0 0" }}>
                      {full(d.excess)} more than your usual {full(d.typical)}. Published
                      that day:{" "}
                      {d.posts.map((p, i) => (
                        <span key={p.id}>
                          {i > 0 && ", "}
                          <Link to={`/content/${p.id}`}>{p.title}</Link>
                        </span>
                      ))}
                    </p>
                  </div>
                </div>
              ))}
            </div>
            <Note>
              <strong>These posts went out on those days. That does not mean they
              caused it.</strong> People also leave because of a story, a comment,
              a collaboration, or nothing at all, and Instagram removes inactive
              accounts in batches. What this does is narrow the search from a month
              to a handful of days and show you what you published on them.
            </Note>
          </>
        )}
      </Panel>

      {/* ---- reach against the size of the account ---------------------- */}
      <Panel title="Posts that travelled furthest past your following" Icon={IcSpark}
             sub={multiples.length ? `${multiples.length} measured` : undefined}>
        {!multiples.length ? (
          <Note>
            This needs both a reach figure on a post and a known follower count on
            the day it went out. Neither is available yet for this window.
          </Note>
        ) : (
          <>
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Post</th><th className="num">Reach</th><th className="num">Followers then</th><th className="num">Times over</th></tr>
                </thead>
                <tbody>
                  {multiples.slice(0, 6).map((m) => (
                    <tr key={m.id}>
                      <td>
                        <div className="stack">
                          <Link to={`/content/${m.id}`} style={{ fontWeight: 550 }}>{m.title}</Link>
                          <span className="muted" style={{ fontSize: 11 }}>{shortDate(m.date)}</span>
                        </div>
                      </td>
                      <td className="num tnum">{compact(m.reach)}</td>
                      <td className="num tnum">{compact(m.followers)}</td>
                      <td className="num tnum"><strong>{m.times.toFixed(1)}x</strong></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Note>
              Reach on its own says nothing about whether a post spread. Measured
              against the following it was published to, it does. The comparison
              uses your follower count on that day, not today's, so a post is not
              quietly demoted by the growth that came after it.
            </Note>
          </>
        )}
      </Panel>

      {/* ---- concentration ---------------------------------------------- */}
      <Panel title="How much rests on how little" Icon={IcTarget}
             sub={conc.posts ? `${conc.posts} posts with reach` : undefined}>
        {conc.postsForHalf === null ? (
          <Note>No reach figures in this window yet, so there is nothing to divide up.</Note>
        ) : (
          <>
            <div className="kpis" style={{ margin: 0 }}>
              <div className="stack" style={{ gap: 2 }}>
                <span className="muted" style={{ fontSize: 11.5 }}>Posts carrying half your reach</span>
                <span style={{ fontSize: 28, fontWeight: 600 }} className="tnum">{conc.postsForHalf}</span>
                <span className="muted" style={{ fontSize: 11.5 }}>out of {conc.posts}</span>
              </div>
              <div className="stack" style={{ gap: 2 }}>
                <span className="muted" style={{ fontSize: 11.5 }}>Best post's share of everything</span>
                <span style={{ fontSize: 28, fontWeight: 600 }} className="tnum">
                  {Math.round((conc.topShare as number) * 100)}%
                </span>
                <span className="muted" style={{ fontSize: 11.5 }}>of {compact(conc.totalReach)} total reach</span>
              </div>
            </div>
            <Note>
              Two accounts with the same monthly reach are different propositions
              if one earned it across twenty posts and the other from one. A
              sponsor quoted a monthly total is buying the first and often being
              shown the second, and a month built on a single post looks like a
              collapse the following month through nobody's fault. Knowing which
              you are is worth more than the total.
            </Note>
          </>
        )}
      </Panel>
    </div>
  );
}
