import type { Handler } from "@netlify/functions";
import crypto from "node:crypto";
import { admin, userIdFromToken, json, log } from "./_lib";

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
    for (const a of accounts ?? []) {
      await db.from("account_secrets").delete().eq("account_id", a.id);
      await db.from("metrics_daily").delete().eq("account_id", a.id);
      await db.from("content").delete().eq("account_id", a.id);
      await db.from("audience_snapshots").delete().eq("account_id", a.id);
    }
    await db.from("social_accounts").delete().eq("user_id", uid);
    await db.from("provider_identities").delete().eq("user_id", uid);
    await db.from("report_shares").delete().eq("user_id", uid);
    await db.from("goals").delete().eq("user_id", uid);
    await db.from("consents").delete().eq("user_id", uid);

    const code = crypto.randomBytes(12).toString("hex");
    await db.from("deletion_requests").insert({
      confirmation_code: code, provider: "self", user_id: null,
      completed_at: new Date().toISOString(),
      accounts_deleted: (accounts ?? []).length, status: "completed",
    });

    // Remove the sign-in record last: without it the rows above are unreachable.
    try { await (db as any).auth.admin.deleteUser(uid); }
    catch (e) { log("account.auth_delete_failed", { uid, detail: e instanceof Error ? e.message : String(e) }); }

    log("account.deleted", { uid, accounts: (accounts ?? []).length, code });
    return json(200, { message: "Your account and all associated data have been deleted.", confirmation_code: code });
  }

  return json(405, { message: "Method not allowed." });
};
