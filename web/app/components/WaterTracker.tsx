"use client";

import { useEffect, useMemo, useState } from "react";

const WATER_GOAL_KEY = "intake_water_goal";
const WATER_INTAKE_PREFIX = "intake_water_intake_";
const DEFAULT_GOAL = 8;

function clampGoal(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_GOAL;
  return Math.max(1, Math.min(24, Math.round(value)));
}

export function WaterTracker({ date }: { date: string }) {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [drank, setDrank] = useState(0);
  const intakeKey = useMemo(() => `${WATER_INTAKE_PREFIX}${date}`, [date]);

  useEffect(() => {
    const storedGoal = Number(localStorage.getItem(WATER_GOAL_KEY));
    setGoal(clampGoal(storedGoal || DEFAULT_GOAL));
  }, []);

  useEffect(() => {
    const stored = Number(localStorage.getItem(intakeKey));
    const next = Number.isFinite(stored) ? Math.max(0, Math.min(stored, goal)) : 0;
    setDrank(next);
  }, [goal, intakeKey]);

  function setDrankAt(index: number) {
    const clicked = index + 1;
    const next = clicked === drank ? Math.max(0, drank - 1) : clicked;
    setDrank(next);
    localStorage.setItem(intakeKey, String(next));
  }

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div className="card-label" style={{ marginBottom: 0 }}>Water</div>
        <div style={{ fontSize: 12, color: "var(--muted)" }}>{drank}/{goal} glasses</div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {Array.from({ length: goal }).map((_, i) => {
          const filled = i < drank;
          return (
            <button
              key={i}
              type="button"
              onClick={() => setDrankAt(i)}
              title={`Glass ${i + 1}`}
              aria-label={`Glass ${i + 1}`}
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                border: "1px solid var(--border)",
                background: filled ? "var(--accent2)" : "var(--surface2)",
                opacity: filled ? 1 : 0.6,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
