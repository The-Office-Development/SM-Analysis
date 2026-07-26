import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { useDemo } from "../context/DemoContext";
import { useToast } from "../context/ToastContext";
import { supabase, isConfigured } from "../lib/supabase";
import { PLATFORMS, PLATFORM_ORDER, PLATFORM_FILL } from "../lib/platforms";
import { SETUP_GUIDES, redirectUri } from "../lib/setupGuides";
import { formatDistanceToNow } from "date-fns";
import { IcCheck, IcRefresh, IcAlert, IcLink, IcChevron } from "../lib/icons";
import type { Platform } from "../lib/types";

export default function Connections() {
  const dash = useDash();
  const { demo } = useDemo();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [connecting, setConnecting] = useState<Platform | null>(null);
  const [guide, setGuide] = useState<Platform | null>(null);
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
    if (error) toast(`Connection failed: ${error}`);
    if (ok || error) { params.delete("connected"); params.delete("error"); setParams(params, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function connect(platform: Platform) {
    if (demo) { toast("This is a preview. Real accounts connect here once the app is set up."); return; }
    if (!isConfigured) { toast("Configure Supabase first (see README)."); return; }
    setConnecting(platform);
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { toast("Please sign in again."); setConnecting(null); return; }
    // Meta OAuth covers both Facebook Pages and their linked Instagram accounts.
    const fn = platform === "tiktok" ? "oauth-tiktok" : "oauth-meta";
    window.location.href = `/api/${fn}?token=${encodeURIComponent(session.access_token)}`;
  }

  async function disconnect(id: string, name: string) {
    if (demo) { toast("Preview mode: disconnecting is disabled."); return; }
    if (!confirm(`Disconnect ${name}? Historical data is kept; syncing stops.`)) return;
    const { error } = await supabase.from("social_accounts").update({ status: "revoked" }).eq("id", id);
    if (error) toast(error.message);
    else { toast(`${name} disconnected.`); void dash.refresh(); }
  }

  const connectedByPlatform = (p: Platform) => dash.accounts.filter((a) => a.platform === p && a.status !== "revoked");

  return (
    <>
      <div className="banner" style={{ marginBottom: 4 }}>
        <IcAlert />
        <div className="bt">
          <b>Live data needs approved platform apps.</b>
          <p>Connections use official OAuth. Until your Meta and TikTok developer apps pass review and the backend keys are set, the connect buttons will return an auth error — that’s expected. See the README for the full setup.</p>
        </div>
      </div>

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
                      <span className={`chip ${a.status === "connected" ? "chip--ok" : "chip--warn"}`}>
                        {a.status === "connected" ? <IcCheck style={{ width: 12, height: 12 }} /> : <IcAlert style={{ width: 12, height: 12 }} />}
                        {a.status === "connected" ? "Connected" : a.status}
                      </span>
                      <span>@{a.username}</span>
                      {a.last_synced_at && <span className="muted">· synced {formatDistanceToNow(new Date(a.last_synced_at), { addSuffix: true })}</span>}
                      <button className="btn btn--sm btn--danger" style={{ marginLeft: 8, height: 24 }} onClick={() => disconnect(a.id, PLATFORMS[p].name)}>Disconnect</button>
                    </div>
                  ))}
                </div>
                <button className="btn btn--sm btn--ghost" aria-expanded={open} onClick={() => setGuide(open ? null : p)}>
                  <IcChevron style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform .15s" }} />
                  Setup guide
                </button>
                <button className="btn btn--primary btn--sm" onClick={() => connect(p)} disabled={connecting === p}>
                  <IcLink /> {accts.length ? "Reconnect" : "Connect"}
                </button>
              </div>
              {open && <SetupPanel platform={p} origin={origin} />}
            </div>
          );
        })}
      </div>

      <div className="row" style={{ justifyContent: "space-between", marginTop: 8 }}>
        <span className="muted" style={{ fontSize: 12.5 }}>Data refreshes on sync. Automatic daily sync runs server-side once deployed.</span>
        <button className="btn btn--sm" onClick={() => dash.sync()} disabled={dash.syncing || dash.connectedPlatforms.length === 0}>
          <IcRefresh className={dash.syncing ? "spin" : ""} /> Sync now
        </button>
      </div>
    </>
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
                    style={{ textDecoration: "underline", textUnderlineOffset: 2 }}>{s.link.label}</a></>
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
            Set these in <code>.env.local</code> for local dev and in Netlify → Site configuration → Environment variables for production.
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
