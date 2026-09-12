import type { Platform, Scope } from "./types";
/**
 * One identity for every exported report.
 *
 * The PDF, the workbook and the CSV are three renderings of the same document,
 * and the person who matters most reads whichever one the client happened to
 * send. If they disagree about the account, the window, the timezone or who
 * produced them, the client looks disorganised in front of a sponsor.
 *
 * So the header and footer text is computed here once and the three exporters
 * lay it out differently rather than inventing their own wording.
 *
 * The footer is also the only marketing surface this product has. A report goes
 * to people who have never heard of PulseBoard, are looking at evidence of what
 * it does, and have no way to find it again unless the file says so.
 */

export const BRAND = {
  product: "PulseBoard",
  // The DEVELOPMENT arm, not "The Office" alone. This line appears on documents
  // that reach sponsors and other companies, so it names the entity that
  // actually produced the software.
  company: "The Office Development",
  site: "app.theoffice.it.com",
} as const;

/** Asia/Amman. No daylight saving, so a fixed offset is exact rather than lazy. */
export const AMMAN_OFFSET_MIN = 180;
export const TZ_LABEL = "Asia/Amman (UTC+3, no daylight saving)";

/**
 * A timestamp in the account's own calendar.
 *
 * The whole product files days in Amman time. An export that quietly switched to
 * UTC would date evening posts to the previous day and disagree with the
 * dashboard it came from.
 */
export function ammanStamp(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms + AMMAN_OFFSET_MIN * 60_000).toISOString().replace("T", " ").slice(0, 16);
}

export interface ReportIdentity {
  account: string;
  scopeLabel: string;
  rangeLabel: string;
  /** Local time the file was produced, in Amman. */
  generated: string;
  timezone: string;
  source: string;
}

export function reportIdentity(o: {
  account: string; scopeLabel: string; range: number; generatedAt?: string;
  /*
   * Where the figures came from. Optional so a caller that has no scope to hand
   * still produces a valid identity; it defaults to the platform-neutral form
   * rather than to Instagram, which is what it used to be hard-coded to — and
   * which put "Source: Instagram's official API" at the top of a LinkedIn
   * report. A test asserts a scoped export never names another platform, and
   * that test is what found this one.
   */
  source?: string;
}): ReportIdentity {
  return {
    account: o.account || "Not named",
    scopeLabel: o.scopeLabel,
    rangeLabel: `Last ${o.range} days`,
    generated: ammanStamp(o.generatedAt ?? new Date().toISOString()),
    timezone: TZ_LABEL,
    source: o.source ?? "the platform's official API, read only",
  };
}

/**
 * The line at the bottom of every export.
 *
 * Says when it was produced and what produced it. A sponsor holding this has a
 * reason to ask the client what they are using, which is the only distribution
 * this product gets for free.
 */
export function footerLine(id: ReportIdentity): string {
  return `Prepared with ${BRAND.product} by ${BRAND.company} · ${BRAND.site}`
    + ` · Generated ${id.generated} ${TZ_LABEL}`;
}

/**
 * Said in every export, in the file itself.
 *
 * Two things a reader cannot work out alone and will otherwise guess wrongly:
 * that a blank means unreported rather than zero, and that a single day can
 * differ from the Instagram app while the month agrees. A sponsor comparing one
 * day against a screenshot concludes somebody is lying unless this is stated
 * first. See API-VERIFICATION.md 6.8.
 */
export function provenanceNote(scope: Scope, platformName: (p: Platform) => string): string {
  const src = reportSource(scope, platformName);
  /*
   * The "differs from the app" half is an INSTAGRAM claim and stays one.
   *
   * It is the reconciliation finding written down — Instagram's own app computes
   * daily numbers differently, which is the argument this product would
   * otherwise lose in front of a client. Asserting the same of LinkedIn would be
   * inventing a reconciliation nobody has run: nothing LinkedIn has ever been
   * checked against a live response, let alone against its own analytics tab.
   */
  const appCaveat = scope === "instagram" || scope === "all"
    ? "The Instagram app computes its own daily numbers a slightly different way, so a "
      + "single day can differ between the two; over a month the totals agree closely. "
    : "";
  return `Figures come from ${reportSourcePossessive(scope, platformName)}. ${appCaveat}`
    + `Anything left blank was not reported by ${src}, which is not the same as zero.`;
}

/**
 * The account line, with duplicates removed.
 *
 * A tenant's accounts often share a name across platforms, and joining them
 * unfiltered produced "northwind / northwind / northwind" at the top of a report
 * going to a sponsor. Repeating a name three times reads as a bug in the first
 * line somebody sees.
 */
export function accountLabel(
  accounts: { username?: string | null; display_name?: string | null; platform?: string | null }[],
  scope: string = "all",
): string {
  const seen = new Set<string>();
  for (const a of accounts) {
    /*
     * Only the accounts the report is ABOUT.
     *
     * Every caller passed all of them, so a report headed "Scope: LinkedIn" was
     * also headed "northwind.co / northwind / northwind-co" — three handles, two
     * of which the document says nothing about. This line is the report's
     * identity, the thing a sponsor reads to know whose numbers these are, and
     * `reportIdentity` below exists because a report that cannot say whose it is
     * is not usable evidence. Naming accounts it does not cover is the same
     * failure wearing the opposite face.
     */
    if (scope !== "all" && a.platform && a.platform !== scope) continue;
    const name = (a.username || a.display_name || "").trim();
    if (name) seen.add(name);
  }
  return [...seen].join(" / ");
}

/**
 * The platform a report is ABOUT, for prose inside it.
 *
 * The exports were written when Instagram was the only platform that mattered
 * and say "Instagram" in eighteen places — "Not reported by Instagram", "Figures
 * read: when these numbers were last taken from Instagram", and at the foot of
 * every sheet "Prepared by PulseBoard from Instagram's official API". In a
 * workbook scoped to a LinkedIn Company Page every one of those is false, and
 * this is the document that goes to a sponsor.
 *
 * "the platform" for an all-platforms report, because naming four of them in
 * running prose reads worse than not naming any.
 */
export function reportSource(scope: Scope, platformName: (p: Platform) => string): string {
  return scope === "all" ? "the platform" : platformName(scope as Platform);
}

/** The same, possessive, for "...from X's official API". */
export function reportSourcePossessive(scope: Scope, platformName: (p: Platform) => string): string {
  return scope === "all" ? "the platforms' official APIs" : `${platformName(scope as Platform)}'s official API`;
}
