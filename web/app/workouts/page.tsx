"use client";

import { useState, useEffect, useCallback } from "react";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Exercise = {
  id: string;
  program_id: string;
  name: string;
  sets: number;
  reps_min: number;
  reps_max: number;
  sort_order: number;
};

type Program = {
  id: string;
  name: string;
  days: number[];
  exercises: Exercise[];
  created_at: string;
};

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function WorkoutsPage() {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  // Create program form
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDays, setNewDays] = useState<number[]>([]);
  const [creating, setCreating] = useState(false);

  // Add exercise state: keyed by program id
  const [showAddEx, setShowAddEx] = useState<string | null>(null);
  const [exName, setExName] = useState("");
  const [exSets, setExSets] = useState("3");
  const [exRepsMin, setExRepsMin] = useState("8");
  const [exRepsMax, setExRepsMax] = useState("10");
  const [addingEx, setAddingEx] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/workout-programs?user_id=${USER_ID}`);
      if (res.ok) setPrograms(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createProgram(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const res = await fetch(`${API}/workout-programs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newName.trim(), days: newDays }),
      });
      if (res.ok) {
        setNewName("");
        setNewDays([]);
        setShowCreate(false);
        await load();
      }
    } finally {
      setCreating(false);
    }
  }

  async function deleteProgram(id: string) {
    await fetch(`${API}/workout-programs/${id}?user_id=${USER_ID}`, { method: "DELETE" });
    await load();
  }

  async function addExercise(programId: string) {
    if (!exName.trim()) return;
    setAddingEx(true);
    try {
      const res = await fetch(`${API}/workout-programs/${programId}/exercises`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: exName.trim(),
          sets: parseInt(exSets) || 3,
          reps_min: parseInt(exRepsMin) || 8,
          reps_max: parseInt(exRepsMax) || 10,
          sort_order: programs.find(p => p.id === programId)?.exercises.length ?? 0,
        }),
      });
      if (res.ok) {
        setExName("");
        setExSets("3");
        setExRepsMin("8");
        setExRepsMax("10");
        setShowAddEx(null);
        await load();
      }
    } finally {
      setAddingEx(false);
    }
  }

  async function deleteExercise(programId: string, exerciseId: string) {
    await fetch(`${API}/workout-programs/${programId}/exercises/${exerciseId}`, { method: "DELETE" });
    await load();
  }

  function toggleDay(d: number) {
    setNewDays(prev =>
      prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort()
    );
  }

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Workouts</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>
          Define programs here. Scheduled days show up on the Ledger to log.
        </p>
      </div>

      {/* Create program */}
      <div className="card" style={{ marginBottom: 16 }}>
        {!showCreate ? (
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>
            + New Program
          </button>
        ) : (
          <form onSubmit={createProgram} style={{ display: "grid", gap: 12 }}>
            <div>
              <div className="field-label">Program name</div>
              <input
                autoFocus
                type="text"
                placeholder="e.g. Full Body Strength"
                value={newName}
                onChange={e => setNewName(e.target.value)}
                style={{ width: "100%" }}
                required
              />
            </div>
            <div>
              <div className="field-label">Days of the week</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 4 }}>
                {DAY_NAMES.map((label, d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => toggleDay(d)}
                    className="btn btn-ghost"
                    style={{
                      fontSize: 12,
                      padding: "4px 12px",
                      borderRadius: 999,
                      fontWeight: newDays.includes(d) ? 700 : 400,
                      background: newDays.includes(d) ? "var(--accent)" : undefined,
                      color: newDays.includes(d) ? "#fff" : undefined,
                      border: newDays.includes(d) ? "1px solid var(--accent)" : undefined,
                    }}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={creating}>
                {creating ? "Saving…" : "Save"}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => setShowCreate(false)}>
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Program list */}
      {loading ? (
        <div className="card" style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
      ) : programs.length === 0 ? (
        <div className="card" style={{ color: "var(--muted)", fontSize: 13 }}>
          No programs yet. Create one above and add exercises to it.
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {programs.map(prog => (
            <div key={prog.id} className="card">
              {/* Program header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                <div>
                  <div style={{ fontWeight: 800, fontSize: 16 }}>{prog.name}</div>
                  <div style={{ display: "flex", gap: 4, marginTop: 5, flexWrap: "wrap" }}>
                    {DAY_NAMES.map((label, d) => (
                      <span
                        key={d}
                        style={{
                          fontSize: 11,
                          padding: "2px 8px",
                          borderRadius: 999,
                          fontWeight: 600,
                          background: prog.days.includes(d) ? "var(--accent)" : "var(--surface2)",
                          color: prog.days.includes(d) ? "#fff" : "var(--muted)",
                        }}
                      >
                        {label}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 13, color: "var(--muted)", padding: "2px 8px" }}
                  onClick={() => deleteProgram(prog.id)}
                  title="Delete program"
                >
                  ×
                </button>
              </div>

              {/* Exercises */}
              {prog.exercises.length > 0 && (
                <div style={{ display: "grid", gap: 0, marginBottom: 12, borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border)" }}>
                  {/* Header row */}
                  <div style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 60px 100px 28px",
                    gap: 8,
                    padding: "6px 10px",
                    background: "var(--surface2)",
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                  }}>
                    <span>Exercise</span>
                    <span>Sets</span>
                    <span>Reps</span>
                    <span></span>
                  </div>
                  {prog.exercises.map((ex, i) => (
                    <div
                      key={ex.id}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "1fr 60px 100px 28px",
                        gap: 8,
                        padding: "8px 10px",
                        alignItems: "center",
                        borderTop: i > 0 ? "1px solid var(--border)" : undefined,
                        fontSize: 13,
                      }}
                    >
                      <span style={{ fontWeight: 500 }}>{ex.name}</span>
                      <span style={{ color: "var(--muted)" }}>{ex.sets}</span>
                      <span style={{ color: "var(--muted)" }}>
                        {ex.reps_min === ex.reps_max ? ex.reps_min : `${ex.reps_min}–${ex.reps_max}`}
                      </span>
                      <button
                        className="btn btn-ghost"
                        style={{ width: 24, height: 24, padding: 0, fontSize: 14, color: "var(--muted)" }}
                        onClick={() => deleteExercise(prog.id, ex.id)}
                        title="Remove exercise"
                      >×</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Add exercise */}
              {showAddEx === prog.id ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <input
                    autoFocus
                    type="text"
                    placeholder="Exercise name (e.g. Goblet squat)"
                    value={exName}
                    onChange={e => setExName(e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") addExercise(prog.id); if (e.key === "Escape") setShowAddEx(null); }}
                    style={{ width: "100%" }}
                  />
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                    <div>
                      <div className="field-label">Sets</div>
                      <input type="number" min={1} value={exSets} onChange={e => setExSets(e.target.value)} style={{ width: "100%" }} />
                    </div>
                    <div>
                      <div className="field-label">Reps min</div>
                      <input type="number" min={0} value={exRepsMin} onChange={e => setExRepsMin(e.target.value)} style={{ width: "100%" }} />
                    </div>
                    <div>
                      <div className="field-label">Reps max</div>
                      <input type="number" min={0} value={exRepsMax} onChange={e => setExRepsMax(e.target.value)} style={{ width: "100%" }} />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn btn-primary" onClick={() => addExercise(prog.id)} disabled={addingEx || !exName.trim()}>
                      {addingEx ? "Adding…" : "Add"}
                    </button>
                    <button className="btn btn-ghost" onClick={() => setShowAddEx(null)}>Cancel</button>
                  </div>
                </div>
              ) : (
                <button
                  className="btn btn-ghost"
                  style={{ fontSize: 12, padding: "4px 10px" }}
                  onClick={() => { setShowAddEx(prog.id); setExName(""); setExSets("3"); setExRepsMin("8"); setExRepsMax("10"); }}
                >
                  + Add exercise
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
