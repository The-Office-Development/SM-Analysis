import { useEffect, useRef, useState } from "react";
import { useDash } from "../context/DashboardContext";
import { RANGE_PRESETS, RANGE_MIN, RANGE_MAX, clampRange } from "../lib/types";

/**
 * The date-range control: three common windows and a custom one.
 *
 * WHY A CUSTOM WINDOW AT ALL
 *
 * 7, 30 and 90 cannot express the case this product is sold on. A campaign runs
 * for eleven days, and reporting on a paid campaign over a window that does not
 * match what was paid for is exactly the detail a sponsor notices.
 *
 * WHY IT IS SHAPED LIKE THIS
 *
 * The first version was a bare number field and an Apply button, and it was not
 * usable. Two reasons, and the second is the more important:
 *
 *  - It borrowed the `.pop` menu styles, whose `button{width:100%}` stretched
 *    Apply across the row and left the number field showing nothing but its
 *    spinner arrows.
 *  - More basically, "type a number of days" is not how anyone thinks about a
 *    date range. Somebody wanting the last six months should not have to work
 *    out that it is 180.
 *
 * So the common answers are one click, the field is there for the rest, and the
 * actual dates are printed underneath. A window stated as "45" is abstract; the
 * same window stated as "27 Jul to 10 Sep" is something a client can check
 * against their own calendar, which is the whole point of letting them choose.
 */

/** One click each. Days, chosen to read as periods people actually ask for. */
const QUICK = [
  { days: 14, label: "2 weeks" },
  { days: 60, label: "2 months" },
  { days: 180, label: "6 months" },
  { days: 365, label: "1 year" },
] as const;

const fmt = (d: Date) =>
  d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** The window a day count actually covers, so the reader can check it. */
function windowLabel(days: number): string {
  const to = new Date();
  const from = new Date(to.getTime() - (days - 1) * 86_400_000);
  return `${fmt(from)} to ${fmt(to)}`;
}

export default function RangePicker() {
  const dash = useDash();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(String(dash.range));
  const inputRef = useRef<HTMLInputElement | null>(null);

  const isPreset = (RANGE_PRESETS as readonly number[]).includes(dash.range);

  useEffect(() => {
    if (!open) return;
    setDraft(String(dash.range));
    // Select the existing value rather than just focusing, so typing replaces it
    // instead of appending to it — "30" plus a typed "7" is otherwise 307.
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [open, dash.range]);

  function commit(days: number) {
    dash.setRange(days);
    setDraft(String(days));
    setOpen(false);
  }

  function apply() {
    /*
     * A blank field changes nothing.
     *
     * `<input type="number">` silently blanks itself when what was typed is not
     * a number, so "abc" arrives here as "". Number("") is 0, which would clamp
     * to a one-day window — a dashboard emptying itself because somebody
     * mistyped. Closing untouched is the only reading that is not a surprise.
     */
    if (draft.trim() === "") { setOpen(false); return; }
    commit(clampRange(Number(draft)));
  }

  // What the field currently describes, clamped, for the live preview below it.
  const previewDays = draft.trim() === "" ? dash.range : clampRange(Number(draft));

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
                title="Choose your own date range">
          {isPreset ? "Custom" : `${dash.range}D`}
        </button>
      </div>

      {open && (
        <>
          <div style={{ position: "fixed", inset: 0, zIndex: 55 }} onClick={() => setOpen(false)} />
          <div className="rangepop" role="dialog" aria-label="Custom date range" style={{ top: 34, right: 0 }}>
            <div className="quick">
              {QUICK.map((q) => (
                <button key={q.days} aria-pressed={dash.range === q.days}
                        onClick={() => commit(q.days)} title={`${q.days} days`}>
                  {q.label}
                </button>
              ))}
            </div>

            <label htmlFor="range-days"
                   style={{ fontSize: 12, fontWeight: 550, display: "block", marginBottom: 6 }}>
              Or a number of days
            </label>
            <div className="entry">
              <input id="range-days" ref={inputRef} className="input"
                     type="number" inputMode="numeric"
                     min={RANGE_MIN} max={RANGE_MAX} value={draft}
                     onChange={(e) => setDraft(e.target.value)}
                     onKeyDown={(e) => {
                       if (e.key === "Enter") apply();
                       if (e.key === "Escape") setOpen(false);
                     }} />
              <button className="btn btn--sm btn--primary" onClick={apply}>Apply</button>
            </div>

            {/* The dates, not the arithmetic. This is the line that makes the
                control checkable against a client's own calendar. */}
            <p className="muted" style={{ margin: "8px 0 0", fontSize: 11.5, lineHeight: 1.5 }}>
              {windowLabel(previewDays)}
            </p>
            <p className="muted" style={{ margin: "4px 0 0", fontSize: 11, lineHeight: 1.5 }}>
              Up to {RANGE_MAX} days. Days not collected yet appear blank, not as zero.
            </p>
          </div>
        </>
      )}
    </span>
  );
}
