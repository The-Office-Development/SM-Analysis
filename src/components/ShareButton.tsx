import { useState } from "react";
import { useToast } from "../context/ToastContext";
import { createShare } from "../lib/api";
import { IcLink, IcCheck } from "../lib/icons";
import type { ReportSnapshot } from "../lib/snapshot";

/**
 * How long a shared link lives.
 *
 * The default is 30 days rather than "never". A link is a public URL holding a
 * client's figures, usually sent to a sponsor for one campaign, and a default
 * that never ends means every report ever sent stays readable by anyone who
 * kept the address. Thirty days covers the conversation the report is for.
 *
 * "No expiry" stays available, because a media kit someone links to
 * permanently is a real use, and every link made before 2026-09-19 is that.
 */
const EXPIRY_CHOICES: { label: string; days: number | null }[] = [
  { label: "7 days", days: 7 },
  { label: "30 days", days: 30 },
  { label: "90 days", days: 90 },
  { label: "No expiry", days: null },
];

const dateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export default function ShareButton({ snap }: { snap: ReportSnapshot }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [days, setDays] = useState<number | null>(30);

  async function share() {
    if (busy) return;
    setBusy(true);
    try {
      const { url, expires_at } = await createShare(snap, days);
      // Say what was created, not just that something was. The expiry is the
      // part the person will need to remember when the sponsor asks in March.
      const until = expires_at ? ` It stops working on ${dateLabel(expires_at)}.` : " It does not expire.";
      try {
        await navigator.clipboard.writeText(url);
        toast(`Read-only link copied.${until}`);
      } catch {
        toast(url);
      }
      setDone(true);
      setTimeout(() => setDone(false), 2500);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not create a share link.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
      <select
        className="input input--sm"
        aria-label="How long the shared link works for"
        value={days === null ? "never" : String(days)}
        onChange={(e) => setDays(e.target.value === "never" ? null : Number(e.target.value))}
        disabled={busy}
      >
        {EXPIRY_CHOICES.map((c) => (
          <option key={c.label} value={c.days === null ? "never" : String(c.days)}>{c.label}</option>
        ))}
      </select>
      <button className="btn btn--sm" onClick={share} disabled={busy}>
        {done ? <IcCheck style={{ width: 15, height: 15 }} /> : <IcLink style={{ width: 15, height: 15 }} />}
        {busy ? "Creating…" : done ? "Copied" : "Share link"}
      </button>
    </span>
  );
}
