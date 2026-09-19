import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

/**
 * Place a popover just below its trigger, positioned against the SCREEN and
 * kept inside it.
 *
 * On phones the top bar's controls live in a strip that scrolls sideways
 * (`.topbar__tools`, overflow-x: auto), and a scrolling box clips anything that
 * pops out of it. Absolutely positioned, the platform picker and the custom
 * date range both opened into that clip and showed nothing at all: measured
 * 2026-09-19, the menu existed at the right coordinates and nothing was drawn
 * there. `position: fixed` escapes the clip.
 *
 * Fixed alone was not enough: right-aligned to a trigger left of centre, the
 * date popover hung off the left edge. So it is measured before paint and
 * clamped between the screen edges; it is hidden for that one pre-paint pass
 * so it never flashes in the wrong place.
 */
export function useAnchored<T extends HTMLElement>(open: boolean, trigger: RefObject<HTMLElement>, gap = 6) {
  const ref = useRef<T>(null);
  const [style, setStyle] = useState<CSSProperties>({ position: "fixed", visibility: "hidden" });
  useLayoutEffect(() => {
    if (!open) { setStyle({ position: "fixed", visibility: "hidden" }); return; }
    const t = trigger.current, el = ref.current;
    if (!t || !el) return;
    const r = t.getBoundingClientRect();
    const w = el.offsetWidth, vw = window.innerWidth, edge = 8;
    const left = Math.max(edge, Math.min(r.right - w, vw - w - edge));
    setStyle({ position: "fixed", top: r.bottom + gap, left });
  }, [open, trigger, gap]);
  return { ref, style };
}
