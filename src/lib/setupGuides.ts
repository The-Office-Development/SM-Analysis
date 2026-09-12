import type { Platform } from "./types";

/* ---------------------------------------------------------------------------
 * Per-platform connection manuals, shown inline on the Connections page.
 * These mirror the README but stay deliberately short: the few steps that
 * actually block a connection, plus the gotchas that look like bugs but aren't.
 * ------------------------------------------------------------------------- */

export interface SetupStep {
  text: string;
  link?: { href: string; label: string };
}

export interface SetupGuide {
  /** One line on how this platform's connection works. */
  summary: string;
  /** Hard prerequisites — OAuth cannot succeed without these. */
  requires: string[];
  steps: SetupStep[];
  /** Appended to the site origin to form the OAuth redirect URI. */
  redirectPath: string;
  /** Backend env vars this platform needs (Cloudflare secrets + .env.local). */
  env: string[];
  /** Things that look like failures but are platform limits. */
  notes: string[];
}

export const SETUP_GUIDES: Record<Platform, SetupGuide> = {
  facebook: {
    summary:
      "For Facebook Pages. Development Mode is enough to analyse Pages you administer. App Review is only needed to read other people's Pages. Instagram no longer comes through here; it has its own row.",
    requires: ["A Facebook Page you administer"],
    steps: [
      {
        text: "Create an app of type Business.",
        link: { href: "https://developers.facebook.com/apps/", label: "developers.facebook.com/apps" },
      },
      { text: "Add the Facebook Login product to the app." },
      { text: "Facebook Login → Settings → Valid OAuth Redirect URIs: add the callback URL below." },
      { text: "Settings → Basic: copy the App ID and App Secret into the environment variables below." },
      {
        text:
          "App roles → Roles: add yourself as Administrator or Developer. This lets you connect your own Pages straight away, with no App Review.",
      },
      { text: "Come back here and press Connect, then approve the permission prompt." },
    ],
    redirectPath: "/api/oauth-meta-callback",
    env: ["META_APP_ID", "META_APP_SECRET"],
    notes: [
      "Permissions requested: pages_show_list, pages_read_engagement, read_insights. Submit these for App Review only if you need Pages you don't administer.",
      "Brand-new Meta business accounts are sometimes auto-flagged, which blocks asset linking with errors like “not allowed to advertise”. Check business.facebook.com/accountquality. These holds usually clear within 24 to 48 hours.",
      /*
       * Not a limitation of this code, and the Audience page looks broken
       * without it being said. It is also what caused two defects found on
       * 2026-09-12: an empty gender breakdown was rendering "Other 100%", and an
       * empty activity grid was producing a "best time to post" of Sunday
       * midnight. Both reached real Pages, not just LinkedIn.
       */
      "A Page connected after 14 March 2024 gets NO audience demographics from Meta at all — no age, no gender, no countries, and no follower-activity hours. The Audience page will be empty for it and that is Meta's limit, not a failed sync.",
      "page_impressions, page_fans and post_impressions were removed in November 2025. The replacements are already in use here; an older guide naming them is out of date.",
    ],
  },

  /*
   * Instagram has its OWN connection, on the Instagram Login path.
   *
   * This guide described the Facebook Login path until 2026-08 — it told people a
   * linked Facebook Page was mandatory and pointed at /api/oauth-meta-callback
   * with META_APP_* credentials. All of that was left behind when Instagram Login
   * became the primary path, and the redirect URI is rendered straight into the
   * Connections page, so anyone following it registered the wrong callback and
   * the connection failed. The Page requirement is the specific thing this path
   * exists to remove: a creator without a Page cannot connect at all on the
   * Facebook path.
   */
  instagram: {
    summary:
      "Instagram connects on its own, through Instagram Login. No Facebook Page is involved, and the permissions are read-only.",
    requires: ["A Business or Creator Instagram account (a personal account cannot expose insights)"],
    steps: [
      { text: "In the Instagram mobile app: Settings → Account type and tools → Switch to professional account, then pick Business or Creator." },
      {
        text: "Create a Meta app, then add the Instagram product and choose API setup with Instagram login.",
        link: { href: "https://developers.facebook.com/apps/", label: "developers.facebook.com/apps" },
      },
      { text: "Business login settings → add the callback URL below as a redirect URI, exactly as shown." },
      { text: "Copy the Instagram app ID and secret into the environment variables below. These are NOT the Facebook app's App ID and secret." },
      { text: "Set the app's display name. That is the name people see on the Instagram permission screen." },
      { text: "App roles → Roles: add the account as a Tester. The invitation is accepted in that account's own Instagram settings — ON A DESKTOP BROWSER. It does not appear in the mobile app, which is where everyone looks first." },
      { text: "Come back here, press Connect on this row, and approve the permission prompt." },
    ],
    redirectPath: "/api/oauth-instagram-callback",
    env: ["INSTAGRAM_APP_ID", "INSTAGRAM_APP_SECRET"],
    notes: [
      "Permissions requested: instagram_business_basic and instagram_business_manage_insights. Both are read-only, so this app cannot post, comment or message.",
      "Follower demographics need roughly 100 followers. Below that Meta returns nothing and the Audience page stays empty. That is Meta's limit, not a failed sync.",
      "A new account has no history for Meta to backfill, so trends build up from your first sync onward.",
      "History arrives in chunks over several syncs rather than all at once. Instagram will only answer about one day at a time for most figures, so a month of history is hundreds of separate questions. Recent days are refreshed on every run; older history fills in behind them.",
      "Connecting a Facebook Page is a separate row above, and still uses the Facebook app's credentials.",
      /*
       * The correction that came from the operator rather than from any
       * documentation, and the most valuable line here. The runbook said "they
       * accept from their own Instagram settings" without saying WHERE, which is
       * exactly how a guide fails in front of a client.
       */
      "The Tester invitation is only visible on a DESKTOP browser. A client looking in the Instagram mobile app will not find it, will say the invitation never arrived, and both of you will spend the meeting on it.",
      "Tester roles cap at about five accounts. That is a pilot, not a roster.",
      /*
       * The tester route is a way to run a pilot WHILE App Review is queued, not
       * a way to postpone it. PROJECT-STATE.md §0 records this qualification
       * because the temptation to read it the other way has already come up once,
       * and the consequence lands on the client's account rather than ours.
       */
      "Real data flows with no App Review, but Meta describes Development Mode as internal testing only. Running a paying client on it is a Platform Terms problem, so treat this as a way to pilot WHILE review is queued, not instead of it.",
      "Stories have never once been captured by this product. The /stories edge returns an empty list even with a story live, and reshared posts appear to be excluded outright. Do not promise story analytics.",
    ],
  },

  linkedin: {
    summary: "LinkedIn connects a COMPANY PAGE, not a personal profile, and needs an approved Community Management app.",
    requires: [
      "A LinkedIn Company Page",
      "The ADMINISTRATOR role on that page (Content Admin is not enough to read reporting)",
    ],
    steps: [
      {
        text: "Create a developer app, associated with your own Company Page.",
        link: { href: "https://developer.linkedin.com/", label: "developer.linkedin.com" },
      },
      { text: "Request Community Management API access, Development Tier. It must be a NEW app that holds no other API product." },
      { text: "Request the scopes: r_organization_social, rw_organization_admin." },
      { text: "Add the callback URL below to the app's authorised redirect URLs." },
      { text: "Copy the Client ID and Client Secret into the environment variables below." },
      { text: "Apply for Standard Tier once there is something to show. It requires a screencast demonstrating each use case in the request form." },
    ],
    redirectPath: "/api/oauth-linkedin-callback",
    env: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    notes: [
      "Personal profiles are not supported. Reading a member's own posts needs r_member_social, which LinkedIn states is closed and not accepting requests, so a profile connection could only ever be partial. Company Pages have the full set.",
      "rw_organization_admin is read AND write. LinkedIn publishes no read-only scope for page reporting, so connecting a page grants a token that could post as it. This product never calls a write endpoint, but the client is agreeing to more than they do on Instagram and should be told so.",
      "Statistics reach back twelve months on a rolling window. Anything older is not an error, it is simply absent.",
      "Development Tier allows 500 API calls per app per day and 100 per member. The sync is built around one call for the whole daily series and one for all posts, but this is a real ceiling on how many pages one app can carry.",
      "LinkedIn sunsets an API version roughly every year, against Meta's two. The version is pinned in one place, LI.VERSION, and moving it is a deliberate act.",
      /*
       * The single most operationally important fact about LinkedIn, and it was
       * missing: Phase 1 established that a connection has a hard 60-day life
       * and that nothing on the server can extend it.
       */
      "A LinkedIn token lasts 60 DAYS and cannot be refreshed from a server — LinkedIn issues programmatic refresh to selected partners only. The account is flagged ten days out and Connections shows \"Renew soon\". Clicking Reconnect inside that window is silent; after it lapses it is a full consent screen, which for a Company Page means finding an administrator.",
      "Disconnect deletes our copy of the token but cannot revoke it — LinkedIn documents no revoke endpoint for this flow. The client withdraws it themselves at Settings and Privacy → Data privacy → Permitted services.",
      "A Company Page reports NO age and NO gender, and never reports when followers are online. What it reports instead is professional — industry, seniority, job function, company size and market area — and it is richer than Instagram's. Each facet returns only its top 100 values, and the endpoint gives no follower total to check them against, so a share is a share of what was answered.",
      "Day-by-day figures stop TWO days before today, not yesterday. A gap at the trailing edge is the API's window, not a failed sync.",
      "Follower gains per day exist but are not stored: the documentation does not say whether a gain is gross or net of unfollows, and LinkedIn reports no unfollows at all. Settling that is the first thing to check on the first live call.",
      "Nothing here has been verified against a live response yet. See docs/LINKEDIN.md.",
    ],
  },
  tiktok: {
    summary: "TikTok uses its own developer app and Login Kit, entirely separate from Meta.",
    requires: ["A TikTok account"],
    steps: [
      {
        text: "Create an app.",
        link: { href: "https://developers.tiktok.com/", label: "developers.tiktok.com" },
      },
      { text: "Add the Login Kit product." },
      { text: "Request the scopes: user.info.basic, user.info.profile, user.info.stats, video.list." },
      { text: "Add the callback URL below to the app's Login Kit redirect URIs." },
      { text: "Copy the Client key and Client secret into the environment variables below." },
      { text: "Submit the app for review. TikTok returns production data only after approval." },
    ],
    redirectPath: "/api/oauth-tiktok-callback",
    env: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    notes: [
      "TikTok exposes no daily-history API, so its trend line starts at your first sync instead of backfilling 30 days.",
      "TikTok exposes no audience demographics, so the Audience page stays empty for TikTok-only setups.",
    ],
  },
};

/** Full OAuth redirect URI to register with the platform, for this deployment. */
export function redirectUri(platform: Platform, origin: string): string {
  return `${origin}${SETUP_GUIDES[platform].redirectPath}`;
}
