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
  /** Backend env vars this platform needs (Netlify + .env.local). */
  env: string[];
  /** Things that look like failures but are platform limits. */
  notes: string[];
}

export const SETUP_GUIDES: Record<Platform, SetupGuide> = {
  facebook: {
    summary:
      "One Meta app covers both Facebook and Instagram. Development Mode is enough to analyse Pages you administer — App Review is only needed to read other people's Pages.",
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
      "Brand-new Meta business accounts are sometimes auto-flagged, which blocks asset linking with errors like “not allowed to advertise”. Check business.facebook.com/accountquality — these holds usually clear within 24–48h.",
    ],
  },

  instagram: {
    summary:
      "Instagram analytics come through the Facebook Graph API, so Instagram shares the Meta app — and the Connect button — with Facebook. There is no separate Instagram connection.",
    requires: [
      "A Business or Creator Instagram account (a personal account cannot work)",
      "That Instagram account linked to a Facebook Page you administer",
    ],
    steps: [
      { text: "In the Instagram mobile app: Settings → Account type and tools → Switch to professional account, then pick Business or Creator." },
      {
        text:
          "Still in Instagram, connect a Facebook Page. A brand-new, empty Page is fine — but the link is mandatory, because the Graph API reaches Instagram through the Page.",
      },
      { text: "Complete the Facebook steps above — the same Meta app serves both platforms." },
      { text: "Add the Instagram Graph API product to that same app." },
      { text: "Press Connect on the Facebook row above: one OAuth grants the Page and its linked Instagram account together." },
    ],
    redirectPath: "/api/oauth-meta-callback",
    env: ["META_APP_ID", "META_APP_SECRET"],
    notes: [
      "Permissions requested: instagram_basic, instagram_manage_insights.",
      "Follower demographics need roughly 100 followers. Below that Meta refuses the call and the Audience page stays empty — that is Meta's limit, not a failed sync.",
      "A new account has no history for Meta to backfill, so trends build up from your first sync onward.",
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
      { text: "Submit the app for review — TikTok returns production data only after approval." },
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
