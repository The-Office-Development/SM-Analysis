import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

/* ---------------------------------------------------------------------------
 * Shared helpers for PulseBoard serverless functions.
 * Files prefixed with "_" are treated as libraries, not endpoints, by Netlify.
 * ------------------------------------------------------------------------- */

export const env = {
  SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
  SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  SITE_URL: process.env.VITE_SITE_URL ?? process.env.URL ?? "",
  META_APP_ID: process.env.META_APP_ID ?? "",
  META_APP_SECRET: process.env.META_APP_SECRET ?? "",
  TIKTOK_CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY ?? "",
  TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET ?? "",
  STATE_SECRET: process.env.OAUTH_STATE_SECRET ?? "dev-insecure-secret",
};

/** A Supabase client typed to accept any schema (we use `pulseboard`). */
export type Db = SupabaseClient<any, any, any>;

/** Service-role Supabase client — bypasses RLS. NEVER expose to the browser. */
export function admin(): Db {
  if (!env.SUPABASE_URL || !env.SERVICE_ROLE) {
    throw new Error("Supabase service credentials are not configured.");
  }
  return createClient(env.SUPABASE_URL, env.SERVICE_ROLE, {
    db: { schema: "pulseboard" }, // PulseBoard tables live in their own schema
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Validates a user's Supabase access token and returns their user id. */
export async function userIdFromToken(token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const clean = token.replace(/^Bearer\s+/i, "");
  const { data, error } = await admin().auth.getUser(clean);
  if (error || !data.user) return null;
  return data.user.id;
}

/* ---- signed OAuth state (prevents CSRF + carries the user id) ------------ */
export function signState(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", env.STATE_SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyState(state: string | undefined): Record<string, string> | null {
  if (!state || !state.includes(".")) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", env.STATE_SECRET).update(body).digest("base64url");
  // `sig` is caller-controlled and timingSafeEqual throws on a length mismatch, so
  // compare lengths first — otherwise a malformed state crashes the OAuth callback.
  const got = Buffer.from(sig), want = Buffer.from(expect);
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (Date.now() - Number(data.t) > 15 * 60 * 1000) return null; // 15 min TTL
    return data;
  } catch {
    return null; // body was not valid base64url JSON
  }
}

export function redirect(location: string) {
  return { statusCode: 302, headers: { Location: location }, body: "" };
}
export function json(statusCode: number, obj: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) };
}

/** Redirect back to the Connections screen with a result flag. */
export function backToApp(result: string, value: string) {
  const base = env.SITE_URL || "";
  return redirect(`${base}/connections?${result}=${encodeURIComponent(value)}`);
}

/** Upsert a connected account and stash its secret token (service-role only). */
export async function saveAccount(
  db: Db,
  userId: string,
  a: { platform: string; external_id: string; username: string; display_name?: string | null; avatar_url?: string | null },
  secret: { access_token: string; refresh_token?: string | null; expires_at?: string | null; extra?: Record<string, unknown> }
) {
  const { data: acc, error } = await db
    .from("social_accounts")
    .upsert(
      {
        user_id: userId,
        platform: a.platform,
        external_id: a.external_id,
        username: a.username,
        display_name: a.display_name ?? null,
        avatar_url: a.avatar_url ?? null,
        status: "connected",
      },
      { onConflict: "user_id,platform,external_id" }
    )
    .select("id")
    .single();
  if (error) throw error;

  const { error: sErr } = await db.from("account_secrets").upsert(
    {
      account_id: acc.id,
      access_token: secret.access_token,
      refresh_token: secret.refresh_token ?? null,
      expires_at: secret.expires_at ?? null,
      extra: secret.extra ?? {},
    },
    { onConflict: "account_id" }
  );
  if (sErr) throw sErr;
  return acc.id as string;
}
