import { S, buildXlsx } from "./xlsx";
import type { Row, Sheet } from "./xlsx";
import { sumKnown } from "./format";
import {
  publishTiming, followerCost, reachMultiples, reachConcentration,
} from "./insights";
import type { CsvInput } from "./csvReport";

/**
 * The export as a real workbook.
 *
 * CSV was the wrong shape for what this file is for. It cannot carry a heading,
 * a column width, a thousands separator or a second sheet, so however much
 * thought goes into the content it arrives looking like a database dump — in
 * front of the sponsor the client is trying to persuade. That is not a cosmetic
 * problem: a document that looks careless invites the figures inside it to be
 * doubted.
 *
 * Five sheets rather than one long column of sections, because a sponsor and an
 * analyst want different pages and neither should have to scroll past the
 * other's. The CSV is kept alongside it for anything that has to be machine-read.
 *
 * Every rule from the CSV survives: an unknown is an EMPTY CELL, never 0 and
 * never text; captions are escaped; the file states its own provenance.
 */

const AMMAN_OFFSET_MIN = 180;
function localStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + AMMAN_OFFSET_MIN * 60_000).toISOString().replace("T", " ").slice(0, 16);
}

/** A number, or an empty cell when the platform never reported it. */
const n = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

/** A rate, or an empty cell when it cannot be formed from a real denominator. */
const ratio = (top: number | null, bottom: number | null | undefined): number | null =>
  top !== null && typeof bottom === "number" && bottom > 0 ? (top / bottom) * 100 : null;

const title = (text: string): Row => [{ v: text, s: S.TITLE }];
const section = (text: string): Row => [{ v: text, s: S.SECTION }];
const header = (...cells: string[]): Row => cells.map((c) => ({ v: c, s: S.HEADER }));
const note = (text: string): Row => [{ v: text, s: S.NOTE }];

