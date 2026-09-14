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
 * The registered name and address are settled from the certified translation
 * (2026-08-19). The former bracketed placeholders were filled on 2026-09-14 and
 * the operator accepted the wording without a separate legal review.
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

/**
 * The brand is not the legal name, and to a non-Arabic reader the connection is
 * invisible: a reviewer sees "PulseBoard" here and an Arabic registration
 * document naming الحجرة in the Business Verification upload, with nothing
 * linking them. This footer is that link, and it is why it appears on every
 * public page rather than only in the policy body.
 *
 * Both scripts, since 2026-09-04. This was Arabic-only while the English name
 * was unattested — no English appears on the registration itself, and a guessed
 * spelling on a page Meta reads is worse than none. The certified translation
 * (Abu-Ghazaleh / AGATO, 19 Aug 2026) settled it, so the English now sits beside
 * the Arabic rather than replacing it: the Arabic is what the uploaded document
 * says, and the English is what a reviewer can read.
 *
 * OPERATOR is the translator's exact string and must stay verbatim — it ends at
 * "Limited Liability", not "Limited Liability Company". Meta compares it to the
 * document character for character.
 *
 * The registry prints the name as `شركة الحجرة لتقنية المعلومات /ذات مسؤولية محدودة`,
 * where the slash separates the name from the legal form. It is dropped below
 * because it reads as a typo mid-sentence in English prose; the words are
 * otherwise identical to the registration PDF's text layer. If a Meta reviewer
 * ever queries the match, restore the slash rather than arguing the point.
 */
