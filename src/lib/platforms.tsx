import type { Platform } from "./types";

export const PLATFORM_ORDER: Platform[] = ["facebook", "instagram", "tiktok", "linkedin"];

interface PlatformMeta {
  key: Platform;
  name: string;
  color: string;      // css var reference for the data series
  weak: string;
  icon: JSX.Element;
}

const facebookIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M22 12a10 10 0 1 0-11.6 9.9v-7H7.9V12h2.5V9.8c0-2.5 1.5-3.9 3.8-3.9 1.1 0 2.2.2 2.2.2v2.5h-1.3c-1.2 0-1.6.8-1.6 1.6V12h2.8l-.4 2.9h-2.4v7A10 10 0 0 0 22 12z" />
  </svg>
);
const instagramIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.3 1 .4 2.2.1 1.3.1 1.7.1 4.8s0 3.5-.1 4.8c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .3-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4a3.9 3.9 0 0 1-1.4-.9 3.9 3.9 0 0 1-.9-1.4c-.2-.4-.3-1-.4-2.2C2.2 15.5 2.2 15.1 2.2 12s0-3.5.1-4.8c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.3 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 1.8c-3.1 0-3.5 0-4.7.1-1.1.1-1.7.2-2.1.4-.5.2-.9.4-1.3.8-.4.4-.6.8-.8 1.3-.2.4-.3 1-.4 2.1C2.6 9.9 2.6 10.3 2.6 12s0 2.1.1 3.3c.1 1.1.2 1.7.4 2.1.2.5.4.9.8 1.3.4.4.8.6 1.3.8.4.2 1 .3 2.1.4 1.2.1 1.6.1 4.7.1s3.5 0 4.7-.1c1.1-.1 1.7-.2 2.1-.4.5-.2.9-.4 1.3-.8.4-.4.6-.8.8-1.3.2-.4.3-1 .4-2.1.1-1.2.1-1.6.1-3.3s0-2.1-.1-3.3c-.1-1.1-.2-1.7-.4-2.1a3.5 3.5 0 0 0-.8-1.3 3.5 3.5 0 0 0-1.3-.8c-.4-.2-1-.3-2.1-.4-1.2-.1-1.6-.1-4.7-.1zm0 3.1a4.9 4.9 0 1 1 0 9.8 4.9 4.9 0 0 1 0-9.8zm0 8.1a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4zm6.3-8.3a1.15 1.15 0 1 1-2.3 0 1.15 1.15 0 0 1 2.3 0z" />
  </svg>
);
const tiktokIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M16.6 5.8a4.3 4.3 0 0 1-1-2.8h-3.1v11.9a2.4 2.4 0 1 1-2.4-2.4c.2 0 .5 0 .7.1v-3.2a5.7 5.7 0 0 0-.7 0 5.6 5.6 0 1 0 5.6 5.6V9.5a7.3 7.3 0 0 0 4.3 1.4V7.7a4.3 4.3 0 0 1-3.4-1.9z" />
  </svg>
);

const linkedinIcon = (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.03-3.04-1.85-3.04-1.86 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05a3.74 3.74 0 0 1 3.37-1.85c3.6 0 4.27 2.37 4.27 5.46zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.22.79 24 1.77 24h20.45c.98 0 1.78-.78 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
  </svg>
);

export const PLATFORMS: Record<Platform, PlatformMeta> = {
  facebook: { key: "facebook", name: "Facebook", color: "var(--fb)", weak: "var(--fb-weak)", icon: facebookIcon },
  instagram: { key: "instagram", name: "Instagram", color: "var(--ig)", weak: "var(--ig-weak)", icon: instagramIcon },
  tiktok: { key: "tiktok", name: "TikTok", color: "var(--tt)", weak: "var(--tt-weak)", icon: tiktokIcon },
  linkedin: { key: "linkedin", name: "LinkedIn", color: "var(--li)", weak: "var(--li-weak)", icon: linkedinIcon },
};

/** Brand fill for the coloured platform tile in connect rows / badges. */
export const PLATFORM_FILL: Record<Platform, string> = {
  facebook: "#1877F2",
  instagram: "#E1306C",
  tiktok: "#111114",
  linkedin: "#0A66C2",
};
