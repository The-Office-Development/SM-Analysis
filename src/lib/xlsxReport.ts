import { S, buildXlsx } from "./xlsx";
import type { Row, Sheet } from "./xlsx";
import { sumKnown } from "./format";
import {
  publishTiming, followerCost, reachMultiples, reachConcentration,
} from "./insights";
import type { CsvInput } from "./csvReport";
import { reportIdentity, footerLine, provenanceNote, ammanStamp, BRAND, accountLabel, reportSource, reportSourcePossessive } from "./reportMeta";

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

const localStamp = ammanStamp;

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
const footer = (text: string): Row => [{ v: text, s: S.FOOTER }];

/**
 * Rough height for a paragraph merged across the sheet.
 *
 * A merged cell gets no autofit from any reader, so an unstated height clips the
 * text to a single line — which is how the provenance note ended up as an
 * unreadable sliver. This over-estimates slightly; whitespace under a paragraph
 * costs nothing, and a truncated sentence about what a blank cell means costs
 * the client an argument with their sponsor.
 */
const paragraphHeight = (text: string, charsPerLine: number): number =>
  Math.max(16, Math.ceil(text.length / Math.max(20, charsPerLine)) * 13 + 6);

/**
 * A sheet, assembled with the parts every sheet must carry.
 *
 * Each one opens with the same identifying band and closes with the same
 * footer, because a reader may be sent one tab, print one tab, or paste one tab
 * into a deck. A page that cannot say whose account it describes, over what
 * window, produced by what, is not a document a sponsor can act on.
 */
function compose(o: {
  name: string; cols: number[]; heading: string; id: ReturnType<typeof reportIdentity>;
  body: Row[]; freeze?: number;
}): Sheet {
  const width = o.cols.length;
  const span = (r: number) => `A${r}:${String.fromCharCode(64 + width)}${r}`;
  const rows: Row[] = [];
  const merges: string[] = [];
  const heights: Record<number, number> = {};

  rows.push(title(o.heading));
  merges.push(span(rows.length));
  heights[rows.length - 1] = 26;

  rows.push([{ v: `${o.id.account} · ${o.id.scopeLabel} · ${o.id.rangeLabel} · generated ${o.id.generated}`, s: S.SUBTLE }]);
  merges.push(span(rows.length));
  rows.push([]);

  const bodyStart = rows.length;
  for (const r of o.body) rows.push(r);

  // Merge and size every band and paragraph in the body, so callers describe
  // content and never geometry.
  o.body.forEach((r, i) => {
    const c = r[0];
    if (c === null || typeof c !== "object" || c.s === undefined) return;
    const rowNumber = bodyStart + i + 1;
    if (c.s === S.SECTION || c.s === S.TITLE) {
      merges.push(span(rowNumber));
      heights[rowNumber - 1] = 22;
    } else if ((c.s === S.NOTE || c.s === S.FOOTER) && r.length === 1) {
      merges.push(span(rowNumber));
      heights[rowNumber - 1] = paragraphHeight(String(c.v ?? ""), o.cols.reduce((a, b) => a + b, 0));
    }
  });

  rows.push([]);
  rows.push(footer(footerLine(o.id)));
  merges.push(span(rows.length));
  heights[rows.length - 1] = 20;

  return {
    name: o.name, cols: o.cols, rows, merges, heights,
    // +2 for the identity band above the caller's own header row.
    freeze: o.freeze ? o.freeze + bodyStart : undefined,
  };
}