const LEGAL_NAME_AR = "شركة الحجرة لتقنية المعلومات ذات مسؤولية محدودة";
const REGISTRATION_NO = "83622";

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
          <h1 style={{ fontSize: 24, marginTop: 0 }}>{title}</h1>
          {children}
          <hr style={{ border: 0, borderTop: "1px solid var(--border)", margin: "28px 0 16px" }} />
          <p className="muted" style={{ fontSize: 13, lineHeight: 1.6 }}>
            PulseBoard and The Office are trading names of{" "}
            <b>{OPERATOR}</b> (<b lang="ar" dir="rtl">{LEGAL_NAME_AR}</b>),
            registered in {ADDRESS} under commercial registration
            no. {REGISTRATION_NO}. Contact: {CONTACT}.
          </p>
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
        <li><b>Your account</b>: email address and sign-in credentials, handled by our authentication provider.</li>
        <li><b>Your connected social accounts</b>: the account id, username, display name and profile picture of each Instagram professional account, Facebook Page, LinkedIn Company Page or TikTok account you connect.</li>
        <li><b>Access tokens</b> issued by those platforms. They are encrypted at rest with AES-256-GCM and are never sent to your browser. We never ask for and never hold your social media password. We request read-only permissions wherever the platform offers them. LinkedIn is the exception: its reporting permission for a Company Page also carries page-management rights, and no read-only alternative exists. PulseBoard never uses those rights; it only ever reads.</li>
        <li><b>Metrics</b>: daily followers, reach, views and engagement figures for the accounts you connect.</li>
        <li><b>Your posts</b>: captions, publication times, links and per-post performance.</li>
        <li><b>Aggregated audience information about your followers</b>: for Instagram and Facebook, age bands, gender split, country distribution and hourly activity; for a LinkedIn Company Page, industry, seniority, job function and company size (LinkedIn's terms do not allow us to store follower locations). These are statistical breakdowns only. We never receive the identity of any individual follower.</li>
        <li><b>Operational records</b>: sync history, and errors, retained so we can tell you when something failed.</li>
      </ul>

      <h3>Why we are allowed to hold it</h3>
      <p>We rely on <b>your consent</b>, recorded at the moment you connect each account, and you may withdraw it at any time by disconnecting the account. Withdrawal does not affect processing carried out beforehand.</p>

      <h3>Who else processes it</h3>
      <ul>
        <li><b>Supabase</b>: database and authentication, including the encrypted tokens.</li>
        {/*
          * Cloudflare, not Netlify. The app was ported in September 2026 and this
          * list was not moved with it, so the published privacy policy named a
          * processor that no longer holds any of this data and omitted the one
          * that does. This is the page a Meta reviewer reads during App Review
          * and the list the Data Protection Assessment asks for by name.
          */}
        <li><b>Cloudflare</b>: hosting, the scheduled sync, and server logs.</li>
        <li><b>Anthropic</b>: powers the optional AI assistant. When you use it, a compact summary of your dashboard figures and the titles of your top posts is sent to produce an answer. Your access tokens and raw records are never sent. If you do not use the assistant, nothing is sent.</li>
      </ul>
      <h3>Where it is processed</h3>
      {/*
        * Regions checked 2026-09-14: the Supabase project is Central EU (Frankfurt),
        * per `supabase projects list`. Cloudflare runs Pages Functions and the cron
        * Worker on its global network, so no single region can honestly be named.
        * The transfer basis is PDPL Article 15(A)(5): consent "after informing them
        * of the insufficient level of protection", which is why the consent
        * checkbox on Connections now says so. Article 15(B) separately requires the
        * controller to verify each recipient's protection before transferring.
        * That assessment is docs/TRANSFER-ASSESSMENT.md (2026-09-14), which is what
        * makes the last sentence below true. Keep them in step.
        */}
      <p>None of our providers is in Jordan, so using this service transfers your personal data abroad:</p>
      <ul>
        <li><b>Supabase</b> stores the database, including the encrypted tokens, in <b>Frankfurt, Germany</b>.</li>
        <li><b>Cloudflare</b> serves the app and runs the scheduled sync on its global network, so a request may be handled in whichever of its data centres is nearest.</li>
        <li><b>Anthropic</b>, a United States company, processes assistant requests if you use the assistant.</li>
      </ul>
      <p>Jordan's Personal Data Protection Law No. 24 of 2023 permits a transfer abroad with your consent after you have been told the recipient's protection may be lower than Jordanian law requires (Article 15). We rely on that consent, which you give when you connect an account. Before using each provider we checked the protection it publishes, and we keep that assessment on record.</p>

      <h3>How long we keep it</h3>
      <p>We keep what you connect for as long as you keep it connected, and no longer. <b>Disconnecting an account deletes it immediately</b>: the access token, every daily metric, every post record, the audience breakdowns and that account's sync history are removed at once, not after a delay. There is no retention window afterwards because there is nothing left to retain. Deleting your whole account removes everything above along with your goals, your recorded consents and any report links you created.</p>

      <h3>Shared report links</h3>
      <p>A shared link holds a <b>snapshot</b> of the figures as they stood when you created it; it does not update afterwards. Anyone holding the link can open it without signing in, so treat one as public once you have sent it.</p>
      <p><b>Links do not currently expire, and there is no way to revoke a single link.</b> Deleting your account removes every link you have created. If you need a link withdrawn before then, write to {CONTACT} and we will remove it for you.</p>

      <h3>Your rights</h3>
      <p>You may ask us for a copy of your data, ask us to correct or delete it, or withdraw consent. Use <b>Export my data</b> and <b>Delete my account</b> on the Connections page, or write to {CONTACT}; we respond within 30 days. You may also complain to the Personal Data Protection Unit at Jordan's Ministry of Digital Economy and Entrepreneurship.</p>

      <h3>Deleting your data</h3>
      <p>Disconnecting an account permanently deletes our stored access token and the metrics, posts and audience information we hold for it. For Facebook and TikTok it also withdraws our access at the platform. Instagram and LinkedIn give us no way to do that, so the permission stays listed on their side until you remove it there. See <a href="/data-deletion">Data deletion</a>.</p>
    </Shell>
  );
}

