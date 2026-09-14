/**
 * What each connection error code means, in words a client can act on.
 *
 * The callbacks redirect with an opaque code (provider text is logged, never
 * echoed), and the start endpoints answer with the same codes. The Connections
 * page used to print the code itself: "Connection failed: linkedin_no_admin_page".
 * Every code any endpoint can produce is listed here; a test holds the two lists
 * together, so a new code without a sentence fails the suite.
 */
export const CONNECT_ERRORS: Record<string, string> = {
  not_signed_in: "Your session has ended. Sign in again, then connect.",
  permission_declined: "The connection was cancelled on the platform's screen, so nothing was connected.",
  bad_state: "That connection attempt expired or was started in another browser. Start it again from this page.",
  missing_code: "The platform did not finish the connection. Please try again.",
  already_connected_elsewhere: "That account is already connected to another PulseBoard workspace.",
  token_exchange_failed: "The platform refused to finish the connection. Please try again in a minute.",
  meta_not_configured: "Facebook connections are not switched on yet.",
  meta_callback_failed: "Something went wrong finishing the Facebook connection. Please try again.",
  no_pages_found: "No Facebook Page was found that you manage.",
  instagram_not_configured: "Instagram connections are not switched on yet.",
  instagram_callback_failed: "Something went wrong finishing the Instagram connection. Please try again.",
  tiktok_not_configured: "TikTok connections are not switched on yet.",
  tiktok_callback_failed: "Something went wrong finishing the TikTok connection. Please try again.",
  linkedin_not_configured: "LinkedIn connections are not switched on yet. They open once LinkedIn approves PulseBoard.",
  linkedin_exchange_failed: "LinkedIn refused to finish the connection. Please try again in a minute.",
  linkedin_no_admin_page: "You are not a Super admin of any LinkedIn Page. Ask the page's Super admin to add you, or connect your personal profile instead.",
  linkedin_callback_failed: "Something went wrong finishing the LinkedIn connection. Please try again.",
};

export function connectErrorMessage(code: string | null | undefined): string {
  if (!code) return "Could not start the connection. Please try again.";
  return CONNECT_ERRORS[code] ?? "The connection did not complete. Please try again.";
}
