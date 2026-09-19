/**
 * Has LinkedIn granted the Community Management API to our app yet?
 *
 *   node verify/linkedin-access-check.mjs
 *
 * No credentials, no login, nothing sent but a public authorize URL. LinkedIn
 * validates an app's permitted scopes when the consent page is requested,
 * BEFORE anyone signs in, and says so in the page:
 *
 *   refused  -> "error_description=The requested permission scope is not valid"
 *   granted  -> the sign-in / consent page, with no scope error
 *
 * Measured 2026-09-19, while the Development tier application was pending: all
 * five scopes refused, and so was plain `openid profile email`, i.e. the app
 * had no products at all. So this answers "can anyone connect LinkedIn yet"
 * without waiting for Microsoft's email.
 *
 * The status code is useless here: LinkedIn answers 200 for everything,
 * including a client id that does not exist. The CONTROL below proves the app
 * is recognised, so a refusal is about the scopes and not a typo in the id. A
 * refusal without that control proves nothing.
 */
const CLIENT_ID = "77npf65q6q4gty";   // public by design: it is in every authorize URL
const REDIRECT = "https://app.theoffice.it.com/api/oauth-linkedin-callback";
const SCOPES = ["r_organization_social", "rw_organization_admin", "r_basicprofile",
  "r_member_profileAnalytics", "r_member_postAnalytics"];

async function verdict(clientId, scope) {
  const u = new URL("https://www.linkedin.com/oauth/v2/authorization");
  u.search = new URLSearchParams({ response_type: "code", client_id: clientId, redirect_uri: REDIRECT, state: "access-check", scope }).toString();
  const html = await (await fetch(u, { headers: { "user-agent": "Mozilla/5.0" }, redirect: "manual" })).text();
  const err = html.match(/error_description=([^&"]*)/)?.[1];
  return err ? decodeURIComponent(err.replace(/\+/g, " ")) : null;
}

// Control: a client id that does not exist must NOT produce the scope error.
const bogus = await verdict("zzzz0000notreal", "r_basicprofile");
const ours = await verdict(CLIENT_ID, "r_basicprofile");
if (bogus && bogus === ours) {
  console.log("INCONCLUSIVE: a made-up client id gets the same answer as ours, so this check cannot tell them apart any more.");
  process.exit(2);
}

let granted = 0;
for (const s of SCOPES) {
  const v = await verdict(CLIENT_ID, s);
  console.log(`${v ? "refused " : "GRANTED "} ${s}${v ? `   (${v})` : ""}`);
  if (!v) granted++;
}
const all = await verdict(CLIENT_ID, SCOPES.join(" "));
console.log(`\nall five together: ${all ? `refused (${all})` : "GRANTED"}`);
console.log(granted === SCOPES.length && !all
  ? "\nLinkedIn access is live. Next: docs/SETUP-LINKEDIN.md section 3 (secrets, redeploy app AND Worker, probe --profile)."
  : "\nNot yet. Nobody can connect LinkedIn until all five are granted.");
process.exit(granted === SCOPES.length && !all ? 0 : 1);
