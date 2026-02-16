"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { WaterTracker } from "./components/WaterTracker";
import { addDaysISO, todayISOInAppTZ } from "./lib/date";
import { Suspense } from "react";

const CALORIE_GOAL = 2200;
const PROTEIN_GOAL = 180;
const CARBS_GOAL = 220;
const FAT_GOAL = 70;
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
      // Refresh dashboard totals
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
        // Fire-and-forget pantry deduction
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

  const selectedItem = foodItems.find(f => f.id === selectedFood);
  const kcalPreview = selectedItem && Number(servings) > 0
    ? Math.round(Number(servings) * selectedItem.calories_per_serving)
    : null;

  const net = data ? data.calories_in - data.active_calories_est : 0;
  const remaining = data ? CALORIE_GOAL - data.calories_in : 0;

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
              sub={`Goal: ${CALORIE_GOAL} kcal`}
              pct={data.calories_in / CALORIE_GOAL}
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
              accent={net > CALORIE_GOAL ? "var(--danger)" : "var(--accent2)"}
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

          {/* Macros */}
          <div className="card">
            <div className="card-label" style={{ marginBottom: 16 }}>Macros</div>
            <MacroBar label="Protein" value={data.protein_g} goal={PROTEIN_GOAL} color="var(--accent)" />
            <MacroBar label="Carbs"   value={data.carbs_g}   goal={CARBS_GOAL}   color="var(--accent3)" />
            <MacroBar label="Fat"     value={data.fat_g}     goal={FAT_GOAL}     color="var(--danger)" />
            <MacroBar label="Fiber"   value={data.fiber_g}   goal={30}           color="var(--accent2)" />
          </div>

          <WaterTracker date={date} />

          {/* Food log */}
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-label" style={{ marginBottom: 12 }}>Food Log</div>
            {entries.length === 0 ? (
              <div style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12 }}>No entries for this day.</div>
            ) : (
              <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
                {groupByMeal(entries).map(section => (
                  <div key={section.meal} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                    <div style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 10px", background: "var(--surface2)", fontSize: 12, fontWeight: 700,
                    }}>
                      <span>{mealLabel(section.meal)}</span>
                      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                        <span style={{ color: "var(--muted)" }}>{Math.round(section.totalKcal)} kcal · <span style={{ color: "var(--accent)" }}>{Math.round(section.totalProtein)}g P</span></span>
                        <button
                          className="btn btn-ghost"
                          onClick={() => openModal(section.meal)}
                          style={{ fontSize: 12, padding: "2px 8px" }}
                        >+ Add</button>
                      </div>
                    </div>
                    <div style={{ display: "grid", gap: 1 }}>
                      {section.entries.map(e => (
                        <div key={e.id} style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: 10, padding: "8px 10px", alignItems: "center" }}>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{e.food_name}</div>
                            <div style={{ fontSize: 12, color: "var(--muted)" }}>
                              {e.servings === 1 ? e.serving_label : `${e.servings} × ${e.serving_label}`}
                            </div>
                          </div>
                          <div style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap", textAlign: "right" }}>
                            <span>{Math.round(e.calories)} kcal</span>
                            <span style={{ color: "var(--accent)", marginLeft: 8 }}>{e.protein_g.toFixed(1)}g P</span>
                          </div>
                          <button
                            onClick={() => deleteEntry(e.id)}
                            style={{ background: "none", color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
                            title="Remove"
                          >×</button>
                        </div>
                      ))}
                    </div>
                  </div>
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
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal">
            <div className="modal-title">Add to {mealLabel(modalMeal)}</div>
            <div style={{ display: "grid", gap: 14 }}>
              <div style={{ position: "relative" }}>
                <label className="field-label">Food item</label>
                <input
                  autoFocus
                  placeholder="Search…"
                  value={foodSearch}
                  onChange={e => { setFoodSearch(e.target.value); setSelectedFood(""); }}
                />
                {foodSearch.trim() && !selectedFood && (() => {
                  const q = foodSearch.trim().toLowerCase();
                  const matches = foodItems.filter(f =>
                    f.name.toLowerCase().includes(q) || (f.brand && f.brand.toLowerCase().includes(q))
                  ).slice(0, 8);
                  return matches.length > 0 ? (
                    <div style={{
                      position: "absolute", top: "100%", left: 0, right: 0, zIndex: 50,
                      background: "var(--surface)", border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)", boxShadow: "0 4px 16px rgba(0,0,0,0.15)",
                      maxHeight: 220, overflowY: "auto",
                    }}>
                      {matches.map(f => (
                        <div
                          key={f.id}
                          onMouseDown={() => { setSelectedFood(f.id); setFoodSearch(f.name + (f.brand ? ` (${f.brand})` : "")); setServings("1"); }}
                          style={{ padding: "8px 12px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
                          onMouseLeave={e => (e.currentTarget.style.background = "")}
                        >
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}{f.brand ? ` (${f.brand})` : ""}</div>
                          <div style={{ fontSize: 11, color: "var(--muted)" }}>{f.serving_label} · {Math.round(f.calories_per_serving)} kcal · {f.protein_g_per_serving}g P</div>
                        </div>
                      ))}
                    </div>
                  ) : null;
                })()}
              </div>
              <div>
                <label className="field-label">Servings</label>
                <input
                  type="number"
                  inputMode="decimal"
                  value={servings}
                  onChange={e => setServings(e.target.value)}
                  min={0.25}
                  step={0.5}
                />
                {kcalPreview !== null && (
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>~{kcalPreview} kcal</div>
                )}
              </div>
              {logError && <div className="pill pill-err">{logError}</div>}
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 20, alignItems: "center" }}>
              <button
                className="btn btn-ghost"
                style={{ fontSize: 12, marginRight: "auto" }}
                onClick={() => { closeModal(); setShowNewItem(true); setNewItemName(""); setNewItemError(null); }}
              >
                + New item
              </button>
              <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
              <button
                className="btn btn-primary"
                onClick={submitLog}
                disabled={!selectedFood || Number(servings) <= 0 || logging}
              >
                {logging ? "…" : "Add"}
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

function MacroBar({ label, value, goal, color }: { label: string; value: number; goal: number; color: string }) {
  const pct = Math.min((value / goal) * 100, 100);
  return (
    <div className="macro-row">
      <div className="macro-label">{label}</div>
      <div className="macro-bar-track">
        <div className="macro-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="macro-val">{Math.round(value)}<span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 2 }}>g</span></div>
    </div>
  );
}
