"use client";

import { useEffect, useRef, useState } from "react";
import { useWeightUnit } from "../context/WeightUnit";
import { useNutritionGoals, NutritionGoals } from "../context/NutritionGoals";
import { todayISOInAppTZ } from "../lib/date";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";
const WATER_GOAL_KEY = "intake_water_goal";
const WATER_INTAKE_PREFIX = "intake_water_intake_";
const DEFAULT_WATER_GOAL = 8;

function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function datesInRange(from: string, to: string): string[] {
  const dates: string[] = [];
  let cur = from;
  while (cur <= to) { dates.push(cur); cur = addDays(cur, 1); }
  return dates;
}

export default function SettingsPage() {
  const { unit, setUnit } = useWeightUnit();
  const { goals, setGoals } = useNutritionGoals();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState<"export" | "import" | "report" | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [waterGoal, setWaterGoal] = useState(DEFAULT_WATER_GOAL);
  const [reportFrom, setReportFrom] = useState(() => addDays(todayISOInAppTZ(), -30));
  const [reportTo, setReportTo] = useState(() => todayISOInAppTZ());
  const [goalDraft, setGoalDraft] = useState<NutritionGoals>(goals);

  // Keep draft in sync when context loads from localStorage
  useEffect(() => { setGoalDraft(goals); }, [goals]);

  useEffect(() => {
    const raw = Number(localStorage.getItem(WATER_GOAL_KEY));
    const next = Number.isFinite(raw) ? Math.max(1, Math.min(24, Math.round(raw))) : DEFAULT_WATER_GOAL;
    setWaterGoal(next);
  }, []);

  async function exportData() {
    setBusy("export");
    setStatus(null);
    try {
      const url = `${API}/data/export?user_id=${USER_ID}`;
      console.info("[settings] export start", { url, apiBase: API, userId: USER_ID });
      const res = await fetch(url);
      console.info("[settings] export response", { status: res.status, ok: res.ok });
      if (!res.ok) throw new Error("export failed");
      const body = await res.json();
      console.info("[settings] export payload", {
        food_items: body?.food_items?.length ?? 0,
        log_entries: body?.log_entries?.length ?? 0,
        body_weights: body?.body_weights?.length ?? 0,
        daily_activity: body?.daily_activity?.length ?? 0,
      });
      const blob = new Blob([JSON.stringify(body, null, 2)], { type: "application/json" });
      const downloadUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = `intake-export-${todayISOInAppTZ()}.json`;
      a.click();
      URL.revokeObjectURL(downloadUrl);
      setStatus({ ok: true, msg: "Export downloaded." });
    } catch {
      setStatus({ ok: false, msg: "Export failed." });
    } finally {
      setBusy(null);
    }
  }

  function onWaterGoalChange(value: string) {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    const next = Math.max(1, Math.min(24, Math.round(n)));
    setWaterGoal(next);
    localStorage.setItem(WATER_GOAL_KEY, String(next));
  }

  function onGoalFieldChange(field: keyof NutritionGoals, value: string) {
    const n = Math.max(0, Math.round(Number(value)));
    if (!Number.isFinite(n)) return;
    setGoalDraft(prev => ({ ...prev, [field]: n }));
  }

  function saveGoals() {
    setGoals(goalDraft);
    setStatus({ ok: true, msg: "Nutrition goals saved." });
  }

  async function importData(file: File) {
    setBusy("import");
    setStatus(null);
    try {
      console.info("[settings] import file selected", { name: file.name, size: file.size, type: file.type });
      const text = await file.text();
      console.info("[settings] import file read", { chars: text.length });
      const parsed = JSON.parse(text);
      console.info("[settings] import payload keys", { keys: Object.keys(parsed || {}) });
      const url = `${API}/data/import?user_id=${USER_ID}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed),
      });
      const raw = await res.text();
      console.info("[settings] import response", { url, status: res.status, ok: res.ok, rawPreview: raw.slice(0, 400) });
      let body: { error?: string; imported_rows?: number } | null = null;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {
        body = null;
      }
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
          fetch(`${API}/dashboard/today?user_id=${USER_ID}&date=${date}`),
          fetch(`${API}/log/today?user_id=${USER_ID}&date=${date}`),
        ]);
        const dash = dashRes.ok ? await dashRes.json() : {};
        const log = logRes.ok ? await logRes.json() : [];
        const waterDrank = Number(localStorage.getItem(`${WATER_INTAKE_PREFIX}${date}`)) || 0;
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
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Settings</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>Units and data backup.</p>
      </div>

      <div className="card" style={{ maxWidth: 560 }}>
        <div style={{ display: "grid", gap: 20 }}>
          <section>
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
          </section>

          <section>
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
          </section>

          <section>
            <div className="field-label">Nutrition Goals (daily)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
              {(["calories", "protein", "carbs", "fat", "fiber"] as const).map(field => (
                <div key={field}>
                  <label className="field-label" style={{ fontSize: 11, textTransform: "capitalize" }}>{field} {field === "calories" ? "(kcal)" : "(g)"}</label>
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
          </section>

          <section>
            <div className="field-label">Data</div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn btn-primary" onClick={exportData} disabled={busy !== null}>
                {busy === "export" ? "Exporting..." : "Export JSON"}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => fileInputRef.current?.click()}
                disabled={busy !== null}
              >
                {busy === "import" ? "Importing..." : "Import JSON"}
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
          </section>

          <section>
            <div className="field-label">Daily Report</div>
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
              Exports per-day JSON with macros, steps, water, and food log entries.
            </p>
          </section>

          {status && <div className={`pill ${status.ok ? "pill-ok" : "pill-err"}`}>{status.msg}</div>}
        </div>
      </div>
    </div>
  );
}
