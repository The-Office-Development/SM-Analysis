import { useEffect, useMemo, useRef, useState, type ComponentType, type SVGProps } from "react";
import { useNavigate } from "react-router-dom";
import { useDash } from "../context/DashboardContext";
import { useAuth } from "../context/AuthContext";
import { PLATFORMS } from "../lib/platforms";
import { exportCsv, exportXlsx } from "../lib/reports";
import { toggleTheme } from "../lib/theme";
import type { Range, Scope } from "../lib/types";
import {
  IcOverview, IcContent, IcAudience, IcPlatforms, IcLink, IcCalendar, IcMessage,
  IcRefresh, IcDownload, IcSun, IcLogout, IcCornerReturn, IcSearch, IcArrowRight, IcFile,
} from "../lib/icons";

type Ic = ComponentType<SVGProps<SVGSVGElement>>;
interface Cmd { id: string; group: string; label: string; hint?: string; Icon: Ic; run: () => void; keywords?: string; }

export default function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const nav = useNavigate();
  const dash = useDash();
  const { signOut } = useAuth();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setOpen((o) => !o); }
      else if (e.key === "Escape") setOpen(false);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pb-open-cmdk", onOpen);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("pb-open-cmdk", onOpen); };
  }, []);

  useEffect(() => { if (open) { setQ(""); setI(0); setTimeout(() => inputRef.current?.focus(), 20); } }, [open]);
  useEffect(() => { setI(0); }, [q]);

  const cmds = useMemo<Cmd[]>(() => {
    const close = () => setOpen(false);
    const go = (to: string) => () => { nav(to); close(); };
    const list: Cmd[] = [
      { id: "nav-overview", group: "Go to", label: "Overview", Icon: IcOverview, run: go("/") },
      { id: "nav-content", group: "Go to", label: "Content", Icon: IcContent, run: go("/content") },
      { id: "nav-audience", group: "Go to", label: "Audience", Icon: IcAudience, run: go("/audience") },
      { id: "nav-platforms", group: "Go to", label: "Platforms", Icon: IcPlatforms, run: go("/platforms") },
      { id: "nav-planner", group: "Go to", label: "Planner", Icon: IcCalendar, run: go("/planner"), keywords: "best time goals alerts schedule" },
      { id: "nav-assistant", group: "Go to", label: "Assistant", Icon: IcMessage, run: go("/assistant"), keywords: "ai chat insights ask why" },
      { id: "nav-reports", group: "Go to", label: "Reports", Icon: IcFile, run: go("/reports"), keywords: "pdf print export share link" },
      { id: "nav-conn", group: "Go to", label: "Connections", Icon: IcLink, run: go("/connections") },
      { id: "sync", group: "Actions", label: "Sync now", Icon: IcRefresh, hint: "pull latest", run: () => { void dash.sync(); close(); }, keywords: "refresh update fetch" },
      { id: "export", group: "Actions", label: "Download the report (Excel)", Icon: IcDownload, run: () => { exportXlsx(dash); close(); }, keywords: "download report xlsx excel spreadsheet" },
      { id: "export-csv", group: "Actions", label: "Download raw data (CSV)", Icon: IcDownload, run: () => { exportCsv(dash); close(); }, keywords: "download csv raw data" },
      { id: "theme", group: "Actions", label: "Toggle theme", Icon: IcSun, run: () => { toggleTheme(); close(); }, keywords: "dark light mode" },
      { id: "signout", group: "Actions", label: "Sign out", Icon: IcLogout, run: () => { void signOut(); } },
      ...[7, 30, 90].map((r) => ({ id: `range-${r}`, group: "Set range", label: `Last ${r} days`, Icon: IcCalendar as Ic, run: () => { dash.setRange(r as Range); setOpen(false); } })),
      { id: "scope-all", group: "Set scope", label: "All platforms", Icon: IcPlatforms, run: () => { dash.setScope("all"); setOpen(false); } },
      ...dash.connectedPlatforms.map((p) => ({ id: `scope-${p}`, group: "Set scope", label: PLATFORMS[p].name, Icon: IcPlatforms as Ic, run: () => { dash.setScope(p as Scope); setOpen(false); } })),
    ];
    const ql = q.trim().toLowerCase();
    if (ql) {
      dash.content.filter((c) => c.title.toLowerCase().includes(ql)).slice(0, 5).forEach((c) => {
        list.push({
          id: `c-${c.id}`, group: "Content", label: c.title || "(untitled post)", hint: PLATFORMS[c.platform].name, Icon: IcContent,
          run: () => { if (c.permalink) window.open(c.permalink, "_blank", "noopener"); else nav("/content"); setOpen(false); }, keywords: "post video open",
        });
      });
    }
    return list;
  }, [nav, dash, signOut, q]);

  const filtered = useMemo(() => {
    const ql = q.trim().toLowerCase();
    if (!ql) return cmds;
    return cmds.filter((c) => c.group === "Content" || (c.label + " " + c.group + " " + (c.keywords ?? "")).toLowerCase().includes(ql));
  }, [cmds, q]);

  const groups = [...new Set(filtered.map((c) => c.group))];
  const ordered = groups.flatMap((g) => filtered.filter((c) => c.group === g));

  if (!open) return null;

  return (
    <div className="cmdk-overlay" onClick={() => setOpen(false)}>
      <div className="cmdk" role="dialog" aria-label="Command palette" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setI((v) => Math.min(v + 1, ordered.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setI((v) => Math.max(v - 1, 0)); }
          else if (e.key === "Enter") { e.preventDefault(); ordered[i]?.run(); }
        }}>
        <div className="cmdk__search">
          <IcSearch />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search or jump to…" aria-label="Command search" />
          <kbd>esc</kbd>
        </div>
        <div className="cmdk__list">
          {ordered.length === 0 && <div className="cmdk__empty">No matches for “{q}”.</div>}
          {groups.map((g) => (
            <div key={g}>
              <div className="cmdk__group">{g}</div>
              {filtered.filter((c) => c.group === g).map((c) => {
                const pos = ordered.indexOf(c);
                const active = pos === i;
                return (
                  <button key={c.id} className={"cmdk__item" + (active ? " active" : "")}
                    onMouseMove={() => setI(pos)} onClick={() => c.run()}>
                    <c.Icon /><span className="cmdk__label">{c.label}</span>
                    {c.hint && <span className="cmdk__hint">{c.hint}</span>}
                    <IcArrowRight className="cmdk__go" />
                  </button>
                );
              })}
            </div>
          ))}
        </div>
        <div className="cmdk__foot">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd className="kbd-ic"><IcCornerReturn /></kbd> select</span>
          <span className="spacer" />
          <span className="mono">⌘K</span>
        </div>
      </div>
    </div>
  );
}
