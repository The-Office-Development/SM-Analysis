import type { Handler } from "@netlify/functions";
import { admin, json } from "./_lib";

/** GET /api/deletion-status?code=... — backs the public status page. */
export const handler: Handler = async (event) => {
  const code = event.queryStringParameters?.code;
  if (!code) return json(400, { message: "Missing code." });

  const { data } = await admin()
    .from("deletion_requests")
    .select("confirmation_code,requested_at,completed_at,status,accounts_deleted,provider")
    .eq("confirmation_code", code)
    .maybeSingle();

  if (!data) return json(404, { message: "No deletion request with that code." });
  return json(200, data);
};