export function buildWorkbook(input: CsvInput): Uint8Array {
  const scopeLabel = input.scope === "all" ? "All platforms" : input.platformName(input.scope);
  const inScope = (p: Parameters<typeof input.platformName>[0]) =>
    input.scope === "all" || input.scope === p;
  const metrics = input.metrics.filter((m) => inScope(m.platform));
  const content = input.content.filter((c) => inScope(c.platform));

  const account = accountLabel(input.accounts, input.scope);
  // The platform this workbook is about, for the prose in it. See reportSource.
  const src = reportSource(input.scope, input.platformName);

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

  const id = reportIdentity({ account, scopeLabel, range: input.range,
    source: `${reportSourcePossessive(input.scope, input.platformName)}, read only` });

  /* ---- 1. Summary ------------------------------------------------------- */
  const summary: Row[] = [
    section("About this report"),
    [{ v: "Account", s: S.BOLD }, id.account],
    [{ v: "Scope", s: S.BOLD }, id.scopeLabel],
    [{ v: "Window", s: S.BOLD }, id.rangeLabel],
    [{ v: "Generated", s: S.BOLD }, id.generated],
    [{ v: "Times", s: S.BOLD }, id.timezone],
    [{ v: "Source", s: S.BOLD }, id.source],
    [],
    // Stated in the file itself, because this page is read without the app
    // around it and often by the sponsor, holding a screenshot for comparison.
    note(provenanceNote(input.scope, input.platformName)),
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
      sumOf("follows") === null ? `Not reported by ${src}` : ""],
    ["Followers lost", { v: n(sumOf("unfollows")), s: S.NUMBER },
      sumOf("unfollows") === null ? `Not reported by ${src}` : ""],
    ["Reach", { v: n(reach), s: S.NUMBER }, "Distinct accounts reached, summed over the window"],
    ["Views", { v: n(views), s: S.NUMBER }, ""],
    ["Engagements", { v: n(eng), s: S.NUMBER }, "Likes, comments, shares and saves"],
    ["Engagement rate", { v: ratio(eng, reach), s: S.PERCENT }, "Engagements as a share of reach"],
    ["Reach from existing followers", { v: n(followerReach), s: S.NUMBER }, ""],
    ["Reach from people who do not follow", { v: n(nonFollowerReach), s: S.NUMBER },
      nonFollowerReach === null ? `Not reported by ${src}` : "The share a sponsor is buying"],
    ["New-audience share", { v: ratio(nonFollowerReach, attributed), s: S.PERCENT },
      `Of the reach ${src} could attribute`],
    ["Posts with a reach figure", { v: conc.posts, s: S.NUMBER }, ""],
  ];

  /* ---- 2. Deeper analysis ----------------------------------------------- */
  const analysis: Row[] = [
    note("Each figure below is worked out from this account's history over time rather than "
      + "read straight off a single day. Where too little has been published to say anything, "
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
      note("Measured on results: how the posts you published did against this account's own "
        + "normal, rather than on when the audience is online. Each post is compared with the "
        + "typical post of the same kind, so reels are not compared with photos, and a day needs "
        + "at least three posts before it appears. 1.0x is typical."),
    );
  }

  analysis.push([], section("Days that cost followers"));
  if (!cost.reported) {
    analysis.push(note((input.scope === "linkedin"
      ? "LinkedIn does not report follower losses for a Company Page at all, so this "
      : `${src} has never reported follower losses for this account, so this `)
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
      /*
       * The "story, comment, collaboration" list and the batch-removal of
       * inactive accounts are INSTAGRAM behaviours, not universal ones, so the
       * examples go with the platform rather than being restated about a
       * Company Page where they would simply be wrong.
       */
      note("These posts went out on those days. That does not mean they caused it. People also "
        + (input.scope === "instagram" || input.scope === "all"
          ? "leave because of a story, a comment, a collaboration or nothing at all, and Instagram "
            + "removes inactive accounts in batches. "
          : `leave for reasons nothing here records, and ${src} removes inactive accounts on its own schedule. `)
        + "This narrows the search from a month to a few days."),
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
      note("Reach alone says little about whether a post spread. Measured against the following "
        + "it was published to, it does. The divisor is the follower count on that day, not "
        + "today's, so later growth does not quietly demote an older post."),
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
    header("Term", "Definition"),
    ["Empty cell", `${src} did not report that figure. It does not mean zero.`],
    ["Reach", "Distinct accounts that saw the post, or saw the account that day."],
    ["Views", "Times a post was played or displayed. One account can view more than once."],
    ["Engagements", "Likes, comments, shares and saves added together."],
    ["Engagement rate", "Engagements divided by reach."],
    ["Times over following", "Reach divided by the follower count on the day the post went out. 3.0x means it reached three times as many accounts as the page had followers at the time."],
    ["Reach from non-followers", "People reached who did not already follow the account. This is the part a sponsor is paying for."],
    ["Compared with typical", "A post measured against the median post of the same format on this account. 1.0x is typical, 1.4x is forty per cent better."],
    ["Still settling", `${src} was still counting that day when it was read, so the figure will rise.`],
    ["Figures read", `When these numbers were last taken from ${src}.`],
    [],
    note(`Prepared by PulseBoard from ${reportSourcePossessive(input.scope, input.platformName)}. `
      + "Read-only access; no posting, messaging or account changes are possible with the "
      + "permissions this uses."),
  ];

  const sheets: Sheet[] = [
    compose({ name: "Summary", heading: `${BRAND.product} report`, id,
              cols: [34, 18, 54], body: summary }),
    compose({ name: "Analysis", heading: "Deeper analysis", id,
              cols: [46, 24, 16, 16, 58], body: analysis }),
    compose({ name: "Daily", heading: "Every day, as recorded", id,
              cols: [12, 12, 13, 13, 13, 14, 11, 11, 21, 25, 13], body: daily, freeze: 1 }),
    compose({ name: "Posts", heading: "Every post, with what was worked out from it", id,
              cols: [44, 12, 12, 18, 13, 13, 11, 12, 10, 10, 14, 16, 19, 36, 18],
              body: posts, freeze: 1 }),
    compose({ name: "Notes", heading: "What these mean", id, cols: [30, 76], body: notes }),
  ];

  return buildXlsx(sheets);
}
