import type { Handler } from "@netlify/functions";
import { schedule } from "@netlify/functions";
import { admin, log } from "./_lib";
import { refreshIdentity, type Identity } from "./_tokens";

/**
 * Renew platform tokens before they lapse.
 *
 * TikTok access tokens live 24 hours, so this must run several times a day; Meta
 * long-lived user tokens live about 60 days. Runs every 4 hours, well inside
 * both windows, and leaves plenty of headroom for a missed invocation.
 */
const TIME_BUDGET_MS = 22_000;

const run: Handler = async () => {
  const startedAt = Date.now();
  const db = admin();
  const { data, error } = await db
    .from("provider_identities")
    .select("id,user_id,provider,external_user_id,access_token,refresh_token,expires_at,refresh_lock_at")
    .not("expires_at", "is", null)
    .order("expires_at", { ascending: true })
    .limit(200);

  if (error) {
    log("token_refresh.query_failed", { detail: error.message });
    return { statusCode: 500, body: error.message };
  }

  let refreshed = 0, failed = 0, skipped = 0, locked = 0;
  for (const id of (data ?? []) as Identity[]) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const r = await refreshIdentity(db, id);
    if (r === "refreshed") refreshed++;
    else if (r === "failed") failed++;
    else if (r === "locked") locked++;
    else skipped++;
  }

  log("token_refresh.finished", { refreshed, failed, skipped, locked, ms: Date.now() - startedAt });
  return { statusCode: failed > 0 && refreshed === 0 ? 500 : 200, body: JSON.stringify({ refreshed, failed, skipped, locked }) };
};

export const handler = schedule("0 */4 * * *", run);
