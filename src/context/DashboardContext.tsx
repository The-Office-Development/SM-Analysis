import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import type { SocialAccount, MetricPoint, ContentItem, AudienceSnapshot, Platform, Range, Scope } from "../lib/types";
import { PLATFORM_ORDER } from "../lib/platforms";
import { fetchAccounts, fetchMetrics, fetchContent, fetchAudience, triggerSync } from "../lib/api";
import { useToast } from "./ToastContext";

interface DashState {
  range: Range;
  scope: Scope;
  setRange: (r: Range) => void;
  setScope: (s: Scope) => void;
  accounts: SocialAccount[];
  metrics: MetricPoint[];
  content: ContentItem[];
  audience: AudienceSnapshot[];
  connectedPlatforms: Platform[];
  hasData: boolean;
  loading: boolean;
  error: string | null;
  syncing: boolean;
  refresh: () => Promise<void>;
  sync: () => Promise<void>;
}

const Ctx = createContext<DashState | undefined>(undefined);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [range, setRange] = useState<Range>(30);
  const [scope, setScope] = useState<Scope>("all");
  const [accounts, setAccounts] = useState<SocialAccount[]>([]);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [audience, setAudience] = useState<AudienceSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const load = useCallback(async (r: Range) => {
    setLoading(true);
    setError(null);
    try {
      const [acc, met, con, aud] = await Promise.all([
        fetchAccounts(), fetchMetrics(r), fetchContent(r), fetchAudience(),
      ]);
      setAccounts(acc);
      setMetrics(met);
      setContent(con);
      setAudience(aud);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(range); }, [range, load]);

  const refresh = useCallback(async () => { await load(range); }, [load, range]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await triggerSync();
      toast(res.message);
      if (res.ok) await load(range);
    } finally {
      setSyncing(false);
    }
  }, [load, range, toast]);

  const connectedPlatforms = PLATFORM_ORDER.filter(
    (p) => accounts.some((a) => a.platform === p && a.status === "connected")
  );
  const scopePlatforms: Platform[] = scope === "all" ? connectedPlatforms : [scope];
  const hasData = metrics.length > 0 && scopePlatforms.some((p) => metrics.some((m) => m.platform === p));

  return (
    <Ctx.Provider value={{
      range, scope, setRange, setScope, accounts, metrics, content, audience,
      connectedPlatforms, hasData, loading, error, syncing, refresh, sync,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useDash(): DashState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDash must be used within DashboardProvider");
  return v;
}
