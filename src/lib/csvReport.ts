import { escapeCsvField as esc } from "./csv";
import { sumKnown } from "./format";
import { reachConcentration, reachMultiples } from "./insights";
import type { MetricPoint, ContentItem, Platform, Range, Scope } from "./types";

/**
 * Everything the export needs, and nothing that needs a browser.
 *
 * Split out of reports.ts so this can be tested. reports.ts reaches the DOM to
 * start a download and imports platforms.tsx for its icons, which drags React in
 * and puts the file out of reach of the suite. This is the half that decides
 * what a sponsor reads, so it is the half that has to be testable.
 */
export interface CsvInput {
  range: Range;
  scope: Scope;
  accounts: { username?: string | null; display_name?: string | null }[];
  metrics: MetricPoint[];
  content: ContentItem[];
  /** Display name per platform, injected so this module needs no JSX. */
  platformName: (p: Platform) => string;
}

/* ===========================================================================
 * The CSV export.
 *
 * This file leaves the building. It is what a creator forwards to a sponsor, or
 * opens in front of one, and it is the only part of the product that gets read
 * without the interface around it to explain anything. So it carries its own
 * context: what the figures cover, where they came from, when they were taken,
 * and what each column means.
 *
 * Three rules govern every cell:
 *
 * 1. UNKNOWN IS BLANK. Never 0, and never the string "null" — which is what the
 *    previous version wrote for every unreported metric, producing cells that
 *    break SUM, sort as text, and read as a broken product.
 * 2. Text is escaped through esc(), because captions are attacker-controlled and
 *    a spreadsheet evaluates a leading = + - or @.
 * 3. Numbers are written bare so the spreadsheet parses them as numbers.
 * ======================================================================== */

/** A number for a spreadsheet: blank when the platform never reported it. */
const num = (v: number | null | undefined): string =>
  typeof v === "number" && Number.isFinite(v) ? String(v) : "";

/** A rate as a plain number to a fixed precision, blank when it cannot be formed. */
const rate = (v: number | null | undefined, dp = 2): string =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(dp) : "";

/**
 * The account's own calendar, matching every date in the app.
 *
 * The whole product files days in Amman time; an export that quietly switched to
 * UTC would put evening posts on the wrong date and disagree with the dashboard
 * it came from.
 */
const AMMAN_OFFSET_MIN = 180;
function localStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + AMMAN_OFFSET_MIN * 60_000).toISOString().replace("T", " ").slice(0, 16);
}

