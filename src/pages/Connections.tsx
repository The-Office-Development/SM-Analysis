import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { useDemo } from "../context/DemoContext";
import { useToast } from "../context/ToastContext";
import { useAuth } from "../context/AuthContext";
import { connectErrorMessage } from "../lib/connectErrors";
import { isConfigured } from "../lib/supabase";
import { startOAuth, disconnectAccount, exportMyData, deleteMyAccount } from "../lib/api";
import { PLATFORMS, PLATFORM_ORDER, PLATFORM_FILL } from "../lib/platforms";
import { SETUP_GUIDES, redirectUri } from "../lib/setupGuides";
import { formatDistanceToNow } from "date-fns";
import { IcCheck, IcRefresh, IcAlert, IcLink, IcChevron } from "../lib/icons";
import type { Platform } from "../lib/types";

/*
 * The per-platform setup guides are operator material: creating Meta and LinkedIn
 * developer apps, redirect URIs, Cloudflare secrets. Shown to a client or an App
 * Review reviewer they make the product read as a developer tool, so the live
 * site hides them. `npm run dev` shows them; so does building with
 * VITE_SHOW_SETUP_GUIDES=true.
 */
const SHOW_SETUP_GUIDES = import.meta.env.DEV || import.meta.env.VITE_SHOW_SETUP_GUIDES === "true";

