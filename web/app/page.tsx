"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { WaterTracker } from "./components/WaterTracker";
import { MacroSummaryCard } from "./components/MacroSummaryCard";
import { MealGroup } from "./components/MealGroup";
import { LogFoodModal } from "./components/LogFoodModal";
import { useNutritionGoals } from "./context/NutritionGoals";
import { addDaysISO, formatDateInAppTZ, noonInAppTZ, todayISOInAppTZ } from "./lib/date";
import { useWeightUnit, toKg, fromKg } from "./context/WeightUnit";

const API = "/api";

type DashboardData = {
  calories_in: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
  steps: number;
  active_calories_est: number;
};

type LogEntry = {
  id: string;
  meal: string;
  food_name: string;
  serving_label: string;
  servings: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type SessionSet = {
  set_number: number;
  weight_kg: number | null;
  reps_actual: number | null;
  completed: boolean;
};

type SessionExercise = {
  id: string;
  name: string;
  sets: number;
  reps_min: number;
  reps_max: number;
  logged_sets: SessionSet[];
  prev_logged_sets?: SessionSet[];
};

type WorkoutSessionDay = {
  session_id: string | null;
  program_id: string;
  program_name: string;
  exercises: SessionExercise[];
};

type FoodItem = {
  id: string;
  name: string;
  brand: string;
  serving_label: string;
  calories_per_serving: number;
  protein_g_per_serving: number;
  carbs_g_per_serving: number;
  fat_g_per_serving: number;
  fiber_g_per_serving: number;
};

function prevDay(d: string) { return addDaysISO(d, -1); }
function nextDay(d: string) { return addDaysISO(d, 1); }

function formatHeaderDate(dateStr: string) {
  return formatDateInAppTZ(dateStr);
}

function mealLabel(meal: string) {
  if (meal === "breakfast") return "Breakfast";
  if (meal === "lunch") return "Lunch";
  if (meal === "dinner") return "Dinner";
  const n = meal.match(/^snack_(\d+)$/)?.[1];
  return n ? `Snack ${n}` : meal;
}

function mealSortKey(meal: string) {
  if (meal === "breakfast") return 0;
  if (meal === "lunch") return 1;
  if (meal === "dinner") return 2;
  return 100 + Number(meal.match(/^snack_(\d+)$/)?.[1] || 999);
}

function groupByMeal(entries: LogEntry[]) {
  const map = new Map<string, LogEntry[]>();
  for (const e of entries) {
    const cur = map.get(e.meal) || [];
    cur.push(e);
    map.set(e.meal, cur);
  }
  return Array.from(map.entries())
    .sort((a, b) => mealSortKey(a[0]) - mealSortKey(b[0]))
    .map(([meal, rows]) => ({
      meal,
      entries: rows,
      totalKcal: rows.reduce((s, r) => s + r.calories, 0),
      totalProtein: rows.reduce((s, r) => s + r.protein_g, 0),
    }));
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LedgerInner />
    </Suspense>
  );
}

function LedgerInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { goals } = useNutritionGoals();
  const { unit } = useWeightUnit();
  const today = todayISOInAppTZ();
  const date = searchParams.get("date") || today;
  const isToday = date === today;

  const [data, setData] = useState<DashboardData | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);
  const [workoutSessions, setWorkoutSessions] = useState<WorkoutSessionDay[]>([]);

  // Steps modal state
  const [stepsModalOpen, setStepsModalOpen] = useState(false);
  const [stepsInput, setStepsInput] = useState("");
  const [savingSteps, setSavingSteps] = useState(false);

  async function submitSteps() {
    const steps = Math.max(0, Math.round(Number(stepsInput)));
    if (isNaN(steps)) return;
    setSavingSteps(true);
    try {
      const base = API.replace(/\/+$/, "");
      const activeKcal = Math.round(steps * 0.04);
      await fetch(`${base}/activity/daily`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date, steps, active_calories_est: activeKcal }),
      });
      await fetchAll();
      setStepsModalOpen(false);
    } catch { /* ignore */ }
    setSavingSteps(false);
  }

  // Add-to-meal modal state
  const [modalMeal, setModalMeal] = useState<string | null>(null);
  const [selectedFood, setSelectedFood] = useState("");
  const [foodSearch, setFoodSearch] = useState("");
  const [servings, setServings] = useState("1");
  const [logging, setLogging] = useState(false);
  const [logError, setLogError] = useState<string | null>(null);

  // New item modal state
  const [showNewItem, setShowNewItem] = useState(false);
  const [newItemName, setNewItemName] = useState("");
  const [creatingItem, setCreatingItem] = useState(false);
  const [newItemError, setNewItemError] = useState<string | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const base = API.replace(/\/+$/, "");
      const [dashRes, logRes, fiRes, wsRes] = await Promise.all([
        fetch(`${base}/dashboard/today?date=${date}`),
        fetch(`${base}/log/today?date=${date}`),
        fetch(`${base}/food-items`),
        fetch(`${base}/workout-sessions/day?date=${date}`),
      ]);
      if (!dashRes.ok) throw new Error("dashboard fetch failed");
      setData(await dashRes.json());
      setEntries(logRes.ok ? await logRes.json() : []);
      setFoodItems(fiRes.ok ? await fiRes.json() : []);
      setWorkoutSessions(wsRes.ok ? await wsRes.json() : []);
      setApiError(null);
    } catch {
      setApiError("Could not reach API. Check that the backend is running.");
    }
  }, [date]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  async function deleteEntry(id: string) {
    const base = API.replace(/\/+$/, "");
    const res = await fetch(`${base}/log/${id}`, { method: "DELETE" });
    if (res.ok) {
      setEntries(prev => prev.filter(e => e.id !== id));
      const dashRes = await fetch(`${base}/dashboard/today?date=${date}`);
      if (dashRes.ok) setData(await dashRes.json());
    }
  }

  function openModal(meal: string) {
    setModalMeal(meal);
    setSelectedFood("");
    setFoodSearch("");
    setServings("1");
    setLogError(null);
  }

  function closeModal() { setModalMeal(null); setFoodSearch(""); }

  async function submitLog() {
    if (!modalMeal || !selectedFood || Number(servings) <= 0) return;
    setLogging(true);
    setLogError(null);
    try {
      const base = API.replace(/\/+$/, "");
      const res = await fetch(`${base}/log/food`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({

          food_item_id: selectedFood,
          servings: Number(servings),
          meal: modalMeal,
          occurred_at: isToday ? new Date().toISOString() : noonInAppTZ(date).toISOString(),
        }),
      });
      if (res.ok) {
        fetch(`${API}/pantry/deduct`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ food_item_id: selectedFood, servings: Number(servings) }),
        }).catch(() => {});
        await fetchAll();
        router.refresh();
        closeModal();
      } else {
        const body = await res.json().catch(() => ({}));
        setLogError(body?.error || "Error logging food");
      }
    } catch {
      setLogError("Could not reach API");
    }
    setLogging(false);
  }

  async function createNewItem() {
    const name = newItemName.trim();
    if (!name) return;
    setCreatingItem(true);
    setNewItemError(null);
    try {
      const base = API.replace(/\/+$/, "");
      const res = await fetch(`${base}/recipes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, instructions: "", yield_count: 1 }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok && body.id) {
        window.location.href = `/recipes/${body.id}`;
        return;
      }
      setNewItemError(body?.error || "Could not create item");
    } catch {
      setNewItemError("Could not reach API");
    }
    setCreatingItem(false);
  }

  async function startWorkoutSession(programId: string) {
    const res = await fetch(`${API}/workout-sessions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ program_id: programId, date }),
    });
    if (res.ok) {
      await fetchAll();
    }
  }

  async function upsertSet(
    sessionId: string,
    exerciseId: string,
    setNumber: number,
    weightKg: number | null,
    repsActual: number | null,
    completed: boolean,
  ) {
    await fetch(`${API}/workout-session-sets`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        exercise_id: exerciseId,
        set_number: setNumber,
        weight_kg: weightKg,
        reps_actual: repsActual,
        completed,
      }),
    });
    // Optimistic update
    setWorkoutSessions(prev =>
      prev.map(s => {
        if (s.session_id !== sessionId) return s;
        return {
          ...s,
          exercises: s.exercises.map(ex => {
            if (ex.id !== exerciseId) return ex;
            return {
              ...ex,
              logged_sets: ex.logged_sets.map(ls =>
                ls.set_number === setNumber
                  ? { ...ls, weight_kg: weightKg, reps_actual: repsActual, completed }
                  : ls
              ),
            };
          }),
        };
      })
    );
  }

  const net = data ? data.calories_in - data.active_calories_est : 0;
  const remaining = data ? goals.calories - data.calories_in : 0;

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <button
            className="btn btn-ghost"
            onClick={() => router.push(`/?date=${prevDay(date)}`)}
            style={{ padding: "4px 12px", fontSize: 16 }}
          >‹</button>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", flex: 1, textAlign: "center" }}>
            Ledger
          </h1>
          <button
            className="btn btn-ghost"
            onClick={() => { if (!isToday) router.push(`/?date=${nextDay(date)}`); }}
            style={{ padding: "4px 12px", fontSize: 16, opacity: isToday ? 0.5 : 1 }}
            disabled={isToday}
          >›</button>
        </div>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2, textAlign: "center" }}>
          {formatHeaderDate(date)}
        </p>
      </div>

      {apiError ? (
        <div className="card" style={{ color: "var(--danger)" }}>{apiError}</div>
      ) : !data ? (
        <div className="card" style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
      ) : (
        <>
          {/* Stat cards */}
          <div className="stat-grid">
            <StatCard
              label="Calories In"
              value={Math.round(data.calories_in)}
              unit="kcal"
              accent="var(--accent)"
              sub={`Goal: ${goals.calories} kcal`}
              pct={data.calories_in / goals.calories}
            />
            <StatCard
              label="Active Burn"
              value={Math.round(data.active_calories_est)}
              unit="kcal"
              accent="var(--accent3)"
              sub="Estimated"
            />
            <StatCard
              label="Net Calories"
              value={Math.round(net)}
              unit="kcal"
              accent={net > goals.calories ? "var(--danger)" : "var(--accent2)"}
              sub={remaining >= 0 ? `${Math.round(remaining)} remaining` : `${Math.round(-remaining)} over goal`}
            />
            <StatCard
              label="Steps"
              value={data.steps.toLocaleString()}
              unit=""
              accent="var(--muted)"
              sub="Tap to update"
              onClick={() => { setStepsInput(String(data.steps || "")); setStepsModalOpen(true); }}
            />
          </div>

          {/* Macros + Water row */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14, alignItems: "stretch" }}>
            <div style={{ gridColumn: "1 / 4", minWidth: 0 }}>
              <MacroSummaryCard
                protein_g={data.protein_g}
                carbs_g={data.carbs_g}
                fat_g={data.fat_g}
                fiber_g={data.fiber_g}
              />
            </div>
            <WaterTracker date={date} />
          </div>

          {/* Workout card */}
          {workoutSessions.length > 0 && (
            <div className="card" style={{ marginTop: 16, padding: 0, overflow: "hidden" }}>
              {workoutSessions.map(session => (
                <WorkoutSessionPanel
                  key={session.program_id}
                  session={session}
                  unit={unit}
                  onStart={() => startWorkoutSession(session.program_id)}
                  onUpsertSet={(exId, setNum, wkg, reps, done) =>
                    upsertSet(session.session_id!, exId, setNum, wkg, reps, done)
                  }
                />
              ))}
            </div>
          )}

          {/* Food log */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-label" style={{ marginBottom: 12 }}>Food Log</div>
            {entries.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>No entries for this day.</div>
            ) : (
              <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                {groupByMeal(entries).map(section => (
                  <MealGroup
                    key={section.meal}
                    section={section}
                    mealLabel={mealLabel}
                    onDelete={deleteEntry}
                    onOpenLog={openModal}
                  />
                ))}
              </div>
            )}

            {/* Quick-add buttons for meals with no entries yet */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {(["breakfast", "lunch", "dinner"] as const).map(meal => (
                entries.some(e => e.meal === meal) ? null : (
                  <button
                    key={meal}
                    className="btn btn-ghost"
                    onClick={() => openModal(meal)}
                    style={{ fontSize: 12, padding: "4px 10px" }}
                  >
                    + {mealLabel(meal)}
                  </button>
                )
              ))}
            </div>
          </div>
        </>
      )}

      {/* Add food modal */}
      {modalMeal && (
        <LogFoodModal
          meal={modalMeal}
          foodItems={foodItems}
          foodSearch={foodSearch}
          selectedFood={selectedFood}
          servings={servings}
          logging={logging}
          logError={logError}
          mealLabel={mealLabel}
          onFoodSearchChange={val => { setFoodSearch(val); setSelectedFood(""); }}
          onFoodSelect={(id, name, brand) => { setSelectedFood(id); setFoodSearch(name + (brand ? ` (${brand})` : "")); setServings("1"); }}
          onServingsChange={setServings}
          onClose={closeModal}
          onSubmit={submitLog}
          onNewItem={() => { closeModal(); setShowNewItem(true); setNewItemName(""); setNewItemError(null); }}
        />
      )}

      {/* Steps modal */}
      {stepsModalOpen && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setStepsModalOpen(false); }}>
          <div className="modal">
            <div className="modal-title">Update Steps</div>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label className="field-label">Steps</label>
                <input
                  autoFocus
                  type="number"
                  min="0"
                  placeholder="e.g. 8000"
                  value={stepsInput}
                  onChange={e => setStepsInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") submitSteps(); }}
                />
              </div>
              {stepsInput && Number(stepsInput) >= 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)" }}>
                  Active burn estimate: {Math.round(Number(stepsInput) * 0.04)} kcal
                </div>
              )}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setStepsModalOpen(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submitSteps}
                disabled={savingSteps || !stepsInput}
              >
                {savingSteps ? "…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* New item modal */}
      {showNewItem && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setShowNewItem(false); }}>
          <div className="modal">
            <div className="modal-title">New Food Item</div>
            <div style={{ display: "grid", gap: 14 }}>
              <div>
                <label className="field-label">Name</label>
                <input
                  autoFocus
                  placeholder="e.g. Chicken breast"
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") createNewItem(); }}
                />
              </div>
              <div style={{ fontSize: 12, color: "var(--muted)" }}>
                You'll be taken to the item detail page to fill in macros and recipe info.
              </div>
              {newItemError && <div className="pill pill-err">{newItemError}</div>}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
              <button className="btn btn-ghost" onClick={() => setShowNewItem(false)}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={createNewItem}
                disabled={!newItemName.trim() || creatingItem}
              >
                {creatingItem ? "…" : "Create & Edit"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function SetRow({
  set,
  unit,
  onUpdate,
}: {
  set: SessionSet;
  unit: import("./context/WeightUnit").WeightUnit;
  onUpdate: (weightKg: number | null, repsActual: number | null, completed: boolean) => void;
}) {
  const [weightInput, setWeightInput] = useState(
    set.weight_kg != null ? fromKg(set.weight_kg, unit).toFixed(1) : ""
  );
  const [repsInput, setRepsInput] = useState(
    set.reps_actual != null ? String(set.reps_actual) : ""
  );

  function commit(rawWeight: string, rawReps: string, done: boolean) {
    const wNum = rawWeight !== "" ? parseFloat(rawWeight) : null;
    const rNum = rawReps !== "" ? parseInt(rawReps, 10) : null;
    onUpdate(
      wNum != null && !isNaN(wNum) ? toKg(wNum, unit) : null,
      rNum != null && !isNaN(rNum) ? rNum : null,
      done,
    );
  }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "28px 1fr 1fr 32px", gap: 6, alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600, textAlign: "center" }}>
        {set.set_number}
      </span>
      <input
        type="number"
        min={0}
        step={0.5}
        placeholder={`wt (${unit})`}
        value={weightInput}
        onChange={e => setWeightInput(e.target.value)}
        style={{ fontSize: 13 }}
        onBlur={() => commit(weightInput, repsInput, set.completed)}
      />
      <input
        type="number"
        min={0}
        placeholder="reps"
        value={repsInput}
        onChange={e => setRepsInput(e.target.value)}
        style={{ fontSize: 13 }}
        onBlur={() => commit(weightInput, repsInput, set.completed)}
      />
      <button
        type="button"
        onClick={() => commit(weightInput, repsInput, !set.completed)}
        style={{
          width: 28,
          height: 28,
          borderRadius: "var(--radius-sm)",
          border: `2px solid ${set.completed ? "var(--accent)" : "var(--border)"}`,
          background: set.completed ? "var(--accent)" : "transparent",
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 14,
          color: set.completed ? "#fff" : "var(--muted)",
          transition: "all 0.15s",
        }}
        title={set.completed ? "Mark incomplete" : "Mark complete"}
      >
        {set.completed ? "✓" : ""}
      </button>
    </div>
  );
}

