"use client";

import { useState } from "react";
import { useWeightUnit, toKg } from "../context/WeightUnit";
import { todayISOInAppTZ } from "../lib/date";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

export default function MetricsPage() {
  const { unit } = useWeightUnit();
  const [weight, setWeight] = useState("");
  const [steps, setSteps] = useState("");
  const [kcal, setKcal] = useState("");
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  async function save() {
    setSaving(true);
    setStatus(null);
    const today = todayISOInAppTZ();
    const now = new Date().toISOString();
    const errors: string[] = [];

    if (weight) {
      const weightKg = toKg(Number(weight), unit);
      const res = await fetch(`${API}/body/weight`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: USER_ID, measured_at: now, weight_kg: weightKg }),
      });
      if (!res.ok) errors.push("weight");
    }

    if (steps || kcal) {
      const res = await fetch(`${API}/activity/daily`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          date: today,
          steps: Number(steps) || 0,
          active_calories_est: Number(kcal) || 0,
        }),
      });
      if (!res.ok) errors.push("activity");
    }

    if (errors.length > 0) {
      setStatus({ msg: `Failed to save: ${errors.join(", ")}`, ok: false });
    } else {
      setStatus({ msg: "Saved.", ok: true });
      setWeight("");
      setSteps("");
      setKcal("");
    }
    setSaving(false);
  }

  const hasInput = weight || steps || kcal;
  const weightKgPreview = weight ? toKg(Number(weight), unit) : null;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Metrics</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>Log today's weight, steps, and activity burn.</p>
      </div>

      <div className="card" style={{ maxWidth: 480 }}>
        <div style={{ display: "grid", gap: 16 }}>
          <div>
            <label className="field-label">Weight ({unit})</label>
            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
              Today's weigh-in
              {unit === "lbs" && weightKgPreview !== null && (
                <span style={{ marginLeft: 8 }}>= {weightKgPreview.toFixed(2)} kg stored</span>
              )}
            </div>
            <input
              type="number"
              inputMode="decimal"
              value={weight}
              onChange={e => setWeight(e.target.value)}
              placeholder={unit === "lbs" ? "e.g. 186.0" : "e.g. 84.5"}
              min={0}
            />
          </div>

          <Field
            label="Steps"
            hint="Total steps today"
            value={steps}
            setValue={setSteps}
            placeholder="e.g. 9500"
            integer
          />
          <Field
            label="Active calories (estimated)"
            hint="Estimated burn from activity"
            value={kcal}
            setValue={setKcal}
            placeholder="e.g. 420"
          />

          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || !hasInput}
            style={{ marginTop: 4 }}
          >
            {saving ? "Saving…" : "Save"}
          </button>

          {status && (
            <div className={`pill ${status.ok ? "pill-ok" : "pill-err"}`}>{status.msg}</div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label, hint, value, setValue, placeholder, integer,
}: {
  label: string; hint?: string; value: string; setValue: (v: string) => void; placeholder?: string; integer?: boolean;
}) {
  return (
    <div>
      <label className="field-label">{label}</label>
      {hint && <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>{hint}</div>}
      <input
        type="number"
        inputMode={integer ? "numeric" : "decimal"}
        value={value}
        onChange={e => setValue(e.target.value)}
        placeholder={placeholder}
        min={0}
      />
    </div>
  );
}
