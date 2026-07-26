/** Guards against NaN/±Infinity reaching the DOM (e.g. from a 0 denominator). */
function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

/** part/whole as a percentage, 0 when the denominator is 0 or the result isn't finite. */
export function ratioPct(part: number, whole: number): number {
  return whole ? finite((part / whole) * 100) : 0;
}

export function compact(n: number): string {
  const v = finite(n);
  const a = Math.abs(v);
  if (a >= 1e9) return trim(v / 1e9) + "B";
  if (a >= 1e6) return trim(v / 1e6) + "M";
  if (a >= 1e3) return trim(v / 1e3, a >= 1e4 ? 0 : 1) + "K";
  return Math.round(v).toLocaleString("en-US");
}
function trim(n: number, d = 1): string {
  return n.toFixed(d).replace(/\.0+$/, "");
}
export function full(n: number): string {
  return Math.round(finite(n)).toLocaleString("en-US");
}
export function pct(n: number, digits = 1): string {
  const v = finite(n);
  return (v >= 0 ? "+" : "") + v.toFixed(digits) + "%";
}
export function pctPlain(n: number, digits = 1): string {
  return finite(n).toFixed(digits) + "%";
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function shortDate(d: Date | string): string {
  const x = typeof d === "string" ? new Date(d) : d;
  return `${MON[x.getMonth()]} ${x.getDate()}`;
}
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}