/** Build a CSV of the current dashboard scope and window from real synced data. */
export function buildCsv(dash: CsvInput): string {
  const scopeLabel = dash.scope === "all" ? "All platforms" : dash.platformName(dash.scope);
  const inScope = (p: Platform) => dash.scope === "all" || dash.scope === p;
  const metrics = dash.metrics.filter((m) => inScope(m.platform));
  const content = dash.content.filter((c) => inScope(c.platform));

  const rows: string[] = [];
  const line = (...cells: (string | number)[]) => rows.push(cells.join(","));
  const blank = () => rows.push("");
  const section = (t: string) => { blank(); line(esc(t)); };

  /* ---- what this file is ------------------------------------------------ */
  line(esc("PulseBoard export"));
  line(esc("Account"), esc(dash.accounts.map((a) => a.username || a.display_name || "").filter(Boolean).join(" / ") || "—"));
  line(esc("Scope"), esc(scopeLabel));
  line(esc("Window"), esc(`Last ${dash.range} days`));
  line(esc("Generated"), esc(localStamp(new Date().toISOString())));
  line(esc("Times"), esc("Asia/Amman (UTC+3, no daylight saving)"));
  line(esc("Source"), esc("Instagram's official API, read only"));
  // Said here as well as in the interface, because this file is read on its own
  // and the person reading it may be the sponsor, comparing against a screenshot.
  line(esc("Note"), esc(
    "Daily figures come from Instagram's data feed. The Instagram app computes its "
    + "own daily numbers a slightly different way, so a single day can differ. Over a "
    + "month the totals agree closely. Blank means Instagram did not report that "
    + "figure — it does not mean zero."));

  /* ---- the headline ----------------------------------------------------- */
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
  const gained = sumOf("follows"), lost = sumOf("unfollows");
  const nonFollowerReach = sumOf("reach_non_followers");
  const followerReach = sumOf("reach_followers");
  const conc = reachConcentration(content);

  section("SUMMARY");
  line(esc("Metric"), esc("Value"), esc("Notes"));
  const s = (label: string, value: string, note = "") => line(esc(label), value, esc(note));
  s("Followers now", num(followersNow));
  s("Followers at the start of the window", num(followersThen));
  s("Net change", num(followersNow !== null && followersThen !== null ? followersNow - followersThen : null));
  s("Followers gained", num(gained), gained === null ? "Not reported by Instagram" : "");
  s("Followers lost", num(lost), lost === null ? "Not reported by Instagram" : "");
  s("Reach", num(reach), "Distinct accounts reached, summed over the window");
  s("Views", num(views));
  s("Engagements", num(eng), "Likes, comments, shares and saves");
  s("Engagement rate %", rate(eng !== null && reach ? (eng / reach) * 100 : null),
    "Engagements as a share of reach");
  s("Reach from people who already follow", num(followerReach));
  s("Reach from people who do not", num(nonFollowerReach),
    nonFollowerReach === null ? "Not reported by Instagram" : "The share a sponsor is buying");
  s("New-audience share %",
    rate(followerReach !== null && nonFollowerReach !== null && followerReach + nonFollowerReach > 0
      ? (nonFollowerReach / (followerReach + nonFollowerReach)) * 100 : null),
    "Of the reach Instagram could attribute");
  s("Posts published in the window", String(content.filter(
    (c) => c.published_at.slice(0, 10) >= (metrics[0]?.date ?? "")).length));
  s("Posts carrying half of all reach", num(conc.postsForHalf),
    conc.postsForHalf === null ? "" : `Out of ${conc.posts} posts with a reach figure`);
  s("Best post's share of all reach %", rate(conc.topShare !== null ? conc.topShare * 100 : null));

  /* ---- every day, as stored -------------------------------------------- */
  section("DAILY");
  line(esc("Date"), esc("Platform"), esc("Followers"), esc("Reach"), esc("Views"),
       esc("Engagements"), esc("Followers gained"), esc("Followers lost"),
       esc("Reach from followers"), esc("Reach from non-followers"), esc("Still settling"));
  for (const m of [...metrics].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    line(esc(m.date), esc(dash.platformName(m.platform)), num(m.followers), num(m.reach),
         num(m.views), num(m.engagements), num(m.follows), num(m.unfollows),
         num(m.reach_followers), num(m.reach_non_followers),
         esc(m.provisional ? "yes" : ""));
  }

  /* ---- every post, with what the app worked out ------------------------- */
  const multiples = new Map(reachMultiples(content, dash.metrics, dash.scope).map((m) => [m.id, m]));

  section("POSTS");
  line(esc("Post"), esc("Platform"), esc("Type"), esc("Published"), esc("Views"), esc("Reach"),
       esc("Likes"), esc("Comments"), esc("Shares"), esc("Saves"), esc("Engagements"),
       esc("Engagement rate %"), esc("Times over following"), esc("Link"), esc("Figures read"));
  const sorted = [...content].sort((a, b) => (b.views ?? -1) - (a.views ?? -1));
  for (const c of sorted.slice(0, 500)) {
    const engagements = sumKnown(c.likes, c.comments, c.shares, c.saves);
    line(
      esc(c.title || "Untitled"),
      esc(dash.platformName(c.platform)),
      esc(c.media_type),
      esc(localStamp(c.published_at)),
      num(c.views), num(c.reach), num(c.likes), num(c.comments), num(c.shares), num(c.saves),
      num(engagements),
      rate(engagements !== null && c.reach ? (engagements / c.reach) * 100 : null),
      rate(multiples.get(c.id)?.times ?? null, 1),
      esc(c.permalink ?? ""),
      esc(c.checked_at ? localStamp(c.checked_at) : ""),
    );
  }

  /* ---- what the columns mean ------------------------------------------- */
  section("WHAT THESE MEAN");
  line(esc("Term"), esc("Definition"));
  const d = (t: string, meaning: string) => line(esc(t), esc(meaning));
  d("Blank cell", "Instagram did not report that figure. It does not mean zero.");
  d("Reach", "Distinct accounts that saw the post or the account that day.");
  d("Views", "Times a post was played or displayed. One account can view more than once.");
  d("Engagements", "Likes, comments, shares and saves added together.");
  d("Engagement rate", "Engagements divided by reach, as a percentage.");
  d("Times over following", "Reach divided by the follower count on the day it was published. 3.0 means it reached three times as many accounts as the page had followers at the time.");
  d("Reach from non-followers", "People reached who did not already follow the account. This is the part a sponsor is paying for.");
  d("Still settling", "Instagram was still counting that day when it was read, so the figure will rise.");
  d("Figures read", "When these numbers were last taken from Instagram.");

  /*
   * CRLF and a byte-order mark.
   *
   * Excel opens a UTF-8 CSV as the local single-byte codepage unless it finds a
   * BOM, which turns every Arabic caption into mojibake — and the captions on
   * these accounts are mostly Arabic. CRLF is what Excel expects between rows.
   * Both are invisible in a text editor and both are why the file opens properly
   * on the machine of the person being sent it.
   */
  return "﻿" + rows.join("\r\n") + "\r\n";
}
