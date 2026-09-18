import type { Handler } from "./_lib";
import {
  admin, userIdFromToken, json, decryptToken, log, writeFailed,
  type Db, type WriteError,
} from "./_lib";
import { LI, liGet } from "./_linkedin";

/**
 * Which LinkedIn Page is this connection about?
 *
 * The callback connects the FIRST page the member administers, because choosing
 * needs a UI and a UI needs a round trip the consent screen cannot provide. That
 * is safe for the common case (one page) and silently wrong for the client who
 * runs three: they would read another of their own pages' numbers under the
 * name of the one they meant, with nothing on screen saying so.
 *
 * `available_orgs` was stored at connect time precisely so this could be fixed
 * without a second authorisation. Two methods:
 *
 *   GET  /api/linkedin-page?account_id=…  → { chosen, options: [{urn, name}] }
 *   POST /api/linkedin-page   { account_id, urn }  → switch to that page
 *
 * 🔴 **A switch deletes the stored numbers for this account.** They belong to
 * the page being left. Keeping them would put two pages' history in one series
 * under one name, which is the "never fabricate" rule with extra steps: every
 * total, every trend line and every AI answer would be a blend of two audiences
 * and nothing on screen would admit it. Deleting is the honest option, and the
 * next sync refills a year of reporting anyway.
 */
export const handler: Handler = async (event) => {
  const uid = await userIdFromToken(event.headers.authorization);
  if (!uid) return json(401, { message: "Not signed in." });

  const db = admin();
  const method = event.httpMethod;
  if (method !== "GET" && method !== "POST") return json(405, { message: "Use GET or POST." });

  let body: { account_id?: string; urn?: string } = {};
  if (method === "POST") {
    try { body = JSON.parse(event.body || "{}"); }
    catch { return json(400, { message: "Bad JSON." }); }
  }
  const accountId = method === "GET" ? event.queryStringParameters?.account_id : body.account_id;
  if (!accountId) return json(400, { message: "Missing account_id." });

  const acc = await ownedLinkedInAccount(db, uid, accountId);
  if (!acc) return json(404, { message: "Account not found." });

  const { data: secret } = await db
    .from("account_secrets")
    .select("access_token,extra")
    .eq("account_id", acc.id)
    .maybeSingle();
  const extra = (secret?.extra ?? {}) as LiExtra;
  if (extra.kind !== "li_organization") {
    // A personal profile has no page to choose between.
    return json(400, { message: "This connection is a LinkedIn profile, not a Page." });
  }
  const available = extra.available_orgs ?? [];
  const stored = (secret as { access_token?: string } | null)?.access_token;
  const token = stored ? decryptToken(stored) : null;
  if (!token) return json(409, { message: "This connection needs to be reconnected." });

  if (method === "GET") {
    const names = await pageNames(db, acc.id, token, available, extra);
    return json(200, {
      chosen: extra.urn ?? null,
      options: available.map((urn) => ({ urn, name: names[urn] ?? urn.split(":").pop() })),
    });
  }

  /*
   * Only a page THIS member was found to administer at connect time. Without
   * this the endpoint would take any URN the browser sent and point the account
   * at a page the user may have no role on — the sync would then fail with a
   * 403 rather than leak anything, but the check belongs here, not there.
   */
  const urn = body.urn ?? "";
  if (!available.includes(urn)) return json(400, { message: "That is not a Page you administer." });
  if (urn === extra.urn) return json(200, { message: "That Page is already connected.", switched: false });

  const orgId = urn.split(":").pop() ?? "";
  if (!orgId) return json(400, { message: "That is not a Page you administer." });
  const profile = await liGet<{ localizedName?: string; vanityName?: string }>(
    `${LI.ORGANIZATION}/${orgId}`, {}, { token },
  ).catch(() => ({} as { localizedName?: string; vanityName?: string }));

  /*
   * Delete before repointing. If the delete half fails the account still names
   * the OLD page, which matches the rows that are still there; repointing first
   * and failing to delete would leave the other page's year of history sitting
   * under the new name, which is the outcome this whole endpoint exists to stop.
   */
  const gone = (table: string, res: { error?: WriteError | null }) =>
    writeFailed("linkedin_page.delete_failed", res.error, { uid, account: acc.id, table });
  const failed = [
    gone("metrics_daily", await db.from("metrics_daily").delete().eq("account_id", acc.id)),
    gone("content", await db.from("content").delete().eq("account_id", acc.id)),
    gone("audience_snapshots", await db.from("audience_snapshots").delete().eq("account_id", acc.id)),
  ].some(Boolean);
  if (failed) {
    return json(500, { message: "Could not clear the previous Page's numbers, so nothing was switched. Try again." });
  }

  const { error: secErr } = await db
    .from("account_secrets")
    .update({ extra: { ...extra, urn } })
    .eq("account_id", acc.id);
  if (writeFailed("linkedin_page.secret_write_failed", secErr, { uid, account: acc.id })) {
    return json(500, { message: "Could not switch Page. Try again." });
  }

  const { error: accErr } = await db
    .from("social_accounts")
    .update({
      external_id: orgId,
      username: profile.vanityName ?? profile.localizedName ?? `organization-${orgId}`,
      display_name: profile.localizedName ?? null,
      last_synced_at: null,
    })
    .eq("id", acc.id);
  if (writeFailed("linkedin_page.account_write_failed", accErr, { uid, account: acc.id })) {
    return json(500, { message: "Could not switch Page. Try again." });
  }

  log("linkedin_page.switched", { uid, account: acc.id, to: urn });
  return json(200, {
    message: `Now reading ${profile.localizedName ?? `organization ${orgId}`}. The previous Page's stored numbers were deleted; the next sync fills this one in.`,
    switched: true,
  });
};

