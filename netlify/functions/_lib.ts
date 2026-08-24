import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

/* ---------------------------------------------------------------------------
 * Shared helpers for PulseBoard serverless functions.
 * Files prefixed with "_" are treated as libraries, not endpoints, by Netlify.
 * ------------------------------------------------------------------------- */

/** Graph API version. Pinned in ONE place — v19.0 expired 21 May 2026. */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION ?? "v25.0";
export const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export const env = {
  SUPABASE_URL: process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "",
  SERVICE_ROLE: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
  SITE_URL: process.env.VITE_SITE_URL ?? process.env.URL ?? "",
  META_APP_ID: process.env.META_APP_ID ?? "",
  META_APP_SECRET: process.env.META_APP_SECRET ?? "",
  TIKTOK_CLIENT_KEY: process.env.TIKTOK_CLIENT_KEY ?? "",
  TIKTOK_CLIENT_SECRET: process.env.TIKTOK_CLIENT_SECRET ?? "",
};

/** Secrets that must never silently fall back to a default. */
function requireSecret(name: string): string {
  const v = process.env[name] ?? "";
  if (!v) throw new Error(`${name} is not configured — refusing to proceed.`);
  return v;
}

/* ------------------------------- logging --------------------------------- */
/** Structured log line. Netlify captures stdout, so a failed run leaves a trace. */
export function log(event: string, fields: Record<string, unknown> = {}) {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) {
    // Never log token material, even by accident.
    safe[k] = /token|secret|proof|authorization/i.test(k) ? "[redacted]" : v;
  }
  console.log(JSON.stringify({ t: new Date().toISOString(), event, ...safe }));
}

/* --------------------------- token encryption ---------------------------- */
const ENC_PREFIX = "v1:";

function encKey(): Buffer {
  const buf = Buffer.from(requireSecret("TOKEN_ENC_KEY"), "base64");
  if (buf.length !== 32) throw new Error("TOKEN_ENC_KEY must decode to 32 bytes (base64 of 32 random bytes).");
  return buf;
}

/** AES-256-GCM. A leaked database snapshot is then not a set of live credentials. */
export function encryptToken(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey(), iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ENC_PREFIX + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}

