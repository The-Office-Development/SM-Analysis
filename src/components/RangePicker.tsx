import { useEffect, useRef, useState } from "react";
import { useDash } from "../context/DashboardContext";
import { RANGE_PRESETS, RANGE_MIN, RANGE_MAX, clampRange } from "../lib/types";

/**
 * The date-range control: three common windows and a custom one.
 *
 * The presets cover most days, but they cannot cover the case the product is
 * actually sold on. A campaign runs for eleven days, or from the first of the
 * month to the twenty-third, and neither rounds to 7, 30 or 90. Reporting on a
 * paid campaign with a window that does not match what was paid for is the kind
 * of detail a sponsor notices, so the window has to be the client's to choose.
 *
 * It stays a NUMBER OF DAYS rather than a pair of dates. Every query, every
 * export heading and the whole comparison layer is built on "the last N days",
 * and a from/to pair would change all of them while giving a creator asking
 * "how did the last three weeks go?" nothing extra.
 *
 * The value is clamped on the way in. A blank field, a pasted word or 99999 all
 * resolve to something the API can actually answer, because the alternative is
 * a query for a window Meta will not serve and an empty dashboard that looks
 * like lost data.
 */
export default function RangePicker() {
  const dash = useDash();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(dash.range));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isPreset = (RANGE_PRESETS as readonly number[]).includes(dash.range);

  // Focus the field when the popover opens: it exists to be typed into, and a
  // control that needs a second click to accept input reads as broken.
  useEffect(() => {
    if (open) inputRef.current?.focus();
    if (open) setDraft(String(dash.range));
  }, [open, dash.range]);

  function apply() {
    /*
     * A blank field changes nothing.
     *
     * `<input type="number">` silently blanks itself when what was typed is not
     * a number, so "abc" arrives here as "". Number("") is 0, which would clamp
     * to a one-day window — a dashboard that empties itself because somebody
     * mistyped. Closing untouched is the only reading that is not a surprise.
     */
    if (draft.trim() === "") { setOpen(false); return; }
    const days = clampRange(Number(draft));
    dash.setRange(days);
    setDraft(String(days));
    setOpen(false);
  }

  return (
    <span className="menu-anchor" style={{ display: "inline-flex" }}>
      <div className="seg" role="group" aria-label="Date range">
        {RANGE_PRESETS.map((r) => (
          <button key={r} aria-pressed={dash.range === r}
                  onClick={() => { setOpen(false); dash.setRange(r); }}>
            {r}D
          </button>
        ))}
        {/*
          * The custom button doubles as the readout. When a custom window is
          * active it shows the number, so the range in force is always visible
          * without opening anything — a dashboard whose window is a mystery
          * invites every figure on it to be misread.
          */}
        <button aria-pressed={!isPreset} aria-haspopup="dialog" aria-expanded={open}
                onClick={() => setOpen((v) => !v)}
                title="Choose your own window">
          {isPreset ? "Custom" : `${dash.range}D`}
        </button>
      </div>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setOpen(false)} />
          <div className="pop" role="dialog" aria-label="Custom date range"
               style={{ top: 34, right: 0, minWidth: 232, padding: 12 }}>
            <label htmlFor="range-days" style={{ fontSize: 12, fontWeight: 550, display: "block", marginBottom: 6 }}>
              Number of days
            </label>
            <div className="row" style={{ gap: 6 }}>
              <input id="range-days" ref={inputRef} type="number" inputMode="numeric"
                     min={RANGE_MIN} max={RANGE_MAX} value={draft}
                     onChange={(e) => setDraft(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === "Enter") apply();
                       if (e.key === "Escape") setOpen(false);
                     }}
                     style={{
                       flex: 1, minWidth: 0, height: 30, padding: "0 8px", fontSize: 13,
                       borderRadius: 6, border: "1px solid var(--border-strong)",
                       background: "var(--panel)", color: "var(--text)",
                     }} />
              <button className="btn btn--sm btn--primary" onClick={apply}>Apply</button>
            </div>
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 11, lineHeight: 1.5 }}>
              Counts back from today, in your own time. Anything from {RANGE_MIN} to{" "}
              {RANGE_MAX} days. Days that have not been collected yet appear blank
              rather than as zero.
            </p>
          </div>
        </>
      )}
    </span>
  );
}
