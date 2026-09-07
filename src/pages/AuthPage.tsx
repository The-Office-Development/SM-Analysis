import { useState } from "react";
import { useAuth } from "../context/AuthContext";
import { useDemo } from "../context/DemoContext";
import { isConfigured } from "../lib/supabase";
import { IcCheck } from "../lib/icons";

const POINTS = [
  "Facebook, Instagram and TikTok in one place",
  "Follower, reach and engagement trends over time",
  "Per-post breakdowns with watch time and retention",
  "Audience demographics and best time to post",
];

export default function AuthPage() {
  const { signIn, signUp } = useAuth();
  const { enter } = useDemo();
  const [mode, setMode] = useState<"in" | "up">("in");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null); setNotice(null);
    if (!isConfigured) {
      setErr("Supabase isn't configured yet. Add your project keys to the environment (see README).");
      return;
    }
    setBusy(true);
    try {
      if (mode === "up") {
        await signUp(email.trim(), password, name.trim());
        setNotice("Account created. If email confirmation is on, check your inbox, then sign in.");
        setMode("in");
      } else {
        await signIn(email.trim(), password);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__aside">
        <span className="brandmark">
          <span className="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l2.5-7 4 15 3-9 2 3h4.5" /></svg></span>
          <b>PulseBoard</b>
        </span>
        <div className="auth__pitch">
          <h2>Every channel’s numbers, read at a glance.</h2>
          <p>Connect your accounts once and PulseBoard keeps your growth, content and audience metrics in sync. No spreadsheets, no tab-hopping.</p>
          <div className="auth__points">
            {POINTS.map((p) => (
              <div className="auth__point" key={p}><IcCheck /> {p}</div>
            ))}
          </div>
        </div>
        <span className="muted" style={{ fontSize: 12 }}>Metrics come straight from the official platform APIs.</span>
      </div>

      <div className="auth__card">
        <h1>{mode === "in" ? "Sign in" : "Create your workspace"}</h1>
        <p className="lede">{mode === "in" ? "Welcome back to your analytics workspace." : "Start tracking your channels in a couple of minutes."}</p>
        <form className="auth__form" onSubmit={submit}>
          {mode === "up" && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required />
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@studio.com" autoComplete="email" required />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={mode === "up" ? "At least 6 characters" : "Your password"} autoComplete={mode === "in" ? "current-password" : "new-password"} required minLength={6} />
          </div>
          {err && <div className="auth__err">{err}</div>}
          {notice && <div className="banner" style={{ background: "var(--pos-weak)" }}><IcCheck style={{ color: "var(--pos)" }} /><div className="bt">{notice}</div></div>}
          <button className="btn btn--primary btn--block" type="submit" disabled={busy} style={{ height: 38 }}>
            {busy ? "Please wait…" : mode === "in" ? "Sign in" : "Create account"}
          </button>
        </form>
        <div className="auth__or"><span>or</span></div>
        <button type="button" className="btn btn--block" onClick={enter}>Explore the live demo</button>
        <p className="auth__demo-note">See the full dashboard with sample data. No account needed.</p>

        <div className="auth__switch">
          {mode === "in" ? (
            <>New here? <button onClick={() => { setMode("up"); setErr(null); }}>Create an account</button></>
          ) : (
            <>Already have an account? <button onClick={() => { setMode("in"); setErr(null); }}>Sign in</button></>
          )}
        </div>
        <p className="auth__note">Your credentials are handled by Supabase Auth. We never see your platform passwords. Connections use official OAuth.</p>
      </div>
    </div>
  );
}
