import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { getTheme, applyTheme } from "../lib/theme";
import ThemeToggle from "../components/ThemeToggle";

/**
 * Public legal pages. Meta's App Review requires a reachable privacy policy and
 * a data-deletion route, and Jordan's PDPL requires the processing to be
 * described accurately. The content below describes what this system ACTUALLY
 * does — it is not boilerplate.
 *
 * >>> EVERY STATEMENT HERE MUST BE TRUE OF THE CODE AS IT STANDS. <<<
 * Two claims were removed in 2026-08 because they were not: that shared links
 * expire, and that records are kept for a retention period after disconnection.
 * Neither feature exists — there is no expiry column on `report_shares` and no
 * purge job — and Meta checks a privacy policy against real behaviour. If
 * expiry or retention is built later, describe it here THEN, not before.
 *
 * The registered name and address are now settled from the certified translation
 * (2026-08-19). What remains bracketed is genuinely unresolved, not unwritten:
 * items that wait on counsel rather than on the certified translation of the
 * commercial
 * registration, and the rest are questions for counsel in Jordan.
 */
// Exactly as it appears on the certified translation (Abu-Ghazaleh / AGATO,
// 19 Aug 2026) of commercial registration 83622. Note it ends at "Limited
// Liability", not "Limited Liability Company". Meta compares this against the
// document character for character, so it must not be varied anywhere.
const OPERATOR = "Al-Hujra Information Technology Company / Limited Liability";
const CONTACT = "privacy@theoffice.it.com";
// The registration states only "Amman" as the headquarters — there is no street
// address on the document. Do not invent one; the corroborating second document
// is what has to carry it.
const ADDRESS = "Amman, Jordan";
const REGISTRATION = "Commercial registration 83622 · national establishment 200214930";

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  useEffect(() => { applyTheme(getTheme()); }, []);
  return (
    <div className="shareview">
      <div className="shareview__bar">
        <a className="brandmark" href="/" style={{ textDecoration: "none" }}>
          <span className="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l2.5-7 4 15 3-9 2 3h4.5" /></svg></span>
          <b>PulseBoard</b>
        </a>
        <span className="spacer" style={{ flex: 1 }} />
        <ThemeToggle />
      </div>
      <div className="shareview__body">
        <div className="panel" style={{ maxWidth: 760, margin: "24px auto", padding: "28px 32px" }}>
          <div className="banner" style={{ marginBottom: 20 }}>
            <div className="bt">
              <b>Draft pending legal review.</b>
              <p>This describes the system accurately, but the bracketed details must be completed and the text reviewed by qualified counsel in Jordan before it is relied on.</p>
            </div>
          </div>
          <h1 style={{ fontSize: 24, marginTop: 0 }}>{title}</h1>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Privacy() {
  return (
    <Shell title="Privacy policy">
      <p className="muted">Last updated: {new Date().toISOString().slice(0, 10)}. Controller: {OPERATOR}, {ADDRESS}. {REGISTRATION}. Contact: {CONTACT}.</p>

      <h3>What we hold</h3>
      <ul>
        <li><b>Your account</b> — email address and sign-in credentials, handled by our authentication provider.</li>
        <li><b>Your connected social accounts</b> — the account id, username, display name and profile picture of each Facebook Page, Instagram Business account or TikTok account you connect.</li>
        <li><b>Access tokens</b> issued by those platforms. They are encrypted at rest with AES-256-GCM and are never sent to your browser. We request <b>read-only</b> permissions; we never ask for and never hold your social media password.</li>
        <li><b>Metrics</b> — daily followers, reach, views and engagement figures for the accounts you connect.</li>
        <li><b>Your posts</b> — captions, publication times, links and per-post performance.</li>
        <li><b>Aggregated audience information about your followers</b> — age bands, gender split, country distribution and hourly activity, as statistical breakdowns only. We never receive the identity of any individual follower.</li>
        <li><b>Operational records</b> — sync history, and errors, retained so we can tell you when something failed.</li>
      </ul>

      <h3>Why we are allowed to hold it</h3>
      <p>We rely on <b>your consent</b>, recorded at the moment you connect each account, and you may withdraw it at any time by disconnecting the account. Withdrawal does not affect processing carried out beforehand.</p>

      <h3>Who else processes it</h3>
      <ul>
        <li><b>Supabase</b> — database and authentication, including the encrypted tokens.</li>
        <li><b>Netlify</b> — hosting and server logs.</li>
        <li><b>Anthropic</b> — powers the optional AI assistant. When you use it, a compact summary of your dashboard figures and the titles of your top posts is sent to produce an answer. Your access tokens and raw records are never sent. If you do not use the assistant, nothing is sent.</li>
      </ul>
      <p>All three operate outside Jordan, so using this service involves transferring your personal data abroad. [REGIONS CONFIGURED FOR SUPABASE AND NETLIFY, AND THE TRANSFER BASIS RELIED ON UNDER THE PDPL — COUNSEL TO COMPLETE.]</p>

      <h3>How long we keep it</h3>
      <p>We keep what you connect for as long as you keep it connected, and no longer. <b>Disconnecting an account deletes it immediately</b> — the access token, every daily metric, every post record, the audience breakdowns and that account's sync history are removed at once, not after a delay. There is no retention window afterwards because there is nothing left to retain. Deleting your whole account removes everything above along with your goals, your recorded consents and any report links you created.</p>

      <h3>Shared report links</h3>
      <p>A shared link holds a <b>snapshot</b> of the figures as they stood when you created it; it does not update afterwards. Anyone holding the link can open it without signing in, so treat one as public once you have sent it.</p>
      <p><b>Links do not currently expire, and there is no way to revoke a single link.</b> Deleting your account removes every link you have created. If you need a link withdrawn before then, write to {CONTACT} and we will remove it for you.</p>

      <h3>Your rights</h3>
      <p>You may ask us for a copy of your data, ask us to correct or delete it, or withdraw consent. Use <b>Export my data</b> and <b>Delete my account</b> in your settings, or write to {CONTACT}; we respond within [STATUTORY PERIOD — COUNSEL TO CONFIRM UNDER THE PDPL]. You may also complain to the competent Jordanian authority.</p>

      <h3>Deleting your data</h3>
      <p>Disconnecting an account revokes our access at the platform and permanently deletes the metrics, posts and audience information we hold for it. See <a href="/data-deletion">Data deletion</a>.</p>
    </Shell>
  );
}

export function Terms() {
  return (
    <Shell title="Terms of service">
      <p className="muted">Operator: {OPERATOR}, {ADDRESS}. {REGISTRATION}. Contact: {CONTACT}.</p>
      <h3>What this service does</h3>
      <p>PulseBoard reads analytics from social accounts you connect and presents them. It is a read-only analytics tool: it cannot post, comment, follow, message or otherwise act on your behalf, and it never holds your social media password.</p>
      <h3>Your responsibilities</h3>
      <p>You must own or be authorised to manage every account you connect, and your use must comply with the terms of the platform concerned. Do not connect accounts you do not control.</p>
      <h3>Accuracy of figures</h3>
      <p>Figures come from the platforms' own APIs and are reproduced as reported. Platforms restate recent figures as they settle, may withhold metrics from smaller accounts, and change or withdraw metrics over time. Days still settling are marked as provisional. We do not warrant the platforms' figures and you should not rely on them as the sole basis for a commercial commitment.</p>
      <h3>Availability</h3>
      <p>[UPTIME COMMITMENT, IF ANY.] Access may be interrupted by platform changes outside our control.</p>
      <h3>Termination</h3>
      <p>You may stop at any time by deleting your account, which removes your data as described in the privacy policy.</p>
      <h3>Liability and governing law</h3>
      <p>[LIABILITY POSITION — COUNSEL TO COMPLETE.] These terms are governed by the laws of the Hashemite Kingdom of Jordan.</p>
    </Shell>
  );
}

export function DataDeletion() {
  const [params] = useSearchParams();
  const code = params.get("code");
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) return;
    fetch(`/api/deletion-status?code=${encodeURIComponent(code)}`)
      .then(async (r) => (r.ok ? setStatus(await r.json()) : setError((await r.json()).message)))
      .catch(() => setError("Could not check that code."));
  }, [code]);

  return (
    <Shell title="Data deletion">
      {code && (
        <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
          <h3 style={{ marginTop: 0 }}>Request {code}</h3>
          {error && <p className="muted">{error}</p>}
          {status && (
            <p>
              Status: <b>{status.status}</b>
              {status.completed_at && <> · completed {new Date(status.completed_at).toISOString().slice(0, 16).replace("T", " ")} UTC</>}
              {typeof status.accounts_deleted === "number" && <> · {status.accounts_deleted} account(s) removed</>}
            </p>
          )}
          {!status && !error && <p className="muted">Checking…</p>}
        </div>
      )}

      <h3>Deleting one connected account</h3>
      <p>Open <b>Connections</b> and choose <b>Disconnect</b>. This revokes our access at the platform and permanently deletes the metrics, posts and audience information we hold for that account.</p>

      <h3>Deleting everything</h3>
      <p>Open <b>Settings</b> and choose <b>Delete my account</b>, or write to {CONTACT} from your registered address. Everything is removed, including your sign-in record.</p>

      <h3>Removing us from Facebook or Instagram</h3>
      <p>You can also remove PulseBoard from <b>Facebook → Settings → Apps and Websites</b>. Facebook notifies us, and we delete the stored tokens and stop syncing immediately. To request deletion of everything we already hold, use <b>Remove and delete</b> there, or contact us with the confirmation code Facebook gives you.</p>

      <h3>Removing us from TikTok</h3>
      <p>Open <b>TikTok → Settings and privacy → Security and permissions → Manage app permissions</b> and remove PulseBoard, then contact us to delete stored data.</p>
    </Shell>
  );
}
