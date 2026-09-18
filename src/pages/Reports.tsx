import { Link } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import { useDash } from "../context/DashboardContext";
import { useDemo } from "../context/DemoContext";
import { useToast } from "../context/ToastContext";
import { fetchShares, revokeShare, type ShareLink } from "../lib/api";
import { formatDistanceToNow } from "date-fns";
import { PLATFORMS } from "../lib/platforms";
import ExportMenu from "../components/ExportMenu";
import { buildSnapshot } from "../lib/snapshot";
import EmptyState from "../components/EmptyState";
import ReportSheet from "../components/ReportSheet";
import ShareButton from "../components/ShareButton";
import { IcPlug } from "../lib/icons";
import type { Platform } from "../lib/types";

export default function Reports() {
  const dash = useDash();
  const snap = useMemo(
    () => (dash.connectedPlatforms.length ? buildSnapshot(dash) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dash.metrics, dash.content, dash.audience, dash.range, dash.scope, dash.connectedPlatforms],
  );

  if (dash.loading) return <div className="panel" style={{ height: 240 }}><div className="panel__body"><div className="sk" style={{ height: 200 }} /></div></div>;
  if (!snap)
    return <div className="panel"><EmptyState icon={<IcPlug />} title="Connect an account first"
      action={<Link className="btn btn--primary" to="/connections">Go to Connections</Link>}>
      Reports are generated from your real synced data. Connect a platform to produce one.
    </EmptyState></div>;

  const scopeLabel = dash.scope === "all" ? "All platforms" : PLATFORMS[dash.scope as Platform].name;

  return (
    <div className="report">
      <div className="report__bar">
        <div>
          <h2 style={{ margin: 0, fontSize: 17 }}>Performance report</h2>
          <p className="muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>{scopeLabel} · last {dash.range} days</p>
        </div>
        <div className="row" style={{ gap: 8 }}>
          <ShareButton snap={snap} />
          <ExportMenu dash={dash} />
        </div>
      </div>

      <ReportSheet snap={snap} />
      <SharedLinks />
    </div>
  );
}

/**
 * What this account has published, and how to take it back.
 *
 * A share link is a public URL holding a client's figures. Until 2026-09-19 the
 * product could create one and nothing else: no list, no expiry, no way to
 * withdraw it. The privacy policy had to tell people to "treat one as public
 * once you have sent it", which described the product rather than a control
 * they had.
 *
 * Revoking DELETES the row, so the snapshot itself stops existing rather than
 * being hidden behind a flag that still holds the figures.
 */
function SharedLinks() {
  const toast = useToast();
  const { demo } = useDemo();
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (demo) { setLinks([]); return; }
    fetchShares().then(setLinks).catch(() => setLinks([]));
  }, [demo]);

  async function revoke(slug: string) {
    if (!window.confirm("Revoke this link?\n\nAnyone holding the address will stop being able to open it, including people you have already sent it to. This cannot be undone.")) return;
    setBusy(slug);
    try {
      await revokeShare(slug);
      setLinks((ls) => (ls ?? []).filter((l) => l.slug !== slug));
      toast("Link revoked. It no longer opens for anyone.");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not revoke that link.");
    } finally { setBusy(null); }
  }

  if (!links?.length) return null;

  const expiryNote = (l: ShareLink) => {
    if (!l.expires_at) return "does not expire";
    const t = new Date(l.expires_at).getTime();
    // An expired row can still be listed: nothing deletes it, and the owner is
    // entitled to know it exists until they clear it.
    return t <= Date.now()
      ? "expired"
      : `expires ${formatDistanceToNow(new Date(l.expires_at), { addSuffix: true })}`;
  };

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div className="panel__head">
        <h3 style={{ margin: 0, fontSize: 14 }}>Links you have shared</h3>
        <span className="muted" style={{ fontSize: 12 }}>{links.length} link{links.length === 1 ? "" : "s"}</span>
      </div>
      <div className="panel__body" style={{ display: "grid", gap: 8 }}>
        {links.map((l) => (
          <div key={l.slug} className="row" style={{ justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, minWidth: 0 }}>
              <code style={{ fontSize: 12 }}>/r/{l.slug}</code>
              <span className="muted"> · created {formatDistanceToNow(new Date(l.created_at), { addSuffix: true })} · {expiryNote(l)}</span>
            </span>
            <span className="row" style={{ gap: 6 }}>
              <button
                className="btn btn--sm"
                onClick={() => {
                  const url = `${import.meta.env.VITE_SITE_URL || window.location.origin}/r/${l.slug}`;
                  navigator.clipboard.writeText(url).then(() => toast("Link copied."), () => toast(url));
                }}
              >Copy</button>
              <button className="btn btn--sm btn--danger" disabled={busy === l.slug} onClick={() => void revoke(l.slug)}>
                {busy === l.slug ? "Revoking…" : "Revoke"}
              </button>
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

