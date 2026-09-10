/**
 * Every /api/* endpoint, dispatched by path segment.
 *
 * Netlify rewrote /api/foo to /.netlify/functions/foo, so the function's
 * FILENAME was its route. That mapping is reproduced here explicitly rather
 * than by directory convention, because an explicit table is checkable: if a
 * handler is added to netlify/functions and not registered here, it 404s
 * visibly instead of half-existing.
 *
 * A catch-all rather than one file per route: the handlers share _sync.ts and
 * _instagram.ts, so per-route files would bundle those repeatedly. One entry
 * point keeps a single copy.
 *
 * Names must match the paths already registered with Meta and TikTok — the
 * OAuth redirect URIs, the deauthorize and data-deletion callbacks are all
 * configured in those dashboards against these exact strings. Renaming one
 * here silently breaks a platform integration, so treat this table as fixed.
 */
import { runHandler, type NetlifyHandler } from "../_adapter";

import { handler as accountData } from "../../netlify/functions/account-data";
import { handler as ai } from "../../netlify/functions/ai";
import { handler as deletionStatus } from "../../netlify/functions/deletion-status";
import { handler as disconnect } from "../../netlify/functions/disconnect";
import { handler as metaDataDeletion } from "../../netlify/functions/meta-data-deletion";
import { handler as metaDeauthorize } from "../../netlify/functions/meta-deauthorize";
import { handler as oauthInstagram } from "../../netlify/functions/oauth-instagram";
import { handler as oauthInstagramCallback } from "../../netlify/functions/oauth-instagram-callback";
import { handler as oauthMeta } from "../../netlify/functions/oauth-meta";
import { handler as oauthMetaCallback } from "../../netlify/functions/oauth-meta-callback";
import { handler as oauthLinkedin } from "../../netlify/functions/oauth-linkedin";
import { handler as oauthLinkedinCallback } from "../../netlify/functions/oauth-linkedin-callback";
import { handler as oauthTiktok } from "../../netlify/functions/oauth-tiktok";
import { handler as oauthTiktokCallback } from "../../netlify/functions/oauth-tiktok-callback";
import { handler as refreshPost } from "../../netlify/functions/refresh-post";
import { handler as share } from "../../netlify/functions/share";
import { handler as sync } from "../../netlify/functions/sync";

const ROUTES: Record<string, NetlifyHandler> = {
  "account-data": accountData as NetlifyHandler,
  "ai": ai as NetlifyHandler,
  "deletion-status": deletionStatus as NetlifyHandler,
  "disconnect": disconnect as NetlifyHandler,
  "meta-data-deletion": metaDataDeletion as NetlifyHandler,
  "meta-deauthorize": metaDeauthorize as NetlifyHandler,
  "oauth-linkedin": oauthLinkedin as NetlifyHandler,
  "oauth-linkedin-callback": oauthLinkedinCallback as NetlifyHandler,
  "oauth-instagram": oauthInstagram as NetlifyHandler,
  "oauth-instagram-callback": oauthInstagramCallback as NetlifyHandler,
  "oauth-meta": oauthMeta as NetlifyHandler,
  "oauth-meta-callback": oauthMetaCallback as NetlifyHandler,
  "oauth-tiktok": oauthTiktok as NetlifyHandler,
  "oauth-tiktok-callback": oauthTiktokCallback as NetlifyHandler,
  "refresh-post": refreshPost as NetlifyHandler,
  "share": share as NetlifyHandler,
  "sync": sync as NetlifyHandler,
};

/*
 * sync-cron and token-refresh are deliberately absent. Both are scheduled work
 * that Netlify invoked directly, with no route reaching them. Exposing either
 * here would put an unauthenticated, service-role-powered operation on the
 * public internet — sync-cron touches EVERY user's accounts, and token-refresh
 * rewrites stored credentials. The Cron Trigger in worker-cron/ carries both.
 *
 * token-refresh was briefly listed here while porting. It was wrong, and it is
 * the exact mistake this comment exists to prevent recurring.
 */

export const onRequest = async (context: { request: Request; params: { path?: string[] } }) => {
  const segments = context.params.path ?? [];
  const name = Array.isArray(segments) ? segments[0] : segments;
  const handler = name ? ROUTES[name] : undefined;

  if (!handler) {
    return new Response(JSON.stringify({ message: "Not found." }), {
      status: 404, headers: { "content-type": "application/json" },
    });
  }
  return runHandler(handler, context.request);
};
