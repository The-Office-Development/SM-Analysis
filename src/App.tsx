import { useEffect } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { ToastProvider } from "./context/ToastContext";
import { DemoProvider, useDemo } from "./context/DemoContext";
import { DashboardProvider } from "./context/DashboardContext";
import AppLayout from "./components/AppLayout";
import AuthPage from "./pages/AuthPage";
import Overview from "./pages/Overview";
import Content from "./pages/Content";
import Audience from "./pages/Audience";
import Platforms from "./pages/Platforms";
import Planner from "./pages/Planner";
import Assistant from "./pages/Assistant";
import Reports from "./pages/Reports";
import Connections from "./pages/Connections";
import SharedReport from "./pages/SharedReport";
import { Privacy, Terms, DataDeletion } from "./pages/Legal";

function Splash() {
  return (
    <div style={{ height: "100%", display: "grid", placeItems: "center", color: "var(--muted)" }}>
      <span className="brandmark">
        <span className="glyph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l2.5-7 4 15 3-9 2 3h4.5" /></svg></span>
        <b>PulseBoard</b>
      </span>
    </div>
  );
}

function Gate() {
  const { session, loading } = useAuth();
  const { demo, exit } = useDemo();
  // A real login always wins over preview mode.
  useEffect(() => { if (session && demo) exit(); }, [session, demo, exit]);

  if (loading) return <Splash />;
  if (!session && !demo) return <AuthPage />;
  return (
    <DashboardProvider>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Overview />} />
          <Route path="content" element={<Content />} />
          <Route path="audience" element={<Audience />} />
          <Route path="platforms" element={<Platforms />} />
          <Route path="planner" element={<Planner />} />
          <Route path="assistant" element={<Assistant />} />
          <Route path="reports" element={<Reports />} />
          <Route path="connections" element={<Connections />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </DashboardProvider>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <DemoProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/r/:slug" element={<SharedReport />} />
              {/* Public and reachable without an account: App Review checks these. */}
              <Route path="/privacy" element={<Privacy />} />
              <Route path="/terms" element={<Terms />} />
              <Route path="/data-deletion" element={<DataDeletion />} />
              <Route path="/*" element={<Gate />} />
            </Routes>
          </BrowserRouter>
        </DemoProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
