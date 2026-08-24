/**
 * A Graph API mock whose CORRECT ANSWER IS KNOWN, so tests can assert against an
 * oracle rather than against the absence of a crash.
 *
 * `end_time` follows Meta's documented convention: the END of the period, i.e.
 * local midnight at the start of the FOLLOWING day, rendered in UTC. The account
 * offset is a parameter, so the same fixture exercises Amman (+3), Los Angeles
 * (-7) and everything between.
 */
export const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The oracle: the true value of `metric` on calendar day `iso`. */
export const trueValue = (metric, iso) => {
  const day = Number(iso.slice(8, 10));
  return { reach: 1000 + day, views: 2000 + day, follower_count: day, total_interactions: 300 + day }[metric] ?? 0;
};

function endTimeFor(dayIso, offsetHours) {
  const t = Date.parse(addDays(dayIso, 1) + "T00:00:00Z") - offsetHours * 3600_000;
  return new Date(t).toISOString().replace(".000Z", "+0000");
}

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

  globalThis.fetch = async (url) => {
    const u = String(url);
    calls.push(u);
    const metric = new URL(u).searchParams.get("metric");
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

    if (metric && failMetric && metric === failMetric) {
      return new Response(JSON.stringify({ error: { message: "rate limited", code: 4 } }), { status: 429 });
    }
    if (metric && missing.includes(metric)) {
      return new Response(JSON.stringify({ error: { message: "nonexisting metric", code: 100 } }), { status: 400 });
    }
    if (u.includes("/insights")) return ok(series(metric));
    if (u.includes("/media")) return ok({ data: [] });
    return ok({ followers_count: followers, media_count: 10 });
  };

  return { restore: () => { globalThis.fetch = original; }, calls };
}
