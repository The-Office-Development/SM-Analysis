/**
 * A Graph API mock whose CORRECT ANSWER IS KNOWN, so tests can assert against an
 * oracle rather than against the absence of a crash.
 *
 * It models the two response shapes the insights reference documents, and the
 * difference between them is the point:
 *
 *   metric_type=time_series  -> per-day values, each carrying an `end_time`
 *   metric_type=total_value  -> ONE aggregate over the requested since/until
 *
 * `end_time` follows Meta's documented convention: the END of the period, i.e.
 * local midnight at the start of the FOLLOWING day, rendered in UTC. The account
 * offset is a parameter, so the same fixture exercises Amman (+3), Los Angeles
 * (-7) and everything between.
 *
 * The total_value branch aggregates by REAL TIME OVERLAP with each local day, as
 * the platform does. A caller that asks for a UTC day on a UTC+3 account gets a
 * blend of two days back — a wrong number rather than an error — which is what
 * makes the day-window tests able to fail.
 */
export const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The oracle: the true value of `metric` on calendar day `iso`. */
export const trueValue = (metric, iso) => {
  const day = Number(iso.slice(8, 10));
  return {
    reach: 1000 + day,
    views: 2000 + day,
    total_interactions: 300 + day,
    // follows_and_unfollows is reported as two directions; the net is what the
    // follower series is rebuilt from.
    follows: 20 + 2 * day,
    unfollows: day,
  }[metric] ?? 0;
};
/** Net follower change on `iso` — follows minus unfollows. */
export const trueNetFollows = (iso) => trueValue("follows", iso) - trueValue("unfollows", iso);

/**
 * Metrics the reference lists as total_value only. Requesting one as a series is
 * an error, exactly as the platform behaves — this is what stops the code
 * quietly going back to asking for a daily series that cannot exist.
 */
const TOTAL_VALUE_ONLY = ["views", "total_interactions", "follows_and_unfollows", "likes", "saves", "shares"];
/** Metrics that are no longer in the reference's metrics table at all. */
const REMOVED = ["follower_count", "online_followers"];

function endTimeFor(dayIso, offsetHours) {
  const t = Date.parse(addDays(dayIso, 1) + "T00:00:00Z") - offsetHours * 3600_000;
  return new Date(t).toISOString().replace(".000Z", "+0000");
}
const localDayStart = (dayIso, offsetHours) =>
  Math.floor(Date.parse(dayIso + "T00:00:00Z") / 1000) - offsetHours * 3600;

/**
 * @param opts.offset      account UTC offset in hours
 * @param opts.days        [startIso, endIso] the mock will report
 * @param opts.failMetric  a metric name that responds with a 429 throttle
 * @param opts.missing     metric names the account does not expose (code 100)
 */
export function installGraphMock(opts) {
  const { offset = 0, days, failMetric = null, missing = [], followers = 12345 } = opts;
  const [from, to] = days;
  const original = globalThis.fetch;
  const calls = [];

  const series = (metric) => {
    const values = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      values.push({ value: trueValue(metric, d), end_time: endTimeFor(d, offset) });
    }
    return { data: [{ name: metric, period: "day", values }] };
  };

  /** Sum a metric across the window, weighted by how much of each local day it covers. */
  const overlapTotal = (metric, since, until) => {
    let total = 0;
    for (let d = addDays(from, -1); d <= addDays(to, 1); d = addDays(d, 1)) {
      const dayStart = localDayStart(d, offset);
      const covered = Math.min(until + 1, dayStart + 86_400) - Math.max(since, dayStart);
      if (covered > 0) total += trueValue(metric, d) * (covered / 86_400);
    }
    return Math.round(total);
  };

  const totalValue = (metric, since, until) => {
    if (metric === "follows_and_unfollows") {
      return { data: [{ name: metric, period: "day", total_value: { breakdowns: [{
        dimension_keys: ["follow_type"],
        results: [
          { dimension_values: ["FOLLOWER"], value: overlapTotal("follows", since, until) },
          { dimension_values: ["UNFOLLOWER"], value: overlapTotal("unfollows", since, until) },
        ],
      }] } }] };
    }
    return { data: [{ name: metric, period: "day", total_value: { value: overlapTotal(metric, since, until) } }] };
  };

  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const q = new URL(u).searchParams;
    const metric = q.get("metric");
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const err = (message, status = 400) =>
      new Response(JSON.stringify({ error: { message, code: 100 } }), { status });

    if (metric && failMetric && metric === failMetric) {
      return new Response(JSON.stringify({ error: { message: "rate limited", code: 4 } }), { status: 429 });
    }
    if (metric && missing.includes(metric)) return err("nonexisting metric");
    if (metric && REMOVED.includes(metric)) return err("(#100) metric is not supported");

    if (u.includes("/insights")) {
      const metricType = q.get("metric_type") ?? "time_series";
      if (TOTAL_VALUE_ONLY.includes(metric) && metricType !== "total_value") {
        return err(`(#100) metric ${metric} must be requested with metric_type=total_value`);
      }
      if (metricType === "total_value") {
        const since = Number(q.get("since")), until = Number(q.get("until"));
        if (!Number.isFinite(since) || !Number.isFinite(until)) return err("(#100) since/until required");
        return ok(totalValue(metric, since, until));
      }
      return ok(series(metric));
    }
    if (u.includes("/media")) return ok({ data: [] });
    return ok({ followers_count: followers, media_count: 10 });
  };

  return { restore: () => { globalThis.fetch = original; }, calls };
}
