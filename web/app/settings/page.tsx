"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "../context/Auth";
import { useWeightUnit } from "../context/WeightUnit";
import { useNutritionGoals, NutritionGoals } from "../context/NutritionGoals";
import { addDaysISO, todayISOInAppTZ } from "../lib/date";
import { AIProvider, AIReviewResult } from "../lib/settings";
import { triggerAIReview, fetchLastAIReview } from "../lib/aiReview";

const API = "/api";
const WATER_GOAL_KEY = "intake_water_goal";
const DEFAULT_WATER_GOAL = 8;

const TABS = ["Goals", "Planning", "AI", "Notifications", "Data", "Account"] as const;
type Tab = typeof TABS[number];

function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = from;
  while (cur <= to) { dates.push(cur); cur = addDaysISO(cur, 1); }
  return dates;
}

function SectionHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--muted)" }}>
        {title}
      </div>
      {description && (
        <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>{description}</p>
      )}
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const { unit, setUnit } = useWeightUnit();
  const { goals, setGoals } = useNutritionGoals();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<Tab>("Goals");
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

  // Units
  const [waterGoal, setWaterGoal] = useState(DEFAULT_WATER_GOAL);

  // Nutrition goals
  const [goalDraft, setGoalDraft] = useState<NutritionGoals>(goals);
  useEffect(() => { setGoalDraft(goals); }, [goals]);

  // Notifications
  const [pantryWebhook, setPantryWebhook] = useState("");
  const [webhookSaving, setWebhookSaving] = useState(false);
  const [webhookTesting, setWebhookTesting] = useState(false);

  // Claim local data
  const [claiming, setClaiming] = useState(false);
  const [claimDone, setClaimDone] = useState(false);

  // Data
  const [busy, setBusy] = useState<"export" | "import" | "report" | null>(null);
  const [reportFrom, setReportFrom] = useState(() => addDaysISO(todayISOInAppTZ(), -30));
  const [reportTo, setReportTo] = useState(() => todayISOInAppTZ());

  // Meal plan settings
  const [mealPlanWeeks, setMealPlanWeeks] = useState("2");
  const [breakfastTime, setBreakfastTime] = useState("08:00");
  const [lunchTime, setLunchTime] = useState("12:30");
  const [dinnerTime, setDinnerTime] = useState("19:00");

  // AI review
  const [aiProvider, setAiProvider] = useState<AIProvider>("claude");
  const [aiKey, setAiKey] = useState("");
  const [aiReviewTime, setAiReviewTime] = useState("20:00");
  const [aiRunning, setAiRunning] = useState(false);
  const [aiStatus, setAiStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [lastReview, setLastReview] = useState<AIReviewResult | null>(null);
  const [aiKeySaved, setAiKeySaved] = useState(false);
  const [aiCustomPrompt, setAiCustomPrompt] = useState("");

  // API key
  const [apiKey, setApiKey] = useState("");
  const [apiKeyRevealed, setApiKeyRevealed] = useState(false);
  const [apiKeyBusy, setApiKeyBusy] = useState(false);
  const [apiKeyCopied, setApiKeyCopied] = useState(false);

  useEffect(() => {
    const raw = Number(localStorage.getItem(WATER_GOAL_KEY));
    const next = Number.isFinite(raw) ? Math.max(1, Math.min(24, Math.round(raw))) : DEFAULT_WATER_GOAL;
    setWaterGoal(next);

    fetch(`${API}/settings`)
      .then(r => r.ok ? r.json() : {})
      .then((s: Record<string, string>) => {
        if (s.pantry_expiration_webhook) setPantryWebhook(s.pantry_expiration_webhook);
        if (s.ai_provider) setAiProvider(s.ai_provider as AIProvider);
        if (s.ai_api_key) { setAiKey(s.ai_api_key); setAiKeySaved(true); }
        if (s.ai_review_time) setAiReviewTime(s.ai_review_time);
        if (s.meal_plan_weeks) setMealPlanWeeks(s.meal_plan_weeks);
        if (s.meal_plan_breakfast_time) setBreakfastTime(s.meal_plan_breakfast_time);
        if (s.meal_plan_lunch_time) setLunchTime(s.meal_plan_lunch_time);
        if (s.meal_plan_dinner_time) setDinnerTime(s.meal_plan_dinner_time);
      })
      .catch(() => {});

    fetch(`${API}/auth/api-key`)
      .then(r => r.ok ? r.json() : {})
      .then((d: { api_key?: string }) => { if (d.api_key) setApiKey(d.api_key); })
      .catch(() => {});

    fetchLastAIReview().then(r => { if (r) setLastReview(r); }).catch(() => {});
  }, []);

  // Clear status when switching tabs
  useEffect(() => { setStatus(null); setAiStatus(null); }, [activeTab]);

  // ── Water goal ───────────────────────────────────────────────────────────────
  function onWaterGoalChange(value: string) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const next = Math.max(1, Math.min(24, Math.round(n)));
    setWaterGoal(next);
    localStorage.setItem(WATER_GOAL_KEY, String(next));
  }

  // ── Nutrition goals ──────────────────────────────────────────────────────────
  function onGoalFieldChange(field: keyof NutritionGoals, value: string) {
    const n = Math.max(0, Math.round(Number(value)));
    if (!Number.isFinite(n)) return;
    setGoalDraft(prev => ({ ...prev, [field]: n }));
  }

  async function saveGoals() {
    setGoals(goalDraft);
    await fetch(`${API}/settings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: "nutrition_goals", value: JSON.stringify(goalDraft) }),
    }).catch(() => {});
    setStatus({ ok: true, msg: "Nutrition goals saved." });
  }

  // ── AI review ────────────────────────────────────────────────────────────────
  async function saveAISettings() {
    setAiStatus(null);
    try {
      await Promise.all([
        fetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "ai_provider", value: aiProvider }) }),
        fetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "ai_api_key", value: aiKey.trim() }) }),
        fetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "ai_review_time", value: aiReviewTime }) }),
      ]);
      setAiKeySaved(true);
      setAiStatus({ ok: true, msg: "AI review settings saved." });
    } catch {
      setAiStatus({ ok: false, msg: "Failed to save AI settings." });
    }
  }

  async function handleRunAIReview() {
    setAiRunning(true);
    setAiStatus(null);
    try {
      const result = await triggerAIReview(aiCustomPrompt.trim() || undefined);
      setLastReview(result);
      setAiStatus({ ok: true, msg: "Review complete. Result saved and posted to Discord." });
    } catch (err) {
      setAiStatus({ ok: false, msg: err instanceof Error ? err.message : "Review failed." });
    } finally {
      setAiRunning(false);
    }
  }

  // ── Notifications ────────────────────────────────────────────────────────────
  async function savePantryWebhook() {
    setWebhookSaving(true);
    setStatus(null);
    try {
      await fetch(`${API}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: "pantry_expiration_webhook", value: pantryWebhook.trim() }),
      });
      setStatus({ ok: true, msg: "Webhook URL saved." });
    } catch {
      setStatus({ ok: false, msg: "Failed to save webhook URL." });
    } finally {
      setWebhookSaving(false);
    }
  }

  async function testPantryWebhook() {
    if (!pantryWebhook.trim()) return;
    setWebhookTesting(true);
    setStatus(null);
    try {
      const res = await fetch(pantryWebhook.trim(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "Test: Pantry expiration notifications are working!", text: "Test: Pantry expiration notifications are working!" }),
      });
      if (res.ok || res.status === 204) {
        setStatus({ ok: true, msg: "Test notification sent!" });
      } else {
        setStatus({ ok: false, msg: `Webhook returned ${res.status}.` });
      }
    } catch {
      setStatus({ ok: false, msg: "Failed to reach webhook URL." });
    } finally {
      setWebhookTesting(false);
    }
  }

  // ── Claim local data ─────────────────────────────────────────────────────────
  async function claimLocalData() {
    setClaiming(true);
    setStatus(null);
    try {
      const res = await fetch(`${API}/auth/claim-local-data`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "claim failed");
      setClaimDone(true);
      setStatus({ ok: true, msg: `Imported ${data.migrated_rows} rows from local user.` });
    } catch (err) {
      setStatus({ ok: false, msg: err instanceof Error ? err.message : "Claim failed." });
    } finally {
      setClaiming(false);
    }
  }

  // ── API key ──────────────────────────────────────────────────────────────────
  async function generateAPIKey() {
    setApiKeyBusy(true);
    try {
      const res = await fetch(`${API}/auth/api-key`, { method: "POST" });
      const d = await res.json();
      if (d.api_key) { setApiKey(d.api_key); setApiKeyRevealed(true); }
    } catch { /* ignore */ } finally {
      setApiKeyBusy(false);
    }
  }

  async function copyAPIKey() {
    if (!apiKey) return;
    await navigator.clipboard.writeText(apiKey);
    setApiKeyCopied(true);
    setTimeout(() => setApiKeyCopied(false), 2000);
  }

  // ── Data ─────────────────────────────────────────────────────────────────────
  async function exportData() {
    setBusy("export");
    setStatus(null);
    try {
      const res = await fetch(`${API}/data/export`);
      if (!res.ok) throw new Error("export failed");
      const body = await res.json();
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `intake-export-${todayISOInAppTZ()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ ok: true, msg: "Export downloaded." });
    } catch {
      setStatus({ ok: false, msg: "Export failed." });
    } finally {
      setBusy(null);
    }
  }

  async function importData(file: File) {
    setBusy("import");
    setStatus(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const res = await fetch(`${API}/data/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const raw = await res.text();
      let body: { error?: string; imported_rows?: number } | null = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      if (!res.ok) throw new Error(body?.error || raw || `import failed (${res.status})`);
      setStatus({ ok: true, msg: `Import complete (${body?.imported_rows ?? 0} rows).` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed.";
      setStatus({ ok: false, msg: `Import failed: ${msg}` });
    } finally {
      setBusy(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function generateReport() {
    setBusy("report");
    setStatus(null);
    try {
      const dates = datesInRange(reportFrom, reportTo);
      const waterGoalVal = Number(localStorage.getItem(WATER_GOAL_KEY)) || DEFAULT_WATER_GOAL;
      const days = await Promise.all(dates.map(async (date) => {
        const [dashRes, logRes] = await Promise.all([
          fetch(`${API}/dashboard/today?date=${date}`),
          fetch(`${API}/log/today?date=${date}`),
        ]);
        const dash = dashRes.ok ? await dashRes.json() : {};
        const log = logRes.ok ? await logRes.json() : [];
        const waterDrank = Number(localStorage.getItem(`intake_water_intake_${date}`)) || 0;
        return {
          date,
          summary: {
            calories_in: dash.calories_in ?? 0,
            protein_g: dash.protein_g ?? 0,
            carbs_g: dash.carbs_g ?? 0,
            fat_g: dash.fat_g ?? 0,
            fiber_g: dash.fiber_g ?? 0,
            steps: dash.steps ?? 0,
            active_kcal_est: dash.active_kcal_est ?? 0,
          },
          water: { drank: waterDrank, goal: waterGoalVal },
          food_log: (log as { meal: string; food_name: string; serving_label: string; servings: number; calories: number; protein_g: number; carbs_g: number; fat_g: number; fiber_g: number }[]).map(e => ({
            meal: e.meal,
            food_name: e.food_name,
            serving_label: e.serving_label,
            servings: e.servings,
            calories: e.calories,
            protein_g: e.protein_g,
            carbs_g: e.carbs_g,
            fat_g: e.fat_g,
            fiber_g: e.fiber_g,
          })),
        };
      }));
      const report = { generated_at: new Date().toISOString(), from: reportFrom, to: reportTo, days };
      const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `intake-report-${reportFrom}-to-${reportTo}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setStatus({ ok: true, msg: `Report generated (${dates.length} days).` });
    } catch {
      setStatus({ ok: false, msg: "Report generation failed." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div style={{ display: "grid", gap: 16, maxWidth: 560 }}>
      <div style={{ marginBottom: 4 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Settings</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>Preferences, goals, and integrations.</p>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: "flex",
        gap: 2,
        background: "var(--surface2)",
        borderRadius: "var(--radius-sm)",
        padding: 4,
        flexWrap: "wrap",
      }}>
        {TABS.map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            style={{
              flex: "1 1 auto",
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: activeTab === tab ? 700 : 500,
              border: "none",
              borderRadius: "calc(var(--radius-sm) - 2px)",
              background: activeTab === tab ? "var(--surface)" : "transparent",
              color: activeTab === tab ? "var(--text)" : "var(--muted)",
              cursor: "pointer",
              transition: "background 0.15s, color 0.15s",
              boxShadow: activeTab === tab ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
              whiteSpace: "nowrap",
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ── Goals tab ── */}
      {activeTab === "Goals" && (
        <>
          <div className="card">
            <SectionHeader title="Units" />
            <div style={{ display: "grid", gap: 16 }}>
              <div>
                <div className="field-label">Weight unit</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setUnit("lbs")}
                    style={{ flex: 1, borderColor: unit === "lbs" ? "var(--accent)" : undefined }}
                  >
                    lbs
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => setUnit("kg")}
                    style={{ flex: 1, borderColor: unit === "kg" ? "var(--accent)" : undefined }}
                  >
                    kg
                  </button>
                </div>
              </div>
              <div>
                <div className="field-label">Water goal (glasses/day)</div>
                <input
                  type="number"
                  min={1}
                  max={24}
                  step={1}
                  value={waterGoal}
                  onChange={e => onWaterGoalChange(e.target.value)}
                  style={{ maxWidth: 140 }}
                />
              </div>
            </div>
          </div>

          <div className="card">
            <SectionHeader title="Nutrition Goals" description="Daily macro targets used across the app." />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
              {(["calories", "protein", "carbs", "fat", "fiber"] as const).map(field => (
                <div key={field}>
                  <label className="field-label" style={{ fontSize: 11, textTransform: "capitalize" }}>
                    {field} {field === "calories" ? "(kcal)" : "(g)"}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step={field === "calories" ? 50 : 5}
                    value={goalDraft[field]}
                    onChange={e => onGoalFieldChange(field, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <button className="btn btn-primary" onClick={saveGoals}>Save Goals</button>
          </div>
        </>
      )}

      {/* ── Planning tab ── */}
      {activeTab === "Planning" && (
        <div className="card">
          <SectionHeader title="Meal Plan" description="Controls the calendar planning view and ICS export." />
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div className="field-label">Weeks to export (ICS)</div>
              <div style={{ display: "flex", gap: 8 }}>
                {["1","2","3","4"].map(w => (
                  <button
                    key={w}
                    className="btn btn-ghost"
                    onClick={() => setMealPlanWeeks(w)}
                    style={{ flex: 1, borderColor: mealPlanWeeks === w ? "var(--accent)" : undefined }}
                  >{w}w</button>
                ))}
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
              {([["Breakfast", breakfastTime, setBreakfastTime], ["Lunch", lunchTime, setLunchTime], ["Dinner", dinnerTime, setDinnerTime]] as const).map(([label, val, setter]) => (
                <div key={label}>
                  <label className="field-label">{label}</label>
                  <input type="time" value={val} onChange={e => setter(e.target.value)} />
                </div>
              ))}
            </div>
            <button
              className="btn btn-primary"
              onClick={async () => {
                await Promise.all([
                  fetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "meal_plan_weeks", value: mealPlanWeeks }) }),
                  fetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "meal_plan_breakfast_time", value: breakfastTime }) }),
                  fetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "meal_plan_lunch_time", value: lunchTime }) }),
                  fetch(`${API}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: "meal_plan_dinner_time", value: dinnerTime }) }),
                ]);
                setStatus({ ok: true, msg: "Meal plan settings saved." });
              }}
            >
              Save
            </button>
          </div>
        </div>
      )}

      {/* ── AI tab ── */}
      {activeTab === "AI" && (
        <div className="card">
          <SectionHeader
            title="AI Daily Review"
            description="Automatically reviews your food log at a set time each day and posts the summary to Discord."
          />
          <div style={{ display: "grid", gap: 14 }}>
            <div>
              <div className="field-label">Provider</div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  className="btn btn-ghost"
                  onClick={() => setAiProvider("claude")}
                  style={{ flex: 1, borderColor: aiProvider === "claude" ? "var(--accent)" : undefined }}
                >
                  Claude
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={() => setAiProvider("openai")}
                  style={{ flex: 1, borderColor: aiProvider === "openai" ? "var(--accent)" : undefined }}
                >
                  OpenAI
                </button>
              </div>
            </div>

            <div>
              <label className="field-label">
                {aiProvider === "claude" ? "Anthropic API Key" : "OpenAI API Key"}
                {aiKeySaved && <span style={{ color: "var(--accent)", marginLeft: 6, fontSize: 11 }}>saved</span>}
              </label>
              <input
                type="password"
                placeholder={aiProvider === "claude" ? "sk-ant-…" : "sk-…"}
                value={aiKey}
                onChange={e => { setAiKey(e.target.value); setAiKeySaved(false); }}
                style={{ width: "100%", fontFamily: "monospace" }}
                autoComplete="off"
              />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                Stored in your browser only. Never sent to the Intake server.
              </p>
            </div>

            <div>
              <label className="field-label">Daily review time</label>
              <input
                type="time"
                value={aiReviewTime}
                onChange={e => setAiReviewTime(e.target.value)}
                style={{ maxWidth: 140 }}
              />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                Review runs automatically at this time each day and posts to Discord.
              </p>
            </div>

            <div>
              <label className="field-label">Custom prompt (optional)</label>
              <textarea
                placeholder={"Leave blank to use the default macro-goals review.\n\nOr write your own, e.g. \"Was today a relatively good day? Anything to change?\""}
                value={aiCustomPrompt}
                onChange={e => setAiCustomPrompt(e.target.value)}
                rows={4}
                style={{ width: "100%", resize: "vertical", fontFamily: "inherit", fontSize: 13 }}
              />
              <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                Replaces the default task instructions. Your food log and macro data are always included.
              </p>
            </div>

            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={saveAISettings}>Save</button>
              <button
                className="btn btn-ghost"
                onClick={handleRunAIReview}
                disabled={aiRunning || !aiKey.trim()}
              >
                {aiRunning ? "Running…" : "Run Now"}
              </button>
            </div>

            {aiStatus && (
              <div className={`pill ${aiStatus.ok ? "pill-ok" : "pill-err"}`}>{aiStatus.msg}</div>
            )}

            {lastReview && (
              <div style={{
                background: "var(--surface2)",
                borderRadius: "var(--radius-sm)",
                padding: 14,
                border: "1px solid var(--border)",
              }}>
                <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8, display: "flex", justifyContent: "space-between" }}>
                  <span>Last review — {lastReview.date} via {lastReview.provider}</span>
                  <span>{new Date(lastReview.runAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <div style={{ fontSize: 13, lineHeight: 1.6, whiteSpace: "pre-wrap", color: "var(--text)" }}>
                  {lastReview.text}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Notifications tab ── */}
      {activeTab === "Notifications" && (
        <div className="card">
          <SectionHeader
            title="Notifications"
            description="Discord webhook for pantry expiration alerts and AI review summaries."
          />
          <div style={{ display: "grid", gap: 10 }}>
            <div>
              <label className="field-label" style={{ fontSize: 11 }}>Webhook URL</label>
              <input
                type="url"
                placeholder="https://discord.com/api/webhooks/…"
                value={pantryWebhook}
                onChange={e => setPantryWebhook(e.target.value)}
                style={{ width: "100%" }}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={savePantryWebhook} disabled={webhookSaving}>
                {webhookSaving ? "Saving…" : "Save Webhook"}
              </button>
              <button className="btn btn-ghost" onClick={testPantryWebhook} disabled={webhookTesting || !pantryWebhook.trim()}>
                {webhookTesting ? "Sending…" : "Test"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Data tab ── */}
      {activeTab === "Data" && (
        <div className="card">
          <SectionHeader title="Data" description="Export or import your full dataset as JSON." />
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={exportData} disabled={busy !== null}>
                {busy === "export" ? "Exporting…" : "Export JSON"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy !== null}
              >
                {busy === "import" ? "Importing…" : "Import JSON"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                style={{ display: "none" }}
                onChange={e => {
                  const file = e.target.files?.[0];
                  if (file) importData(file);
                }}
              />
            </div>

            <div>
              <div className="field-label" style={{ marginBottom: 8 }}>Daily Report</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <input
                  type="date"
                  value={reportFrom}
                  onChange={e => setReportFrom(e.target.value)}
                  style={{ maxWidth: 150 }}
                />
                <span style={{ fontSize: 13, color: "var(--muted)" }}>to</span>
                <input
                  type="date"
                  value={reportTo}
                  onChange={e => setReportTo(e.target.value)}
                  style={{ maxWidth: 150 }}
                />
              </div>
              <button
                className="btn btn-ghost"
                onClick={generateReport}
                disabled={busy !== null || !reportFrom || !reportTo || reportFrom > reportTo}
              >
                {busy === "report" ? "Generating…" : "Generate Report"}
              </button>
              <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 6 }}>
                Per-day JSON with macros, steps, water, and food log entries.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Account tab ── */}
      {activeTab === "Account" && (
        <>
          <div className="card">
            <SectionHeader
              title="API Key"
              description="Use this key to make authenticated API calls with Authorization: Bearer <key>."
            />
            <div style={{ display: "grid", gap: 12 }}>
              {apiKey ? (
                <div>
                  <div className="field-label">Your key</div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                    <input
                      type={apiKeyRevealed ? "text" : "password"}
                      value={apiKey}
                      readOnly
                      style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
                    />
                    <button
                      className="btn btn-ghost"
                      onClick={() => setApiKeyRevealed(r => !r)}
                      style={{ flexShrink: 0, fontSize: 12 }}
                    >
                      {apiKeyRevealed ? "Hide" : "Show"}
                    </button>
                    <button
                      className="btn btn-ghost"
                      onClick={copyAPIKey}
                      style={{ flexShrink: 0, fontSize: 12 }}
                    >
                      {apiKeyCopied ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                    Treat this like a password. Generating a new key immediately invalidates the old one.
                  </p>
                </div>
              ) : (
                <p style={{ fontSize: 13, color: "var(--muted)" }}>No API key generated yet.</p>
              )}
              <div>
                <button className="btn btn-primary" onClick={generateAPIKey} disabled={apiKeyBusy}>
                  {apiKeyBusy ? "Generating…" : apiKey ? "Regenerate Key" : "Generate Key"}
                </button>
              </div>
            </div>
          </div>

          {user?.is_first_user && (
            <div className="card">
              <SectionHeader
                title="Import Local Data"
                description="Move all data from the built-in local user into your account. Conflicting entries will be skipped."
              />
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  className="btn btn-primary"
                  onClick={claimLocalData}
                  disabled={claiming || claimDone}
                >
                  {claiming ? "Importing…" : claimDone ? "Done" : "Import local user's data"}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {status && <div className={`pill ${status.ok ? "pill-ok" : "pill-err"}`}>{status.msg}</div>}
    </div>
  );
}