function setLogSummary(sets: SessionSet[] | undefined | null, unit: import("./context/WeightUnit").WeightUnit) {
  if (!sets?.length) return null;
  return sets.map(s => {
    const w = s.weight_kg != null ? `${fromKg(s.weight_kg, unit).toFixed(1).replace(/\.0$/, "")}×` : "";
    return `${w}${s.reps_actual ?? "?"}`;
  }).join(" | ");
}

function WorkoutSessionPanel({
  session,
  unit,
  onStart,
  onUpsertSet,
}: {
  session: WorkoutSessionDay;
  unit: import("./context/WeightUnit").WeightUnit;
  onStart: () => void;
  onUpsertSet: (exId: string, setNum: number, wkg: number | null, reps: number | null, done: boolean) => void;
}) {
  const storageKey = `intake_workout_open_${session.program_id}`;
  const [open, setOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored !== null) return stored === "1";
    } catch { /* ignore */ }
    return !!session.session_id;
  });

  async function toggle() {
    const next = !open;
    setOpen(next);
    try { localStorage.setItem(storageKey, next ? "1" : "0"); } catch { /* ignore */ }
    if (next && !session.session_id) onStart();
  }

  const allDone = session.session_id != null &&
    session.exercises.every(ex => ex.logged_sets.every(s => s.completed));

  return (
    <div style={{ borderRadius: "var(--radius-sm)", border: "1px solid var(--border)", overflow: "hidden" }}>
      <button
        type="button"
        onClick={toggle}
        style={{
          width: "100%",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 12px",
          background: "var(--surface2)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: 14, color: "#fff" }}>{session.program_name}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {allDone && (
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", background: "color-mix(in srgb, var(--accent) 12%, transparent)", padding: "2px 8px", borderRadius: 999 }}>
              Done
            </span>
          )}
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{open ? "▲" : "▼"}</span>
        </span>
      </button>

      {open && (
        <div style={{ padding: "12px", display: "grid", gap: 14 }}>
          {session.exercises.map(ex => (
            <div key={ex.id}>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6, display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
                {ex.name}
                <span style={{ fontWeight: 400, fontSize: 11, color: "var(--muted)" }}>
                  {ex.sets} × {ex.reps_min === ex.reps_max ? ex.reps_min : `${ex.reps_min}–${ex.reps_max}`} reps
                </span>
                {setLogSummary(ex.prev_logged_sets ?? [], unit) && (
                  <span style={{ fontWeight: 500, fontSize: 11, color: "var(--accent2)", marginLeft: 2 }}>
                    {setLogSummary(ex.prev_logged_sets ?? [], unit)}
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gap: 4 }}>
                {ex.logged_sets.map(ls => (
                  <SetRow
                    key={ls.set_number}
                    set={ls}
                    unit={unit}
                    onUpdate={(wkg, reps, done) => onUpsertSet(ex.id, ls.set_number, wkg, reps, done)}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, unit, accent, sub, pct, onClick,
}: {
  label: string; value: number | string; unit: string; accent: string; sub?: string; pct?: number; onClick?: () => void;
}) {
  return (
    <div
      className="card"
      style={{ borderTop: `3px solid ${accent}`, cursor: onClick ? "pointer" : undefined }}
      onClick={onClick}
    >
      <div className="card-label">{label}</div>
      <div className="card-value" style={{ color: accent }}>
        {value}<span style={{ fontSize: 14, fontWeight: 600, marginLeft: 4, color: "var(--muted)" }}>{unit}</span>
      </div>
      {sub && <div className="card-sub">{sub}</div>}
      {pct !== undefined && (
        <div style={{ marginTop: 10, height: 4, background: "var(--surface2)", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${Math.min(pct * 100, 100)}%`, background: accent, borderRadius: 99, transition: "width 0.4s" }} />
        </div>
      )}
    </div>
  );
}
