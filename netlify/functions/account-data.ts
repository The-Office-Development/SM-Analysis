import type { Handler } from "./_lib";
import crypto from "node:crypto";
import { admin, userIdFromToken, json, log, writeFailed, deletionStatus, type WriteError } from "./_lib";

/**
 * Data subject rights, self-service.
 *
 * GET    /api/account-data  -> everything we hold about the caller (portability)
 * DELETE /api/account-data  -> erase it, including the sign-in record
 *
 * Neither existed: "Disconnect" only flipped a status column, there was no
 * export, and there was no way to delete an account at all.
 */
export const handler: Handler = async (event) => {
  const uid = await userIdFromToken(event.headers.authorization);
  if (!uid) return json(401, { message: "Not signed in." });
  const db = admin();

  if (event.httpMethod === "GET") {
    const { data: accounts } = await db.from("social_accounts").select("*").eq("user_id", uid);
    const ids = (accounts ?? []).map((a: any) => a.id);
    const forAccounts = async (table: string) => {
      if (!ids.length) return [];
      const rows: any[] = [];
      for (const id of ids) {
        const { data } = await db.from(table).select("*").eq("account_id", id).limit(5000);
        rows.push(...(data ?? []));
      }
      return rows;
    };
    const [{ data: goals }, { data: shares }, { data: consents }, { data: syncs }] = await Promise.all([
      db.from("goals").select("*").eq("user_id", uid),
      db.from("report_shares").select("slug,created_at").eq("user_id", uid),
      db.from("consents").select("*").eq("user_id", uid),
      db.from("sync_log").select("*").eq("user_id", uid).order("started_at", { ascending: false }).limit(500),
    ]);

    log("account.exported", { uid, accounts: ids.length });
    return {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "content-disposition": `attachment; filename="pulseboard-export-${new Date().toISOString().slice(0, 10)}.json"`,
      },
      // Access tokens are deliberately excluded: they are our credential for
      // calling the platform, not the subject's own data, and exporting them
      // would put a live credential in a downloads folder.
      body: JSON.stringify({
        exported_at: new Date().toISOString(),
        accounts, goals, shares, consents, sync_log: syncs,
        metrics: await forAccounts("metrics_daily"),
        content: await forAccounts("content"),
        audience: await forAccounts("audience_snapshots"),
      }, null, 2),
    };
  }

  if (event.httpMethod === "DELETE") {
    const { data: accounts } = await db.from("social_accounts").select("id").eq("user_id", uid);
    /*
     * Every delete below is checked.
     *
     * The 200 at the end of this branch tells a data subject their data is
     * gone, and issues a confirmation code saying so. supabase-js resolves
     * rather than throws on a PostgREST error, so an RLS change or a constraint
     * could leave every row in place while the response was unchanged — the
     * product asserting an erasure that did not happen.
     */
    let failed = 0;
    const gone = (table: string, res: { error?: WriteError | null }) => {
      if (writeFailed("account.delete_failed", res.error, { uid, table })) failed++;
    };
    for (const a of accounts ?? []) {
      gone("account_secrets", await db.from("account_secrets").delete().eq("account_id", a.id));
      gone("metrics_daily", await db.from("metrics_daily").delete().eq("account_id", a.id));
      gone("content", await db.from("content").delete().eq("account_id", a.id));
      gone("audience_snapshots", await db.from("audience_snapshots").delete().eq("account_id", a.id));
    }
    gone("social_accounts", await db.from("social_accounts").delete().eq("user_id", uid));
    gone("provider_identities", await db.from("provider_identities").delete().eq("user_id", uid));
    gone("report_shares", await db.from("report_shares").delete().eq("user_id", uid));
    gone("goals", await db.from("goals").delete().eq("user_id", uid));
    gone("consents", await db.from("consents").delete().eq("user_id", uid));

    const code = crypto.randomBytes(12).toString("hex");
    const { error: recErr } = await db.from("deletion_requests").insert({
      confirmation_code: code, provider: "self", user_id: null,
      completed_at: new Date().toISOString(),
      accounts_deleted: (accounts ?? []).length,
      // Always `found`: a subject asking us to delete their own account exists by
      // definition, even if they had no connected accounts to remove. 'failed'
      // needs migration 0016; before that the row is refused outright, and the
      // line below is what says so.
      status: deletionStatus(true, failed),
    });
    writeFailed("account.deletion_record_write_failed", recErr, { uid, code, failed });

    if (failed > 0) {
      /*
       * The sign-in record STAYS, and the response says the deletion failed.
       *
       * Deleting the auth user was already ordered last because "without it the
       * rows above are unreachable" — and that is precisely why it must not
       * happen here. Rows we failed to delete, orphaned from the only identity
       * that ties them to a person, become data we hold about someone we can no
       * longer identify, cannot delete on request, and cannot let them sign in
       * to retry. An incomplete erasure is recoverable; an incomplete erasure
       * with the key thrown away is not.
       */
      log("account.delete_incomplete", {
        uid, code, failed_writes: failed,
        detail: "the subject's data was NOT fully erased and the sign-in record was kept so "
          + "they can retry and so the remaining rows stay identifiable. Finish this by hand.",
      });
      return json(500, {
        message: "Something went wrong and your data was not fully deleted. Nothing has been "
          + "left in a half-signed-out state — you can still sign in, and you can try again. "
          + `If it keeps failing, quote ${code} when you contact us.`,
        confirmation_code: code,
      });
    }

    // Remove the sign-in record last: without it the rows above are unreachable.
    try { await (db as any).auth.admin.deleteUser(uid); }
    catch (e) { log("account.auth_delete_failed", { uid, detail: e instanceof Error ? e.message : String(e) }); }

    log("account.deleted", { uid, accounts: (accounts ?? []).length, code });
    return json(200, { message: "Your account and all associated data have been deleted.", confirmation_code: code });
  }

  return json(405, { message: "Method not allowed." });
};
