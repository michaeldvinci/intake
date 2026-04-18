"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const API = "/api";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const body =
        mode === "register"
          ? { email, password, display_name: displayName }
          : { email, password };
      const res = await fetch(`${API}/auth/${mode}`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "var(--bg)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div style={{ width: "100%", maxWidth: 400 }}>
        <div style={{ textAlign: "center", marginBottom: 32 }}>
          <i className="fa-solid fa-utensils" style={{ fontSize: 32, color: "var(--accent)", marginBottom: 8, display: "block" }} />
          <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: -0.5 }}>
            In<span style={{ color: "var(--accent)" }}>Take</span>
          </div>
        </div>

        <div className="card" style={{ padding: 28 }}>
          <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
            <button
              className={`btn ${mode === "login" ? "btn-primary" : "btn-ghost"}`}
              style={{ flex: 1 }}
              onClick={() => { setMode("login"); setError(""); }}
            >
              Sign In
            </button>
            <button
              className={`btn ${mode === "register" ? "btn-primary" : "btn-ghost"}`}
              style={{ flex: 1 }}
              onClick={() => { setMode("register"); setError(""); }}
            >
              Register
            </button>
          </div>

          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {mode === "register" && (
              <div>
                <label className="field-label">Display Name</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="name"
                />
              </div>
            )}
            <div>
              <label className="field-label">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                autoComplete="email"
              />
            </div>
            <div>
              <label className="field-label">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                autoComplete={mode === "register" ? "new-password" : "current-password"}
              />
            </div>

            {error && (
              <div style={{ color: "var(--danger)", fontSize: 13 }}>{error}</div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={busy}
              style={{ marginTop: 4 }}
            >
              {busy ? "..." : mode === "login" ? "Sign In" : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