export function buildWorkbook(input: CsvInput): Uint8Array {
  const scopeLabel = input.scope === "all" ? "All platforms" : input.platformName(input.scope);
  const inScope = (p: Parameters<typeof input.platformName>[0]) =>
    input.scope === "all" || input.scope === p;
  const metrics = input.metrics.filter((m) => inScope(m.platform));
  const content = input.content.filter((c) => inScope(c.platform));

  const account = input.accounts
    .map((a) => a.username || a.display_name || "").filter(Boolean).join(" / ") || "—";

  const sumOf = (k: "reach" | "views" | "engagements" | "follows" | "unfollows"
                    | "reach_followers" | "reach_non_followers") => {
    let total = 0, seen = false;
    for (const m of metrics) {
      const v = m[k as keyof typeof m] as number | null | undefined;
      if (typeof v === "number") { total += v; seen = true; }
    }
    return seen ? total : null;
  };

  const followerSeries = metrics
    .filter((m) => typeof m.followers === "number")
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const followersNow = followerSeries.at(-1)?.followers ?? null;
  const followersThen = followerSeries[0]?.followers ?? null;

  const reach = sumOf("reach"), views = sumOf("views"), eng = sumOf("engagements");
  const followerReach = sumOf("reach_followers"), nonFollowerReach = sumOf("reach_non_followers");
  const attributed = followerReach !== null && nonFollowerReach !== null
    ? followerReach + nonFollowerReach : null;

  const timing = publishTiming(content);
  const cost = followerCost(input.metrics, content, input.scope);
  const multiples = reachMultiples(content, input.metrics, input.scope);
  const conc = reachConcentration(content);
  const multipleById = new Map(multiples.map((m) => [m.id, m]));

  /* ---- 1. Summary ------------------------------------------------------- */
  const summary: Row[] = [
    title("PulseBoard report"),
    [],
    [{ v: "Account", s: S.BOLD }, account],
    [{ v: "Scope", s: S.BOLD }, scopeLabel],
    [{ v: "Window", s: S.BOLD }, `Last ${input.range} days`],
    [{ v: "Generated", s: S.BOLD }, localStamp(new Date().toISOString())],
    [{ v: "Times", s: S.BOLD }, "Asia/Amman (UTC+3, no daylight saving)"],
    [{ v: "Source", s: S.BOLD }, "Instagram's official API, read only"],
    [],
    // Stated in the file itself, because this page is read without the app
    // around it and often by the sponsor, holding a screenshot for comparison.
    note("Daily figures come from Instagram's data feed. The Instagram app computes its own daily "
      + "numbers a slightly different way, so a single day can differ. Over a month the totals "
      + "agree closely. An empty cell means Instagram did not report that figure. It does not mean zero."),
    [],
    section("Headline"),
    header("Metric", "Value", "Notes"),
    ["Followers now", { v: n(followersNow), s: S.NUMBER }, ""],
    ["Followers at the start", { v: n(followersThen), s: S.NUMBER }, ""],
    ["Net change", {
      v: followersNow !== null && followersThen !== null ? followersNow - followersThen : null,
      s: S.NUMBER,
    }, ""],
    ["Followers gained", { v: n(sumOf("follows")), s: S.NUMBER },
      sumOf("follows") === null ? "Not reported by Instagram" : ""],
    ["Followers lost", { v: n(sumOf("unfollows")), s: S.NUMBER },
      sumOf("unfollows") === null ? "Not reported by Instagram" : ""],
    ["Reach", { v: n(reach), s: S.NUMBER }, "Distinct accounts reached, summed over the window"],
    ["Views", { v: n(views), s: S.NUMBER }, ""],
    ["Engagements", { v: n(eng), s: S.NUMBER }, "Likes, comments, shares and saves"],
    ["Engagement rate", { v: ratio(eng, reach), s: S.PERCENT }, "Engagements as a share of reach"],
    ["Reach from existing followers", { v: n(followerReach), s: S.NUMBER }, ""],
    ["Reach from people who do not follow", { v: n(nonFollowerReach), s: S.NUMBER },
      nonFollowerReach === null ? "Not reported by Instagram" : "The share a sponsor is buying"],
    ["New-audience share", { v: ratio(nonFollowerReach, attributed), s: S.PERCENT },
      "Of the reach Instagram could attribute"],
    ["Posts with a reach figure", { v: conc.posts, s: S.NUMBER }, ""],
  ];

  /* ---- 2. Beyond Instagram --------------------------------------------- */
  const analysis: Row[] = [
    title("Beyond the platform's own figures"),
    [],
    note("None of this appears in the Instagram app. Each one needs history kept over time, "
      + "which is what the app does not do. Where too little has been published to say anything, "
      + "the section says so rather than estimating."),
    [],
    section("When posts actually performed"),
  ];

  if (!timing.enough) {
    analysis.push(note(
      `Only ${timing.measured} posts could be measured. This needs a longer stretch of publishing `
      + "behind it before a pattern means more than luck, and it fills in on its own."));
  } else {
    analysis.push(
      header("Day", "Compared with this account's typical post", "Posts behind it"),
      ...timing.byDay.filter((b) => b.lift !== null).map((b): Row => [
        b.label,
        { v: (b.lift as number), s: S.MULTIPLE },
        { v: b.posts, s: S.NUMBER },
      ]),
      [],
      header("Time of day", "Compared with this account's typical post", "Posts behind it"),
      ...timing.byBlock.filter((b) => b.lift !== null).map((b): Row => [
        b.label,
        { v: (b.lift as number), s: S.MULTIPLE },
        { v: b.posts, s: S.NUMBER },
      ]),
      [],
      note("Instagram shows when your followers are ONLINE. This is when the posts you published "
        + "actually did better or worse than your own normal. Each post is compared with the "
        + "typical post of the same kind, so reels are not compared with photos, and a day needs "
        + "at least three posts before it appears. 1.0x is typical."),
    );
  }

  analysis.push([], section("Days that cost followers"));
  if (!cost.reported) {
    analysis.push(note("Instagram has never reported follower losses for this account, so this "
      + "could not be looked at. It does not mean nobody left."));
  } else if (!cost.days.length) {
    analysis.push(note(`No day in this window stands out. Losses stayed close to the usual `
      + `${cost.typical} a day.`));
  } else {
    analysis.push(
      header("Date", "Lost", "Usual", "Above usual", "Published that day"),
      ...cost.days.map((d): Row => [
        d.date,
        { v: d.unfollows, s: S.NUMBER },
        { v: d.typical, s: S.NUMBER },
        { v: d.excess, s: S.NUMBER },
        d.posts.map((p) => p.title).join(" | "),
      ]),
      [],
      note("These posts went out on those days. That does not mean they caused it. People also "
        + "leave because of a story, a comment, a collaboration or nothing at all, and Instagram "
        + "removes inactive accounts in batches. This narrows the search from a month to a few days."),
    );
  }

  analysis.push([], section("Reach against the following at the time"));
  if (!multiples.length) {
    analysis.push(note("This needs both a reach figure on a post and a known follower count on "
      + "the day it went out. Neither is available yet for this window."));
  } else {
    analysis.push(
      header("Post", "Published", "Reach", "Followers then", "Times over following"),
      ...multiples.slice(0, 15).map((m): Row => [
        m.title, m.date,
        { v: m.reach, s: S.NUMBER },
        { v: m.followers, s: S.NUMBER },
        { v: m.times, s: S.MULTIPLE },
      ]),
      [],
      note("Reach alone says nothing about whether a post spread. Against the following it was "
        + "published to, it does. The divisor is the follower count on that day, not today's, so "
        + "later growth does not quietly demote an older post."),
    );
  }

  analysis.push([], section("How much rests on how little"));
  if (conc.postsForHalf === null) {
    analysis.push(note("No reach figures in this window yet, so there is nothing to divide up."));
  } else {
    analysis.push(
      ["Posts carrying half of all reach", { v: conc.postsForHalf, s: S.NUMBER }],
      ["Out of", { v: conc.posts, s: S.NUMBER }],
      ["Best post's share of all reach", { v: (conc.topShare as number) * 100, s: S.PERCENT }],
      ["Total reach measured", { v: conc.totalReach, s: S.NUMBER }],
      [],
      note("Two accounts with the same monthly reach are different propositions if one earned it "
        + "across twenty posts and the other from one. A month built on a single post looks like a "
        + "collapse the following month through nobody's fault."),
    );
  }

  /* ---- 3. Daily --------------------------------------------------------- */
  const daily: Row[] = [
    header("Date", "Platform", "Followers", "Reach", "Views", "Engagements",
           "Gained", "Lost", "Reach from followers", "Reach from non-followers", "Still settling"),
    ...[...metrics].sort((a, b) => (a.date < b.date ? -1 : 1)).map((m): Row => [
      m.date, input.platformName(m.platform),
      { v: n(m.followers), s: S.NUMBER },
      { v: n(m.reach), s: S.NUMBER },
      { v: n(m.views), s: S.NUMBER },
      { v: n(m.engagements), s: S.NUMBER },
      { v: n(m.follows), s: S.NUMBER },
      { v: n(m.unfollows), s: S.NUMBER },
      { v: n(m.reach_followers), s: S.NUMBER },
      { v: n(m.reach_non_followers), s: S.NUMBER },
      m.provisional ? "yes" : null,
    ]),
  ];

  /* ---- 4. Posts --------------------------------------------------------- */
  const posts: Row[] = [
    header("Post", "Platform", "Type", "Published", "Views", "Reach", "Likes", "Comments",
           "Shares", "Saves", "Engagements", "Engagement rate", "Times over following",
           "Link", "Figures read"),
    ...[...content].sort((a, b) => (b.views ?? -1) - (a.views ?? -1)).slice(0, 500).map((c): Row => {
      const engagements = sumKnown(c.likes, c.comments, c.shares, c.saves);
      return [
        c.title || "Untitled",
        input.platformName(c.platform),
        c.media_type,
        localStamp(c.published_at),
        { v: n(c.views), s: S.NUMBER },
        { v: n(c.reach), s: S.NUMBER },
        { v: n(c.likes), s: S.NUMBER },
        { v: n(c.comments), s: S.NUMBER },
        { v: n(c.shares), s: S.NUMBER },
        { v: n(c.saves), s: S.NUMBER },
        { v: n(engagements), s: S.NUMBER },
        { v: ratio(engagements, c.reach), s: S.PERCENT },
        { v: n(multipleById.get(c.id)?.times ?? null), s: S.MULTIPLE },
        c.permalink ?? null,
        c.checked_at ? localStamp(c.checked_at) : null,
      ];
    }),
  ];

  /* ---- 5. Notes --------------------------------------------------------- */
  const notes: Row[] = [
    title("What these mean"),
    [],
    header("Term", "Definition"),
    ["Empty cell", "Instagram did not report that figure. It does not mean zero."],
    ["Reach", "Distinct accounts that saw the post, or saw the account that day."],
    ["Views", "Times a post was played or displayed. One account can view more than once."],
    ["Engagements", "Likes, comments, shares and saves added together."],
    ["Engagement rate", "Engagements divided by reach."],
    ["Times over following", "Reach divided by the follower count on the day the post went out. 3.0x means it reached three times as many accounts as the page had followers at the time."],
    ["Reach from non-followers", "People reached who did not already follow the account. This is the part a sponsor is paying for."],
    ["Compared with typical", "A post measured against the median post of the same format on this account. 1.0x is typical, 1.4x is forty per cent better."],
    ["Still settling", "Instagram was still counting that day when it was read, so the figure will rise."],
    ["Figures read", "When these numbers were last taken from Instagram."],
    [],
    note("Prepared by PulseBoard from Instagram's official API. Read-only access; no posting, "
      + "messaging or account changes are possible with the permissions this uses."),
  ];

  const sheets: Sheet[] = [
    { name: "Summary", cols: [34, 16, 52], rows: summary, freeze: 1, merges: ["A1:C1"] },
    { name: "Beyond Instagram", cols: [46, 22, 16, 16, 60], rows: analysis, merges: ["A1:E1"] },
    { name: "Daily", cols: [12, 12, 12, 12, 12, 14, 10, 10, 20, 24, 13], rows: daily, freeze: 1 },
    { name: "Posts", cols: [42, 11, 11, 17, 12, 12, 11, 11, 10, 10, 13, 15, 18, 34, 17], rows: posts, freeze: 1 },
    { name: "Notes", cols: [28, 78], rows: notes, merges: ["A1:B1"] },
  ];

  return buildXlsx(sheets);
}
