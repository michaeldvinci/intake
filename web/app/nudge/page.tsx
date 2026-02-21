"use client";

import { useEffect, useState } from "react";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";
const WEBHOOK_KEY = "intake_nudge_webhook";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Nudge = {
  id: string;
  food_item_id: string;
  food_name: string;
  remind_at: string;
  webhook_url: string;
  enabled: boolean;
  logged_today: boolean;
};

type FoodItem = {
  id: string;
  name: string;
  brand: string;
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function NudgePage() {
  const [nudges, setNudges] = useState<Nudge[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form state
  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FoodItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedFood, setSelectedFood] = useState<FoodItem | null>(null);
  const [remindAt, setRemindAt] = useState("14:00");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [saving, setSaving] = useState(false);

  // Load nudges
  async function loadNudges() {
    try {
      const res = await fetch(`${API}/nudges?user_id=${USER_ID}`);
      if (res.ok) setNudges(await res.json());
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadNudges();
    const saved = localStorage.getItem(WEBHOOK_KEY);
    if (saved) setWebhookUrl(saved);
  }, []);

  // Food search with debounce
  useEffect(() => {
    if (!search.trim() || search.trim().length < 2) {
      setSearchResults([]);
      return;
    }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${API}/food-items?user_id=${USER_ID}&q=${encodeURIComponent(search.trim())}`);
        if (res.ok) setSearchResults(await res.json());
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  function selectFood(food: FoodItem) {
    setSelectedFood(food);
    setSearch("");
    setSearchResults([]);
  }

  async function addNudge() {
    if (!selectedFood || !remindAt || !webhookUrl.trim()) return;
    setSaving(true);
    localStorage.setItem(WEBHOOK_KEY, webhookUrl.trim());
    try {
      const res = await fetch(`${API}/nudges`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          food_item_id: selectedFood.id,
          remind_at: remindAt,
          webhook_url: webhookUrl.trim(),
        }),
      });
      if (res.ok) {
        setSelectedFood(null);
        await loadNudges();
      }
    } finally {
      setSaving(false);
    }
  }

  async function toggleEnabled(nudge: Nudge) {
    await fetch(`${API}/nudges/${nudge.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !nudge.enabled }),
    });
    setNudges(prev => prev.map(n => n.id === nudge.id ? { ...n, enabled: !n.enabled } : n));
  }

  async function deleteNudge(id: string) {
    await fetch(`${API}/nudges/${id}`, { method: "DELETE" });
    setNudges(prev => prev.filter(n => n.id !== id));
  }

  async function testNudge(id: string) {
    const res = await fetch(`${API}/nudges/${id}/test`, { method: "POST" });
    if (res.ok) {
      alert("Webhook fired! Check Discord.");
    } else {
      const data = await res.json();
      alert(`Webhook failed: ${data.error || "unknown error"}`);
    }
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Nudge</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>
          Daily reminders for items you don&apos;t want to forget.
        </p>
      </div>

      {/* Add nudge form */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-label" style={{ marginBottom: 12 }}>Add Reminder</div>

        {/* Food item picker */}
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>
            Food Item
          </label>
          {selectedFood ? (
            <div style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "8px 10px", border: "1px solid var(--border)",
              borderRadius: "var(--radius-sm)", background: "var(--surface2)",
            }}>
              <span style={{ flex: 1, fontWeight: 600, fontSize: 14 }}>
                {selectedFood.name}{selectedFood.brand ? ` (${selectedFood.brand})` : ""}
              </span>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 11, padding: "2px 8px" }}
                onClick={() => setSelectedFood(null)}
              >
                Change
              </button>
            </div>
          ) : (
            <div style={{ position: "relative" }}>
              <input
                type="text"
                placeholder="Search food items…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{
                  width: "100%", padding: "8px 10px", fontSize: 14,
                  border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                  background: "var(--surface)", color: "var(--fg)",
                }}
              />
              {(searchResults.length > 0 || searching) && (
                <div style={{
                  position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)", marginTop: 4, maxHeight: 200,
                  overflowY: "auto",
                }}>
                  {searching ? (
                    <div style={{ padding: "8px 10px", color: "var(--muted)", fontSize: 13 }}>
                      Searching…
                    </div>
                  ) : (
                    searchResults.map(f => (
                      <div
                        key={f.id}
                        onClick={() => selectFood(f)}
                        style={{
                          padding: "8px 10px", cursor: "pointer", fontSize: 14,
                          borderBottom: "1px solid var(--border)",
                        }}
                      >
                        {f.name}{f.brand ? ` (${f.brand})` : ""}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Time picker */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>
              Remind At
            </label>
            <input
              type="time"
              value={remindAt}
              onChange={e => setRemindAt(e.target.value)}
              style={{
                width: "100%", padding: "8px 10px", fontSize: 14,
                border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                background: "var(--surface)", color: "var(--fg)",
              }}
            />
          </div>
        </div>

        {/* Webhook URL */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", display: "block", marginBottom: 4 }}>
            Discord Webhook URL
          </label>
          <input
            type="url"
            placeholder="https://discord.com/api/webhooks/..."
            value={webhookUrl}
            onChange={e => setWebhookUrl(e.target.value)}
            style={{
              width: "100%", padding: "8px 10px", fontSize: 14,
              border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
              background: "var(--surface)", color: "var(--fg)",
            }}
          />
        </div>

        <button
          className="btn btn-primary"
          onClick={addNudge}
          disabled={!selectedFood || !remindAt || !webhookUrl.trim() || saving}
        >
          {saving ? "Saving…" : "Add Nudge"}
        </button>
      </div>

      {/* Active nudges list */}
      <div className="card">
        <div className="card-label" style={{ marginBottom: 12 }}>Active Reminders</div>

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
        ) : nudges.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>
            No reminders yet. Add one above to get started.
          </div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {nudges.map(n => (
              <div
                key={n.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto",
                  gap: 10,
                  alignItems: "center",
                  padding: "10px 12px",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-sm)",
                  opacity: n.enabled ? 1 : 0.5,
                }}
              >
                {/* Status indicator */}
                <div style={{
                  width: 10, height: 10, borderRadius: "50%",
                  background: n.logged_today ? "var(--green, #22c55e)" : n.enabled ? "var(--accent)" : "var(--muted)",
                  flexShrink: 0,
                }} />

                {/* Info */}
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {n.food_name}
                    {n.logged_today && (
                      <span style={{ fontSize: 11, color: "var(--green, #22c55e)", marginLeft: 8 }}>
                        Logged today
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>
                    Remind at {n.remind_at}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: "flex", gap: 6 }}>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "4px 8px" }}
                    onClick={() => testNudge(n.id)}
                    title="Send test notification"
                  >
                    Test
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "4px 8px" }}
                    onClick={() => toggleEnabled(n)}
                  >
                    {n.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "4px 8px", color: "var(--danger, #ef4444)" }}
                    onClick={() => deleteNudge(n.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