export default function Connections() {
  const dash = useDash();
  const { demo } = useDemo();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [connecting, setConnecting] = useState<Platform | null>(null);
  const [guide, setGuide] = useState<Platform | null>(null);
  const [consented, setConsented] = useState(false);
  const origin = import.meta.env.VITE_SITE_URL || window.location.origin;

  // Surface the OAuth callback result (?connected=instagram or ?error=...)
  useEffect(() => {
    const ok = params.get("connected");
    const error = params.get("error");
    // The Meta callback reports "meta" when a Page and its linked Instagram both connected.
    if (ok) {
      const label = ok === "meta" ? "Facebook and Instagram" : PLATFORMS[ok as Platform]?.name ?? ok;
      toast(`${label} connected.`);
      void dash.refresh();
    }
    if (error) toast(connectErrorMessage(error));
    if (ok || error) { params.delete("connected"); params.delete("error"); setParams(params, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(platform: Platform, kind?: "page" | "profile") {
    if (demo) { toast("This is a preview. Real accounts connect here once the app is set up."); return; }
    if (!consented) { toast("Please confirm you agree to the terms before connecting."); return; }
    if (!isConfigured) { toast("Configure Supabase first (see README)."); return; }
    setConnecting(platform);
    try {
      // Meta OAuth covers both Facebook Pages and their linked Instagram accounts.
      // The server mints the URL and sets the state cookie; the session token is
      // POSTed rather than placed in a URL where it would land in history and logs.
      // Instagram connects directly, with no linked Facebook Page required.
      // Facebook Pages still use the Meta path.
      const route = platform === "tiktok" ? "tiktok"
        : platform === "instagram" ? "instagram"
        : platform === "linkedin" ? "linkedin"
        : "meta";
      window.location.href = await startOAuth(route, platform === "linkedin" ? kind ?? "page" : undefined);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not start the connection.");
      setConnecting(null);
    }
  }

  async function disconnect(id: string, platform: Platform) {
    if (demo) { toast("Preview mode: disconnecting is disabled."); return; }
    const name = PLATFORMS[platform].name;
    /*
     * Say "revokes" only where disconnect.ts actually revokes. It does for
     * Facebook Login and TikTok; for Instagram Login and LinkedIn it deletes our
     * token and data but cannot withdraw the grant at the platform, so the client
     * is told where to do that themselves. This dialog used to promise revocation
     * for every platform, including the only one with live accounts.
     */
    const withdraw = REMOVE_AT_PLATFORM[platform];
    if (!confirm(
      `Disconnect ${name}?\n\nThis permanently deletes the metrics, posts and audience data we hold for this account, and our stored access token. It cannot be undone.`
      + (withdraw ? `\n\nTo also withdraw the permission on ${name}'s side, open ${withdraw} afterwards.` : "")
    )) return;
    try {
      toast(await disconnectAccount(id));
      void dash.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not disconnect.");
    }
  }

  const connectedByPlatform = (p: Platform) => dash.accounts.filter((a) => a.platform === p && a.status !== "revoked");

  return (
    <>
      <div className="banner" style={{ marginBottom: 4 }}>
        <IcAlert />
        <div className="bt">
          <b>Live data needs approved platform apps.</b>
          <p>Connections use official read-only OAuth: PulseBoard never sees your password, and you can revoke access at any time from the platform's own settings. Until the developer apps pass review, only accounts added as testers can connect.</p>
        </div>
      </div>

      {/* Consent is the lawful basis under Jordan's PDPL, and the server records
          the moment it is given. This is the visible half of that.
          The sentence about processing outside Jordan is what PDPL Article 15(A)(5)
          requires for a transfer abroad: consent "after informing them of the
          insufficient level of protection". Change the wording and bump
          CONSENT_VERSION in every oauth-*.ts starter, or the recorded consents stop
          describing what was agreed to. */}
      <label className="panel" style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: 14, marginBottom: 4, cursor: "pointer" }}>
        <input type="checkbox" checked={consented} onChange={(e) => setConsented(e.target.checked)} style={{ marginTop: 3 }} />
        <span style={{ fontSize: 13.5, lineHeight: 1.5 }}>
          I own or am authorised to manage the accounts I connect, and I agree that PulseBoard may read their
          analytics, including aggregated audience statistics about my followers, as described in the{" "}
          <a href="/privacy" target="_blank" rel="noreferrer">privacy policy</a> and{" "}
          <a href="/terms" target="_blank" rel="noreferrer">terms</a>. I understand this data is stored and processed
          outside Jordan, by the providers the privacy policy names, where the level of protection may be lower than
          Jordanian law requires. PulseBoard only reads, and I can withdraw at any time by disconnecting.
        </span>
      </label>

      <div className="stack" style={{ gap: 12 }}>
        {PLATFORM_ORDER.map((p) => {
          const accts = connectedByPlatform(p);
          const open = guide === p;
          return (
            <div key={p}>
              <div className="conn">
                <span className="pf" style={{ width: 40, height: 40, background: PLATFORM_FILL[p] }}>{PLATFORMS[p].icon}</span>
                <div className="meta">
                  <div className="nm">{PLATFORMS[p].name}</div>
                  {accts.length === 0 ? (
                    <div className="st">Not connected</div>
                  ) : accts.map((a) => (
                    <div className="st" key={a.id}>
                      {/*
                        * Three states, not two.
                        *
                        * "Connected" and "expired" describe a connection that is
                        * working or has already stopped. `needs_reauth` is the
                        * window between them, and it is the only one where the
                        * client can fix things with a single silent click —
                        * LinkedIn skips the consent screen while the token is
                        * still alive. Showing it as plain "Connected" wastes that
                        * window and turns a click into a support call.
                        */}
                      {a.status === "connected" && a.needs_reauth ? (
                        <span className="chip chip--warn">
                          <IcAlert style={{ width: 12, height: 12 }} />
                          Renew soon
                        </span>
                      ) : (
                        <span className={`chip ${a.status === "connected" ? "chip--ok" : "chip--warn"}`}>
                          {a.status === "connected" ? <IcCheck style={{ width: 12, height: 12 }} /> : <IcAlert style={{ width: 12, height: 12 }} />}
                          {a.status === "connected" ? "Connected" : a.status}
                        </span>
                      )}
                      <span>@{a.username}</span>
                      {p === "linkedin" && <span className="muted">· {a.auth_mode === "linkedin_member" ? "profile" : "page"}</span>}
                      {a.last_synced_at && <span className="muted">· synced {formatDistanceToNow(new Date(a.last_synced_at), { addSuffix: true })}</span>}
                      <ScopeNote platform={p} writeScopes={a.write_scopes} checkedAt={a.scopes_checked_at} member={a.auth_mode === "linkedin_member"} />
                      <button className="btn btn--sm btn--danger" style={{ marginLeft: 8, height: 24 }} onClick={() => disconnect(a.id, p)}>Disconnect</button>
                      {a.status === "connected" && a.needs_reauth && (
                        <div className="muted" style={{ flexBasis: "100%", fontSize: 11.5, marginTop: 4, lineHeight: 1.5 }}>
                          {PLATFORMS[p].name} connections expire and cannot be renewed for
                          you. Press <strong>Reconnect</strong> while this still says
                          "Renew soon" and it happens without you being asked anything.
                          Leave it and you will have to grant access again from scratch.
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                {SHOW_SETUP_GUIDES && (
                  <button className="btn btn--sm btn--ghost" aria-expanded={open} onClick={() => setGuide(open ? null : p)}>
                    <IcChevron style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                    Setup guide
                  </button>
                )}
                {p === "linkedin" ? (
                  /*
                   * Two kinds of LinkedIn connection. A Company Page needs its Super
                   * admin; a personal profile needs only the member. Same scopes
                   * either way (see LI.SCOPES), so connecting one never cancels the
                   * other.
                   */
                  <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                    <button className="btn btn--primary btn--sm" onClick={() => connect(p, "profile")} disabled={connecting === p}>
                      <IcLink /> {accts.some((a) => a.auth_mode === "linkedin_member") ? "Reconnect profile" : "Connect profile"}
                    </button>
                    <button className="btn btn--sm" onClick={() => connect(p, "page")} disabled={connecting === p}>
                      <IcLink /> {accts.some((a) => a.auth_mode !== "linkedin_member") ? "Reconnect page" : "Connect page"}
                    </button>
                  </span>
                ) : (
                  <button className="btn btn--primary btn--sm" onClick={() => connect(p)} disabled={connecting === p}>
                    <IcLink /> {accts.length ? "Reconnect" : "Connect"}
                  </button>
                )}
              </div>
              {SHOW_SETUP_GUIDES && open && <SetupPanel platform={p} origin={origin} />}
            </div>
          );
        })}
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>Your numbers refresh by themselves every 15 minutes. Use Sync if you have just posted and do not want to wait.</span>
        <button className="btn btn--sm" onClick={() => dash.sync()} disabled={dash.syncing || dash.connectedPlatforms.length === 0}>
          <IcRefresh className={dash.syncing ? "spin" : ""} /> Sync now
        </button>
      </div>

      <YourData demo={demo} />
    </>
  );
}

/**
 * What the stored token can do beyond reading, as audited.
 *
 * The OAuth callbacks have recorded this since 2026-09-07 and commented that the
 * Connections page shows it; nothing did. A creator told "read-only" whose token
 * in fact holds an inherited publish permission is exactly the claim the audit
 * exists to stop us making, so the result is shown, and "not yet checked" is
 * never shown as clean.
 */
function ScopeNote({ platform, writeScopes, checkedAt, member }: {
  platform: Platform; writeScopes?: string[] | null; checkedAt?: string | null; member?: boolean;
}) {
  const note = { flexBasis: "100%", fontSize: 11.5, marginTop: 4, lineHeight: 1.5 } as const;
  if (platform === "linkedin") {
    return (
      <div className="muted" style={note}>
        {member
          ? "Your follower count and how your posts perform in total. LinkedIn does not let apps list a personal profile's posts or report who your followers are. The page-management permission LinkedIn also shows is requested so that connecting a page later does not disconnect this; PulseBoard only ever reads."
          : "LinkedIn's reporting permission also allows managing the page. PulseBoard only ever reads."}
      </div>
    );
  }
  if (platform !== "instagram") return null;
  if (!checkedAt) {
    return <div className="muted" style={note}>Permissions not checked yet. This happens on the next sync.</div>;
  }
  if (writeScopes && writeScopes.length) {
    return (
      <div style={{ ...note, color: "var(--warn, #b45309)" }}>
        This connection holds more than read access, granted by this account at some earlier point. PulseBoard never
        uses it. To remove it: {REMOVE_AT_PLATFORM.instagram}.
      </div>
    );
  }
  return <div className="muted" style={note}>Checked: this connection can read, and nothing else.</div>;
}

/**
 * Where a client withdraws the grant themselves, for the platforms whose
 * disconnect cannot revoke it (see disconnect.ts). Absent means we revoke.
 */
const REMOVE_AT_PLATFORM: Partial<Record<Platform, string>> = {
  instagram: "Instagram → Settings and activity → Website permissions → Apps and websites",
  linkedin: "LinkedIn → Settings & Privacy → Data privacy → Permitted services",
};

/**
 * The self-service data rights the privacy policy names.
 *
 * `/api/account-data` has served both since 2026-08-24, and the policy has told
 * people to use "Export my data" and "Delete my account" since then, but no
 * button calling either was ever rendered: the functions were imported here and
 * never used. A reviewer following the policy found nothing to press.
 */
function YourData({ demo }: { demo: boolean }) {
  const toast = useToast();
  const { signOut } = useAuth();
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);

  async function doExport() {
    if (demo) { toast("Preview mode: there is no data of yours to export."); return; }
    setBusy("export");
    try { await exportMyData(); }
    catch (e) { toast(e instanceof Error ? e.message : "Could not build your export."); }
    finally { setBusy(null); }
  }

  async function doDelete() {
    if (demo) { toast("Preview mode: deleting is disabled."); return; }
    if (!confirm(
      "Delete your PulseBoard account?\n\nEvery connected account, metric, post, audience breakdown, goal, report link and consent record is deleted, then your sign-in. It cannot be undone."
    )) return;
    setBusy("delete");
    try {
      // The server's own message, not a fixed one: it differs when the sign-in record survived.
      const { message, code } = await deleteMyAccount();
      alert(`${message}\n\nConfirmation code: ${code}`);
      await signOut();
    } catch (e) {
      // A failed erasure keeps the sign-in on purpose, so the message says to retry.
      toast(e instanceof Error ? e.message : "Could not delete your account.");
      setBusy(null);
    }
  }

  return (
    <div className="panel" style={{ marginTop: 20 }}>
      <div className="panel__body stack" style={{ gap: 10 }}>
        <b style={{ fontSize: 13.5 }}>Your data</b>
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>
          Download everything PulseBoard holds about you as a file, or delete your account and all of it.
          See the <a href="/privacy" target="_blank" rel="noreferrer">privacy policy</a>.
        </p>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn--sm" onClick={doExport} disabled={busy !== null}>
            {busy === "export" ? "Preparing…" : "Export my data"}
          </button>
          <button className="btn btn--sm btn--danger" onClick={doDelete} disabled={busy !== null}>
            {busy === "delete" ? "Deleting…" : "Delete my account"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Inline connection manual for one platform. */
function SetupPanel({ platform, origin }: { platform: Platform; origin: string }) {
  const g = SETUP_GUIDES[platform];
  const uri = redirectUri(platform, origin);

  return (
    <div className="panel" style={{ marginTop: 8 }}>
      <div className="panel__body stack" style={{ gap: 16 }}>
        <p className="muted" style={{ margin: 0, fontSize: 12.5, lineHeight: 1.55 }}>{g.summary}</p>

        <div className="stack" style={{ gap: 6 }}>
          <b style={{ fontSize: 12.5 }}>Before you start</b>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
            {g.requires.map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <b style={{ fontSize: 12.5 }}>Steps</b>
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, lineHeight: 1.7 }}>
            {g.steps.map((s, i) => (
              <li key={i}>
                {s.text}
                {s.link && (
                  <> <a href={s.link.href} target="_blank" rel="noreferrer"
                    style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>{s.link.label}</a>
</>
                )}
              </li>
            ))}
          </ol>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <b style={{ fontSize: 12.5 }}>Redirect URI</b>
          <code style={{ fontSize: 12, padding: "7px 10px", borderRadius: 6, background: "var(--panel-sunk)", wordBreak: "break-all" }}>{uri}</code>
          <span className="muted" style={{ fontSize: 11.5 }}>Must match exactly, including protocol and path.</span>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <b style={{ fontSize: 12.5 }}>Environment variables</b>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {g.env.map((e) => (
              <code key={e} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, background: "var(--panel-sunk)" }}>{e}</code>
            ))}
          </div>
          <span className="muted" style={{ fontSize: 11.5 }}>
            Set these in <code>.env.local</code> for local dev and, for production, as Cloudflare secrets — Workers &amp; Pages → the project → Settings → Variables and Secrets.
          </span>
        </div>

        {g.notes.map((n) => (
          <div className="banner" key={n} style={{ background: "var(--panel-sunk)" }}>
            <IcAlert />
            <div className="bt"><p style={{ margin: 0 }}>{n}</p></div>
          </div>
        ))}
      </div>
    </div>
  );
}