export function Terms() {
  return (
    <Shell title="Terms of service">
      <p className="muted">Operator: {OPERATOR}, {ADDRESS}. {REGISTRATION}. Contact: {CONTACT}.</p>
      <h3>What this service does</h3>
      <p>PulseBoard reads analytics from social accounts you connect and presents them. It is a read-only analytics tool: it never posts, comments, follows, messages or otherwise acts on your behalf, and it never holds your social media password.</p>
      <h3>Your responsibilities</h3>
      <p>You must own or be authorised to manage every account you connect, and your use must comply with the terms of the platform concerned. Do not connect accounts you do not control.</p>
      <h3>Accuracy of figures</h3>
      <p>Figures come from the platforms' own APIs and are reproduced as reported. Platforms restate recent figures as they settle, may withhold metrics from smaller accounts, and change or withdraw metrics over time. Days still settling are marked as provisional. We do not warrant the platforms' figures and you should not rely on them as the sole basis for a commercial commitment.</p>
      <h3>Availability</h3>
      <p>We make no uptime commitment and offer no service credits. We work to keep the service available, but access may be interrupted by maintenance, by our providers, or by platform changes outside our control.</p>
      <h3>Termination</h3>
      <p>You may stop at any time by deleting your account, which removes your data as described in the privacy policy.</p>
      <h3>Liability and governing law</h3>
      <p>To the extent the law allows, we are not liable for indirect or consequential loss, for loss of profit or business, or for decisions made on the platforms' figures, and our total liability to you is limited to the fees you paid us in the twelve months before the claim. Nothing in these terms limits liability that the law does not allow to be limited. These terms are governed by the laws of the Hashemite Kingdom of Jordan, and the courts of Amman have jurisdiction.</p>
    </Shell>
  );
}

/** What each recorded status means, in the words of the person it concerns. */
const EXPLAIN: Record<string, string> = {
  received: "We have your request and are working through it. This page updates when it finishes.",
  completed: "Everything we held about you has been deleted. Nothing further is required from you.",
  not_found: "We held nothing about you, so there was nothing to delete. This is not a refusal.",
  failed:
    "We tried and did not finish. Some of your data is still held, this is our fault and not a "
    + "refusal, and it has been raised with us to complete by hand. Your sign-in has deliberately "
    + "been left working so you can try again and so the remaining data stays traceable to you. "
    + "Quote the code above if you contact us.",
};

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
            <>
              <p>
                Status: <b>{status.status}</b>
                {status.completed_at && <> · {status.status === "failed" ? "attempted" : "completed"} {new Date(status.completed_at).toISOString().slice(0, 16).replace("T", " ")} UTC</>}
                {typeof status.accounts_deleted === "number" && <> · {status.accounts_deleted} account(s) removed</>}
              </p>
              {/*
                * A status word on its own is not an explanation, and for the Meta
                * callback this page is the only place one can be given: the callback
                * response carries a URL and a code and nothing else. Meta requires
                * this page to give "a human-readable explanation of the status of
                * their request, including a legitimate justification for any refusal
                * to delete", so each status says what it means for the person reading.
                */}
              <p className="muted">{EXPLAIN[status.status as string] ?? "We could not interpret the status of this request. Please contact us and quote the code above."}</p>
            </>
          )}
          {!status && !error && <p className="muted">Checking…</p>}
        </div>
      )}

      <h3>Deleting one connected account</h3>
      <p>Open <b>Connections</b> and choose <b>Disconnect</b>. This permanently deletes our stored access token and the metrics, posts and audience information we hold for that account. For Facebook and TikTok it also withdraws our access at the platform; for Instagram and LinkedIn, remove PulseBoard there as described below.</p>

      <h3>Deleting everything</h3>
      <p>Open <b>Connections</b> and choose <b>Delete my account</b>, or write to {CONTACT} from your registered address. Everything is removed, including your sign-in record.</p>

      <h3>Removing us from Instagram</h3>
      <p>Open <b>Instagram → Settings and activity → Website permissions → Apps and websites</b> and remove PulseBoard. Instagram notifies us, and we delete the stored tokens and stop syncing.</p>

      <h3>Removing us from Facebook</h3>
      <p>You can also remove PulseBoard from <b>Facebook → Settings → Apps and Websites</b>. Facebook notifies us, and we delete the stored tokens and stop syncing immediately. To request deletion of everything we already hold, use <b>Remove and delete</b> there, or contact us with the confirmation code Facebook gives you.</p>

      <h3>Removing us from LinkedIn</h3>
      <p>Open <b>LinkedIn → Settings &amp; Privacy → Data privacy → Permitted services</b> and remove PulseBoard. LinkedIn does not notify us when you do, so also disconnect the page in PulseBoard, or contact us, to delete what we hold.</p>

      <h3>Removing us from TikTok</h3>
      <p>Open <b>TikTok → Settings and privacy → Security and permissions → Manage app permissions</b> and remove PulseBoard, then contact us to delete stored data.</p>
    </Shell>
  );
}