interface LiExtra {
  kind?: string;
  urn?: string;
  available_orgs?: string[];
  org_names?: Record<string, string>;
}

/** The account, but only if it is this user's and it is a LinkedIn one. */
async function ownedLinkedInAccount(db: Db, uid: string, accountId: string) {
  const { data: acc } = await db
    .from("social_accounts")
    .select("id,user_id,platform")
    .eq("id", accountId)
    .maybeSingle();
  // Same answer whether it does not exist or belongs to someone else.
  if (!acc || acc.user_id !== uid || acc.platform !== "linkedin") return null;
  return acc as { id: string; user_id: string; platform: string };
}

/**
 * Page names for the picker, read once and remembered.
 *
 * Development tier allows 100 calls per member per day and has no BATCH_GET, so
 * one call per page every time the Connections page rendered would be a real
 * cost for a decorative label. The names are cached in the same `extra` blob;
 * a name is organisation profile data, which LinkedIn's Data Storage
 * Requirements cap at eight weeks, and this cache is rewritten on every connect
 * and deleted with the account.
 */
async function pageNames(
  db: Db, accountId: string, token: string, urns: string[], extra: LiExtra,
): Promise<Record<string, string>> {
  const known = extra.org_names ?? {};
  const missing = urns.filter((u) => !known[u]);
  if (!missing.length) return known;

  const found: Record<string, string> = { ...known };
  for (const urn of missing) {
    const id = urn.split(":").pop();
    if (!id) continue;
    const p = await liGet<{ localizedName?: string }>(`${LI.ORGANIZATION}/${id}`, {}, { token })
      .catch(() => null);
    if (p?.localizedName) found[urn] = p.localizedName;
  }
  const { error } = await db
    .from("account_secrets")
    .update({ extra: { ...extra, org_names: found } })
    .eq("account_id", accountId);
  // A failed cache write is not worth failing the request over: the names are
  // correct, they just cost a call again next time. It is still recorded.
  writeFailed("linkedin_page.name_cache_write_failed", error, { account: accountId });
  return found;
}
