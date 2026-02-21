"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { WaterTracker } from "./components/WaterTracker";
import { MacroSummaryCard } from "./components/MacroSummaryCard";
import { MealGroup } from "./components/MealGroup";
import { LogFoodModal } from "./components/LogFoodModal";
import { useNutritionGoals } from "./context/NutritionGoals";
import { addDaysISO, todayISOInAppTZ } from "./lib/date";

const USER_ID = "00000000-0000-0000-0000-000000000001";
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
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
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
  const today = todayISOInAppTZ();
  const date = searchParams.get("date") || today;
  const isToday = date === today;

  const [data, setData] = useState<DashboardData | null>(null);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [apiError, setApiError] = useState<string | null>(null);

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
      const [dashRes, logRes, fiRes] = await Promise.all([
        fetch(`${base}/dashboard/today?user_id=${USER_ID}&date=${date}`),
        fetch(`${base}/log/today?user_id=${USER_ID}&date=${date}`),
        fetch(`${base}/food-items`),
      ]);
      if (!dashRes.ok) throw new Error("dashboard fetch failed");
      setData(await dashRes.json());
      setEntries(logRes.ok ? await logRes.json() : []);
      setFoodItems(fiRes.ok ? await fiRes.json() : []);
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
      const dashRes = await fetch(`${base}/dashboard/today?user_id=${USER_ID}&date=${date}`);
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
          user_id: USER_ID,
          food_item_id: selectedFood,
          servings: Number(servings),
          meal: modalMeal,
          occurred_at: isToday ? new Date().toISOString() : date + "T12:00:00.000Z",
        }),
      });
      if (res.ok) {
        fetch(`${API}/pantry/deduct?user_id=${USER_ID}`, {
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
        body: JSON.stringify({ user_id: USER_ID, name, instructions: "", yield_count: 1 }),
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
              sub="Today"
            />
          </div>

          <MacroSummaryCard
            protein_g={data.protein_g}
            carbs_g={data.carbs_g}
            fat_g={data.fat_g}
            fiber_g={data.fiber_g}
          />
          <WaterTracker date={date} />

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

function StatCard({
  label, value, unit, accent, sub, pct,
}: {
  label: string; value: number | string; unit: string; accent: string; sub?: string; pct?: number;
}) {
  return (
    <div className="card" style={{ borderTop: `3px solid ${accent}` }}>
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
