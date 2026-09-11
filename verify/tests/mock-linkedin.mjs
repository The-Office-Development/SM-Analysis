/**
 * A LinkedIn that knows the truth.
 *
 * The same idea as `mock-graph.mjs`, and for the same reason: a test that only
 * checks the sync did not crash will pass while it writes wrong numbers. This
 * mock computes each day's TRUE value from a formula the test can evaluate
 * independently, so an assertion compares the stored figure against an oracle
 * rather than against whatever the code happened to produce.
 *
 * It also reproduces the parts of LinkedIn's shape most likely to be got wrong,
 * because those are the only parts worth mocking:
 *
 *   - `timeRange.start` in milliseconds, with an EXCLUSIVE end. Meta's end_time
 *     is the opposite convention and mixing them files every figure a day out.
 *   - `uniqueImpressionsCount` present on the daily rows and ABSENT from the
 *     per-share rows, which is why a LinkedIn post must store null reach.
 *   - A share with no activity OMITTED from the per-share response, which
 *     LinkedIn documents as meaning zero — the one place in this codebase where
 *     absence legitimately becomes a number.
 *   - A negative likeCount, which LinkedIn documents and which must survive.
 */

const DAY = 86_400_000;

export const addDays = (iso, n) =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/**
 * The true value of a metric on a day. Deterministic and cheap to recompute, so
 * a test can assert against it without duplicating the sync's logic.
 */
export const trueValue = (metric, iso) => {
  const d = Math.floor(Date.parse(`${iso}T00:00:00Z`) / DAY);
  const base = {
    impressionCount: 400,
    uniqueImpressionsCount: 300,
    likeCount: 20,
    commentCount: 5,
    shareCount: 2,
    clickCount: 11,
  }[metric] ?? 0;
  // A per-day wobble, so a bug that pins every day to the same figure is caught.
  return base + (d % 7) * (metric === "impressionCount" ? 13 : 1);
};

/** Engagements as the sync should compute them: likes + comments + shares. */
export const trueEngagements = (iso) =>
  trueValue("likeCount", iso) + trueValue("commentCount", iso) + trueValue("shareCount", iso);

export const ORG_ID = "5515715";
export const ORG_URN = `urn:li:organization:${ORG_ID}`;
export const FOLLOWERS = 8421;

/**
 * Install a fetch that answers like LinkedIn.
 *
 * `opts.days` is [from, to] inclusive. `opts.posts` is how many posts the page
 * has. `opts.silentPosts` is how many of those are omitted from the per-share
 * response, i.e. how many genuinely have zero activity.
 */
export function installLinkedInMock(opts = {}) {
  const [from, to] = opts.days ?? ["2026-08-01", "2026-08-07"];
  const postCount = opts.posts ?? 3;
  const silent = opts.silentPosts ?? 0;
  const calls = [];
  const real = globalThis.fetch;

  const postUrn = (i) => `urn:li:share:70000000000000000${i}`;

  globalThis.fetch = async (url) => {
    const u = new URL(String(url));
    calls.push(u.toString());
    const path = u.pathname.replace("/rest", "");
    const json = (body) => new Response(JSON.stringify(body), {
      status: 200, headers: { "content-type": "application/json" },
    });

    if (path === "/organizationAcls") {
      return json({ elements: [
        { organizationalTarget: ORG_URN, role: "ADMINISTRATOR", state: "APPROVED" },
        // A page the member can post to but NOT report on. The sync must ignore
        // it, because the statistics endpoints answer 403 for this role.
        { organizationalTarget: "urn:li:organization:999", role: "CONTENT_ADMIN", state: "APPROVED" },
      ] });
    }

    if (path.startsWith("/organizations/")) {
      return json({ id: Number(ORG_ID), localizedName: "Drinkat", vanityName: "drinkat" });
    }

    if (path.startsWith("/networkSizes/")) {
      return json({ firstDegreeSize: FOLLOWERS });
    }

    if (path === "/posts") {
      const elements = Array.from({ length: postCount }, (_, i) => ({
        id: postUrn(i),
        commentary: `Post ${i}\n  with a newline and   spaces`,
        publishedAt: Date.parse(`${addDays(from, i)}T09:00:00Z`),
        createdAt: Date.parse(`${addDays(from, i)}T09:00:00Z`),
        content: i === 1 ? { media: { id: "urn:li:video:abc" } } : {},
      }));
      return json({ elements, paging: { start: 0, count: elements.length } });
    }

    if (path === "/organizationalEntityShareStatistics") {
      // Per-share when `shares` is present; otherwise the daily series.
      if (u.searchParams.has("shares")) {
        const elements = [];
        for (let i = 0; i < postCount - silent; i++) {
          elements.push({
            organizationalEntity: ORG_URN,
            share: postUrn(i),
            totalShareStatistics: {
              impressionCount: 1000 + i * 10,
              likeCount: i === 0 ? -3 : 40 + i,   // LinkedIn documents negatives
              commentCount: 6 + i,
              shareCount: 1 + i,
              clickCount: 70 + i,
              // NOTE: no uniqueImpressionsCount. LinkedIn does not return reach
              // per share, and the sync must store null rather than borrow
              // impressions.
            },
          });
        }
        return json({ elements, paging: { start: 0, count: elements.length } });
      }

      /*
       * Honour the window that was ASKED for, not the one the test configured.
       *
       * The mock used to return [from, to] whatever the query said, which made
       * it blind to the defect it most needed to catch: LinkedIn's range end is
       * EXCLUSIVE, so a sync that passes the last wanted day as `end` silently
       * loses that day. A mutation removing the +1 survived against the old mock
       * because nothing downstream could tell the difference. An API that ignores
       * its own parameters is not a model of the API.
       */
      const iv = decodeURIComponent(u.searchParams.get("timeIntervals") ?? "");
      const qStart = Number(/start:(\d+)/.exec(iv)?.[1] ?? NaN);
      const qEnd = Number(/end:(\d+)/.exec(iv)?.[1] ?? NaN);

      const elements = [];
      for (let d = from; d <= to; d = addDays(d, 1)) {
        const t = Date.parse(`${d}T00:00:00Z`);
        // Inclusive of start, exclusive of end — LinkedIn's own convention.
        if (Number.isFinite(qStart) && t < qStart) continue;
        if (Number.isFinite(qEnd) && t >= qEnd) continue;
        elements.push({
          organizationalEntity: ORG_URN,
          timeRange: { start: Date.parse(`${d}T00:00:00Z`), end: Date.parse(`${addDays(d, 1)}T00:00:00Z`) },
          totalShareStatistics: {
            impressionCount: trueValue("impressionCount", d),
            uniqueImpressionsCount: trueValue("uniqueImpressionsCount", d),
            likeCount: trueValue("likeCount", d),
            commentCount: trueValue("commentCount", d),
            shareCount: trueValue("shareCount", d),
            clickCount: trueValue("clickCount", d),
          },
        });
      }
      return json({ elements, paging: { start: 0, count: elements.length } });
    }

    return new Response(JSON.stringify({ message: `unexpected path ${path}` }), { status: 404 });
  };

  return { calls, restore: () => { globalThis.fetch = real; } };
}
