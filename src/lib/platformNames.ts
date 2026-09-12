/**
 * Platform names and order, with no JSX attached.
 *
 * `platforms.tsx` carries the brand icons, so importing it pulls in React — and
 * `analytics.ts` and `snapshot.ts` import it for nothing but `PLATFORMS[p].name`.
 * That single lookup was enough to make both modules uncompilable for a test.
 * The names live here; `platforms.tsx` builds its icon table on top of them, so
 * there is still exactly one place a platform is named.
 */
import type { Platform } from "./types";

export const PLATFORM_ORDER: Platform[] = ["facebook", "instagram", "tiktok", "linkedin"];

export const PLATFORM_NAMES: Record<Platform, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  linkedin: "LinkedIn",
};

/** The display name of a platform. */
export const platformName = (p: Platform): string => PLATFORM_NAMES[p];
