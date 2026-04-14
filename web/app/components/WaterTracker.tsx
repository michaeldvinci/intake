"use client";

import { useEffect, useState } from "react";

const WATER_GOAL_KEY = "intake_water_goal";
const DEFAULT_GOAL = 8;
const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

function clampGoal(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_GOAL;
  return Math.max(1, Math.min(24, Math.round(value)));
}

export function WaterTracker({ date }: { date: string }) {
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [drank, setDrank] = useState(0);

  useEffect(() => {
    const storedGoal = Number(localStorage.getItem(WATER_GOAL_KEY));
    setGoal(clampGoal(storedGoal || DEFAULT_GOAL));
  }, []);

  useEffect(() => {
    fetch(`${API}/activity/water?user_id=${USER_ID}&date=${date}`)
      .then(r => r.ok ? r.json() : { glasses: 0 })
      .then(data => setDrank(Math.max(0, Number(data.glasses) || 0)))
      .catch(() => setDrank(0));
  }, [date]);

  function save(next: number) {
    setDrank(next);
    fetch(`${API}/activity/water`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, date, glasses: next }),
    }).catch(() => {});
  }

  const pct = Math.min(drank / goal, 1);
  const textLight = pct > 0.55;

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
      <div className="card-label" style={{ marginBottom: 0, alignSelf: "flex-start" }}>Water</div>

      {/* Cup */}
      <button
        type="button"
        onClick={() => save(Math.min(drank + 1, goal))}
        title="Add a glass"
        style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 0 }}
      >
        {/* Rim */}
        <div style={{
          width: 72,
          height: 6,
          background: "var(--border)",
          borderRadius: "3px 3px 0 0",
        }} />
        {/* Body */}
        <div style={{
          width: 62,
          height: 96,
          border: "2px solid var(--border)",
          borderTop: "none",
          borderRadius: "0 0 10px 10px",
          position: "relative",
          overflow: "hidden",
          background: "var(--surface2)",
        }}>
          {/* Fill */}
          <div style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: `${pct * 100}%`,
            background: "var(--accent2)",
            transition: "height 0.25s ease",
          }} />
          {/* Label */}
          <div style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1,
            fontSize: 13,
            fontWeight: 700,
            color: textLight ? "#fff" : "var(--fg)",
            transition: "color 0.25s ease",
          }}>
            {drank}/{goal}
          </div>
        </div>
      </button>

      {/* Decrement */}
      <button
        type="button"
        onClick={() => save(Math.max(drank - 1, 0))}
        disabled={drank === 0}
        style={{
          background: "none",
          border: "none",
          cursor: drank === 0 ? "default" : "pointer",
          fontSize: 11,
          color: drank === 0 ? "var(--border)" : "var(--muted)",
          padding: "2px 6px",
        }}
      >
        − glass
      </button>
    </div>
  );
}