/** Decrypts a stored token. Values written before encryption are returned as-is. */
export function decryptToken(stored: string): string {
  if (!stored.startsWith(ENC_PREFIX)) return stored; // legacy plaintext row
  const raw = Buffer.from(stored.slice(ENC_PREFIX.length), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  return d.update(raw.subarray(28)).toString("utf8") + d.final("utf8");
}

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

/* ---- signed OAuth state (prevents CSRF + carries the user id) ------------
 * The state is signed AND bound to a nonce echoed in an HttpOnly cookie. Without
 * that binding a signed state can be lifted from the attacker's own URL and
 * replayed against a victim, attaching the victim's accounts to the attacker's
 * tenant. The signature alone does not prevent this.
 * ------------------------------------------------------------------------- */
export const STATE_COOKIE = "pb_oauth";
const STATE_TTL_MS = 5 * 60 * 1000;

export function newNonce(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function signState(payload: Record<string, string>): string {
  const body = Buffer.from(JSON.stringify({ ...payload, t: Date.now() })).toString("base64url");
  const sig = crypto.createHmac("sha256", requireSecret("OAUTH_STATE_SECRET")).update(body).digest("base64url");
  return `${body}.${sig}`;
}

/** Constant-time compare of two caller-influenced strings. */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Verifies signature, TTL, and the cookie binding. `cookieNonce` comes from the
 * request's own Cookie header, so a state replayed into someone else's browser
 * fails here even though its signature is valid.
 */
export function verifyState(state: string | undefined, cookieNonce: string | undefined): Record<string, string> | null {
  if (!state || !state.includes(".")) return null;
  const [body, sig] = state.split(".");
  if (!body || !sig) return null;
  const expect = crypto.createHmac("sha256", requireSecret("OAUTH_STATE_SECRET")).update(body).digest("base64url");
  if (!safeEqual(sig, expect)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (Date.now() - Number(data.t) > STATE_TTL_MS) return null;
    if (!data.n || !cookieNonce || !safeEqual(String(data.n), cookieNonce)) return null;
    return data;
  } catch {
    return null; // body was not valid base64url JSON
  }
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export function setNonceCookie(nonce: string): string {
  return `${STATE_COOKIE}=${nonce}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=300`;
}
export function clearNonceCookie(): string {
  return `${STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

/* ------------------------------ Graph calls ------------------------------- */

/** Meta's app-secret proof. Required once "Require App Secret" is enabled. */
export function appsecretProof(token: string): { appsecret_proof: string; appsecret_time: string } {
  const time = Math.floor(Date.now() / 1000).toString();
  const proof = crypto.createHmac("sha256", env.META_APP_SECRET).update(token + "|" + time).digest("hex");
  return { appsecret_proof: proof, appsecret_time: time };
}

export class GraphError extends Error {
  code?: number; subcode?: number; status?: number; retryable: boolean;
  constructor(message: string, o: { code?: number; subcode?: number; status?: number; retryable?: boolean } = {}) {
    super(message);
    this.code = o.code; this.subcode = o.subcode; this.status = o.status;
    this.retryable = o.retryable ?? false;
  }
}

/** Graph error codes that mean "the token is dead — the user must reconnect". */
const AUTH_CODES = new Set([190, 102, 458, 459, 460, 463, 464, 467, 492]);
/** Codes that mean "slow down"; these are retryable and must never be persisted. */
const THROTTLE_CODES = new Set([4, 17, 32, 613, 80001, 80002, 80003, 80004]);

export function isAuthError(e: unknown): boolean {
  return e instanceof GraphError && e.code !== undefined && AUTH_CODES.has(e.code);
}
export function isThrottleError(e: unknown): boolean {
  return e instanceof GraphError && ((e.code !== undefined && THROTTLE_CODES.has(e.code)) || e.status === 429);
}

/** Fraction (0-1) of the app-level quota Meta reports as used, if it told us. */
export function appUsage(headers: Headers): number {
  try {
    const h = headers.get("x-app-usage");
    if (!h) return 0;
    const u = JSON.parse(h);
    return Math.max(Number(u.call_volume ?? 0), Number(u.total_cputime ?? 0), Number(u.total_time ?? 0)) / 100;
  } catch { return 0; }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * One Graph GET: token in the Authorization header (not the query string),
 * signed with appsecret_proof, with a timeout, and retried with backoff on
 * throttling or a transient 5xx. Throws a typed GraphError — the caller must
 * never turn a failure into a stored zero.
 */
export async function graphGet(
  path: string,
  params: Record<string, string>,
  token: string,
  opts: { timeoutMs?: number; retries?: number; onUsage?: (used: number) => void } = {}
): Promise<any> {
  const { timeoutMs = 8000, retries = 2 } = opts;
  const qs = new URLSearchParams({ ...params, ...appsecretProof(token) });
  const url = `${GRAPH}${path}?${qs}`;

  let lastErr: GraphError | null = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) await sleep(Math.min(2000 * 2 ** (attempt - 1), 8000) + Math.random() * 250);
    let res: Response;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = new GraphError(e instanceof Error ? e.message : "network error", { retryable: true });
      continue;
    }
    opts.onUsage?.(appUsage(res.headers));

    let body: any = null;
    try { body = await res.json(); } catch { /* non-JSON error page */ }

    if (body?.error) {
      const err = new GraphError(body.error.message || "graph error", {
        code: Number(body.error.code), subcode: Number(body.error.error_subcode),
        status: res.status,
      });
      err.retryable = isThrottleError(err);
      if (!err.retryable) throw err;
      lastErr = err;
      continue;
    }
    if (!res.ok) {
      const err = new GraphError(`HTTP ${res.status}`, { status: res.status, retryable: res.status === 429 || res.status >= 500 });
      if (!err.retryable) throw err;
      lastErr = err;
      continue;
    }
    return body;
  }
  throw lastErr ?? new GraphError("graph request failed");
}

export function redirect(location: string, extraHeaders: Record<string, string> = {}) {
  return { statusCode: 302, headers: { Location: location, ...extraHeaders }, body: "" };
}
export function json(statusCode: number, obj: unknown) {
  return { statusCode, headers: { "content-type": "application/json" }, body: JSON.stringify(obj) };
}

/** Redirect back to the Connections screen with a result flag.
 *  Only opaque codes are reflected — provider text is logged, never echoed. */
export function backToApp(result: string, value: string, extraHeaders: Record<string, string> = {}) {
  const base = env.SITE_URL || "";
  return redirect(`${base}/connections?${result}=${encodeURIComponent(value)}`, extraHeaders);
}

/** Thrown when an account is already connected to a different PulseBoard tenant. */
export class AccountOwnedByAnotherTenant extends Error {}

/** Upsert a connected account and stash its secret token (service-role only). */
export async function saveAccount(
  db: Db,
  userId: string,
  a: { platform: string; external_id: string; username: string; display_name?: string | null; avatar_url?: string | null },
  secret: { access_token: string; refresh_token?: string | null; expires_at?: string | null; extra?: Record<string, unknown> }
) {
  // An account may only ever belong to one tenant. Without this check, a stolen
  // or replayed authorisation can attach someone else's account to a stranger.
  const { data: owner } = await db
    .from("social_accounts")
    .select("user_id")
    .eq("platform", a.platform)
    .eq("external_id", a.external_id)
    .neq("user_id", userId)
    .maybeSingle();
  if (owner) throw new AccountOwnedByAnotherTenant(`${a.platform}:${a.external_id}`);

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
      access_token: encryptToken(secret.access_token),
      refresh_token: secret.refresh_token ? encryptToken(secret.refresh_token) : null,
      expires_at: secret.expires_at ?? null,
      extra: secret.extra ?? {},
    },
    { onConflict: "account_id" }
  );
  if (sErr) throw sErr;
  return acc.id as string;
}
