"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { addDaysISO, todayISOInAppTZ } from "../lib/date";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

function prevDay(dateStr: string) {
  return addDaysISO(dateStr, -1);
}
function nextDay(dateStr: string) {
  return addDaysISO(dateStr, 1);
}
function formatDate(dateStr: string) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

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

type LogEntry = {
  id: string;
  meal: string;
  food_item_id: string;
  food_name: string;
  serving_label: string;
  servings: number;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

type FoodForm = {
  name: string; brand: string; serving_label: string;
  calories: string; protein: string; carbs: string; fat: string; fiber: string;
};
type RecipeIngredientDraft = {
  key: string;
  food_item_id: string;
  amount_g: string;
};

function newDraftKey() {
  const maybeUUID = globalThis.crypto?.randomUUID?.();
  if (maybeUUID) return maybeUUID;
  return `draft_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

const emptyForm = (): FoodForm => ({
  name: "", brand: "", serving_label: "",
  calories: "", protein: "", carbs: "", fat: "", fiber: "",
});

const FIXED_MEALS = ["breakfast", "lunch", "dinner"] as const;

function mealLabel(meal: string) {
  if (meal === "breakfast") return "Breakfast";
  if (meal === "lunch") return "Lunch";
  if (meal === "dinner") return "Dinner";
  const n = meal.match(/^snack_(\d+)$/)?.[1];
  return n ? `Snack ${n}` : meal;
}

// Modal mode: either logging food to a meal, or creating a new food item
type ModalState =
  | { mode: "log"; meal: string }
  | { mode: "new-food" }
  | null;

export default function LogPage() {
  return (
    <Suspense fallback={null}>
      <LogPageInner />
    </Suspense>
  );
}

function LogPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const today = todayISOInAppTZ();
  const date = searchParams.get("date") || today;
  const isToday = date === today;
  const apiBases = useMemo(() => {
    const bases: string[] = [];
    if (API) bases.push(API.replace(/\/+$/, ""));
    if (typeof window !== "undefined") {
      const origin = window.location.origin.replace(/\/+$/, "");
      if (!bases.includes(origin)) bases.push(origin);
      const proto = window.location.protocol;
      const host = window.location.hostname;
      const with8088 = `${proto}//${host}:8088`;
      const with8080 = `${proto}//${host}:8080`;
      if (!bases.includes(with8088)) bases.push(with8088);
      if (!bases.includes(with8080)) bases.push(with8080);
    }
    return bases;
  }, []);

  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [snackIds, setSnackIds] = useState<string[]>([]);

  const [modal, setModal] = useState<ModalState>(null);

  // Log food state
  const [selectedFood, setSelectedFood] = useState("");
  const [foodSearch, setFoodSearch] = useState("");
  const [servings, setServings] = useState("1");
  const [logging, setLogging] = useState(false);
  const [logStatus, setLogStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  // New food item state
  const [form, setForm] = useState(emptyForm());
  const [recipeInstructions, setRecipeInstructions] = useState("");
  const [recipeYield, setRecipeYield] = useState("1");
  const [recipeIngredients, setRecipeIngredients] = useState<RecipeIngredientDraft[]>([]);
  const [ingredientFoodID, setIngredientFoodID] = useState("");
  const [ingredientAmount, setIngredientAmount] = useState("100");
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [showRecipeFields, setShowRecipeFields] = useState(false);
  const [apiStatus, setApiStatus] = useState<{ msg: string; ok: boolean } | null>(null);

  async function fetchWithFallback(path: string, init?: RequestInit) {
    let lastErr: unknown = null;
    for (const base of apiBases) {
      try {
        const res = await fetch(`${base}${path}`, init);
        if (res.ok) {
          return { res, base };
        }
        const body = await res.json().catch(() => ({}));
        if (res.status < 500) {
          return { res, base, body };
        }
        lastErr = body?.error || `HTTP ${res.status}`;
      } catch (err) {
        lastErr = err;
      }
    }
    throw new Error(typeof lastErr === "string" ? lastErr : "Could not reach API");
  }

  async function fetchAll() {
    try {
      const [fiRes, logRes] = await Promise.all([
        fetchWithFallback(`/food-items`),
        fetchWithFallback(`/log/today?user_id=${USER_ID}&date=${date}`),
      ]);
      const items: FoodItem[] = await fiRes.res.json();
      setFoodItems(items);
      const data: LogEntry[] = await logRes.res.json();
      setEntries(data);
      const existingSnacks = Array.from(new Set(data.map(e => e.meal).filter(m => m.startsWith("snack_")))).sort();
      setSnackIds(prev => Array.from(new Set([...prev, ...existingSnacks])).sort());
      setApiStatus(null);
    } catch {
      setApiStatus({ msg: "API unreachable. Check NEXT_PUBLIC_API_BASE and API container.", ok: false });
    }
  }

  useEffect(() => { fetchAll(); }, [date]);

  function openLog(meal: string) {
    setSelectedFood("");
    setFoodSearch("");
    setServings("1");
    setLogStatus(null);
    setModal({ mode: "log", meal });
  }

  function openNewFood() {
    setForm(emptyForm());
    setRecipeInstructions("");
    setRecipeYield("1");
    setRecipeIngredients([]);
    setIngredientFoodID("");
    setIngredientAmount("100");
    setShowRecipeFields(false);
    setSaveStatus(null);
    setModal({ mode: "new-food" });
  }

  function closeModal() { setModal(null); }

  function addSnack() {
    const existing = new Set(snackIds);
    let n = snackIds.length + 1;
    let id = `snack_${n}`;
    while (existing.has(id)) { n++; id = `snack_${n}`; }
    setSnackIds(prev => [...prev, id]);
  }

  function removeSnack(id: string) {
    setSnackIds(prev => prev.filter(s => s !== id));
  }

  function setField(key: keyof FoodForm) {
    return (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm(f => ({ ...f, [key]: e.target.value }));
  }

  async function submitLog() {
    if (modal?.mode !== "log" || !selectedFood || Number(servings) <= 0) return;
    setLogging(true);
    setLogStatus(null);
    try {
      const result = await fetchWithFallback(`/log/food`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          food_item_id: selectedFood,
          servings: Number(servings),
          meal: modal.meal,
          occurred_at: isToday ? new Date().toISOString() : date + "T12:00:00.000Z",
        }),
      });
      if (result.res.ok) {
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
        setLogStatus({ msg: result.body?.error || "Error logging food", ok: false });
      }
    } catch {
      setLogStatus({ msg: "Could not reach API", ok: false });
    }
    setLogging(false);
  }

  async function saveFood() {
    if (!form.name.trim()) return;
    const duplicate = foodItems.find(
      f => f.name.trim().toLowerCase() === form.name.trim().toLowerCase()
    );
    if (duplicate) {
      setSaveStatus({ msg: `"${duplicate.name}" already exists`, ok: false });
      return;
    }
    setSaving(true);
    setSaveStatus(null);
    try {
      const result = await fetchWithFallback(`/food-items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          name: form.name, brand: form.brand,
          serving_label: form.serving_label || "1 serving",
          calories_per_serving: Number(form.calories) || 0,
          protein_g_per_serving: Number(form.protein) || 0,
          carbs_g_per_serving: Number(form.carbs) || 0,
          fat_g_per_serving: Number(form.fat) || 0,
          fiber_g_per_serving: Number(form.fiber) || 0,
          recipe_instructions: recipeInstructions,
          recipe_yield_count: Number(recipeYield) || 1,
          recipe_ingredients: recipeIngredients
            .filter(i => i.food_item_id && Number(i.amount_g) > 0)
          .map(i => ({ food_item_id: i.food_item_id, amount_g: Number(i.amount_g) })),
        }),
      });
      if (result.res.ok) {
        await fetchAll();
        router.refresh();
        closeModal();
      } else {
        setSaveStatus({ msg: result.body?.error || "Error saving", ok: false });
      }
    } catch {
      setSaveStatus({ msg: "Could not reach API", ok: false });
    }
    setSaving(false);
  }

  function addRecipeIngredientDraft() {
    if (!ingredientFoodID || Number(ingredientAmount) <= 0) return;
    setRecipeIngredients(prev => [
      ...prev,
      { key: newDraftKey(), food_item_id: ingredientFoodID, amount_g: ingredientAmount },
    ]);
    setIngredientFoodID("");
    setIngredientAmount("100");
  }

  async function deleteEntry(id: string) {
    try {
      const result = await fetchWithFallback(`/log/${id}`, { method: "DELETE" });
      if (result.res.ok) setEntries(prev => prev.filter(e => e.id !== id));
    } catch {
      setApiStatus({ msg: "Could not reach API", ok: false });
    }
  }

  const allMeals = [...FIXED_MEALS, ...snackIds];
  const entriesByMeal = (meal: string) => entries.filter(e => e.meal === meal);

  const selectedItem = foodItems.find(f => f.id === selectedFood);
  const servingCount = Number(servings) || 0;
  const kcalPreview = selectedItem && servingCount > 0
    ? Math.round(servingCount * selectedItem.calories_per_serving)
    : null;

  return (
    <div>
      {apiStatus && (
        <div className={`pill ${apiStatus.ok ? "pill-ok" : "pill-err"}`} style={{ marginBottom: 12 }}>
          {apiStatus.msg}
        </div>
      )}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 6 }}>
          <button className="btn btn-ghost" onClick={() => router.push(`/log?date=${prevDay(date)}`)} style={{ padding: "4px 12px", fontSize: 16 }}>‹</button>
          <h1 style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.5px", flex: 1, textAlign: "center" }}>
            {isToday ? "Today" : formatDate(date)}
          </h1>
          <button
            className="btn btn-ghost"
            onClick={() => router.push(`/log?date=${nextDay(date)}`)}
            style={{ padding: "4px 12px", fontSize: 16 }}
            disabled={isToday}
          >›</button>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={openNewFood}>
            + New Food Item
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {allMeals.map(meal => (
          <MealSection
            key={meal}
            meal={meal}
            entries={entriesByMeal(meal)}
            onAdd={() => openLog(meal)}
            onDelete={deleteEntry}
            onRemove={meal.startsWith("snack_") ? () => removeSnack(meal) : undefined}
          />
        ))}
      </div>

      <button
        className="btn btn-ghost"
        onClick={addSnack}
        style={{ marginTop: 14, width: "100%" }}
      >
        + Add Snack
      </button>

      {/* Modal */}
      {modal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) closeModal(); }}>
          <div className="modal">

            {modal.mode === "log" && (
              <>
                <div className="modal-title">
                  Add to {mealLabel(modal.meal)}
                </div>
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
                      type="number" inputMode="decimal"
                      value={servings}
                      onChange={e => setServings(e.target.value)}
                      min={0.25} step={0.5}
                    />
                    {kcalPreview !== null && (
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        ~{kcalPreview} kcal
                      </div>
                    )}
                  </div>
                  {logStatus && (
                    <div className={`pill ${logStatus.ok ? "pill-ok" : "pill-err"}`}>{logStatus.msg}</div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    onClick={submitLog}
                    disabled={!selectedFood || servingCount <= 0 || logging}
                  >
                    {logging ? "…" : "Add"}
                  </button>
                </div>
              </>
            )}

            {modal.mode === "new-food" && (
              <>
                <div className="modal-title">New Food Item</div>
                <div className="modal-grid">
                  <div className="full">
                    <label className="field-label">Name *</label>
                    <input
                      placeholder="e.g. Banana bread bar"
                      value={form.name}
                      onChange={setField("name")}
                      list="food-name-suggestions"
                      autoComplete="off"
                    />
                    <datalist id="food-name-suggestions">
                      {foodItems.map(f => (
                        <option key={f.id} value={f.name} />
                      ))}
                    </datalist>
                  </div>
                  <div className="full">
                    <label className="field-label">Brand</label>
                    <input placeholder="Optional" value={form.brand} onChange={setField("brand")} />
                  </div>
                  <div className="full">
                    <label className="field-label">Serving label</label>
                    <input placeholder="e.g. 1 bar, 1 loaf, 2 eggs" value={form.serving_label} onChange={setField("serving_label")} />
                  </div>
                  <div style={{ gridColumn: "1 / -1", borderTop: "1px solid var(--border)", paddingTop: 12, fontSize: 12, color: "var(--muted)" }}>
                    Macros per serving
                  </div>
                  <div>
                    <label className="field-label">Calories</label>
                    <input type="number" inputMode="decimal" min={0} placeholder="kcal" value={form.calories} onChange={setField("calories")} />
                  </div>
                  <div>
                    <label className="field-label">Protein (g)</label>
                    <input type="number" inputMode="decimal" min={0} value={form.protein} onChange={setField("protein")} />
                  </div>
                  <div>
                    <label className="field-label">Carbs (g)</label>
                    <input type="number" inputMode="decimal" min={0} value={form.carbs} onChange={setField("carbs")} />
                  </div>
                  <div>
                    <label className="field-label">Fat (g)</label>
                    <input type="number" inputMode="decimal" min={0} value={form.fat} onChange={setField("fat")} />
                  </div>
                  <div>
                    <label className="field-label">Fiber (g)</label>
                    <input type="number" inputMode="decimal" min={0} value={form.fiber} onChange={setField("fiber")} />
                  </div>
                  <div className="full" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setShowRecipeFields(v => !v)}
                      style={{ fontSize: 12, padding: "4px 10px" }}
                    >
                      {showRecipeFields ? "Hide recipe details" : "Add recipe details (optional)"}
                    </button>
                  </div>
                  {showRecipeFields && (
                    <>
                      <div>
                        <label className="field-label">Recipe servings</label>
                        <input
                          type="number"
                          min={1}
                          value={recipeYield}
                          onChange={e => setRecipeYield(e.target.value)}
                        />
                      </div>
                      <div className="full">
                        <label className="field-label">Directions</label>
                        <textarea
                          rows={4}
                          value={recipeInstructions}
                          onChange={e => setRecipeInstructions(e.target.value)}
                          placeholder="Step-by-step directions..."
                        />
                      </div>
                      <div className="full">
                        <label className="field-label">Recipe ingredients</label>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 120px auto", gap: 8 }}>
                          <select value={ingredientFoodID} onChange={e => setIngredientFoodID(e.target.value)}>
                            <option value="">Select food item...</option>
                            {foodItems.map(f => (
                              <option key={f.id} value={f.id}>{f.name}{f.brand ? ` (${f.brand})` : ""}</option>
                            ))}
                          </select>
                          <input
                            type="number"
                            min={1}
                            value={ingredientAmount}
                            onChange={e => setIngredientAmount(e.target.value)}
                            placeholder="grams"
                          />
                          <button type="button" className="btn btn-ghost" onClick={addRecipeIngredientDraft}>Add</button>
                        </div>
                        {recipeIngredients.length > 0 && (
                          <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                            {recipeIngredients.map(it => {
                              const food = foodItems.find(f => f.id === it.food_item_id);
                              return (
                                <div key={it.key} style={{
                                  display: "grid",
                                  gridTemplateColumns: "1fr auto auto",
                                  gap: 8,
                                  alignItems: "center",
                                  border: "1px solid var(--border)",
                                  borderRadius: "var(--radius-sm)",
                                  padding: "6px 8px",
                                }}>
                                  <div style={{ fontSize: 12 }}>{food?.name || "Unknown item"}</div>
                                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{Number(it.amount_g)} g</div>
                                  <button
                                    type="button"
                                    className="btn btn-ghost"
                                    style={{ fontSize: 12, padding: "2px 8px" }}
                                    onClick={() => setRecipeIngredients(prev => prev.filter(x => x.key !== it.key))}
                                  >
                                    Remove
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
                {saveStatus && (
                  <div className={`pill ${saveStatus.ok ? "pill-ok" : "pill-err"}`} style={{ marginTop: 14 }}>
                    {saveStatus.msg}
                  </div>
                )}
                <div style={{ display: "flex", gap: 10, marginTop: 20, justifyContent: "flex-end" }}>
                  <button className="btn btn-ghost" onClick={closeModal}>Cancel</button>
                  <button className="btn btn-primary" onClick={saveFood} disabled={saving || !form.name.trim()}>
                    {saving ? "Saving…" : "Save Food Item"}
                  </button>
                </div>
              </>
            )}

          </div>
        </div>
      )}
    </div>
  );
}

// ── Food Photo (tiny thumbnail) ───────────────────────────────────────────────

function FoodPhoto({ id }: { id: string }) {
  const [photo, setPhoto] = useState("");
  useEffect(() => {
    fetch(`${API}/recipes/${id}/photo`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.photo) setPhoto(data.photo); });
  }, [id]);
  if (!photo) return null;
  return (
    <div style={{
      width: 32, height: 32, flexShrink: 0,
      borderRadius: "var(--radius-sm)",
      background: `url(${photo}) center/cover no-repeat`,
      border: "1px solid var(--border)",
    }} />
  );
}

// ── Meal Section ──────────────────────────────────────────────────────────────

function MealSection({
  meal, entries, onAdd, onDelete, onRemove,
}: {
  meal: string;
  entries: LogEntry[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  onRemove?: () => void;
}) {
  const totalKcal = entries.reduce((s, e) => s + e.calories, 0);

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: entries.length > 0 ? 12 : 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 15, fontWeight: 800 }}>{mealLabel(meal)}</span>
          {entries.length > 0 && (
            <span style={{ fontSize: 12, color: "var(--muted)", fontWeight: 600 }}>
              {Math.round(totalKcal)} kcal
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {onRemove && (
            <button
              className="btn btn-ghost"
              onClick={onRemove}
              style={{ fontSize: 12, padding: "4px 10px", color: "var(--muted)" }}
            >
              Remove
            </button>
          )}
          <button
            className="btn btn-ghost"
            onClick={onAdd}
            style={{ fontSize: 13, padding: "4px 12px" }}
          >
            +
          </button>
        </div>
      </div>

      {entries.length > 0 && (
        <div style={{ display: "grid", gap: 6 }}>
          {entries.map(e => (
            <div key={e.id} style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "8px 12px", background: "var(--surface2)", borderRadius: "var(--radius-sm)",
              gap: 8,
            }}>
              <FoodPhoto id={e.food_item_id} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{e.food_name}</span>
                <span style={{ color: "var(--muted)", fontSize: 12, marginLeft: 8 }}>
                  {e.servings === 1 ? e.serving_label : `${e.servings} × ${e.serving_label}`}
                </span>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", fontSize: 13, color: "var(--muted)", flexShrink: 0 }}>
                <span><b style={{ color: "var(--text)" }}>{Math.round(e.calories)}</b> kcal</span>
                <span style={{ color: "var(--accent)" }}>{e.protein_g.toFixed(1)}g P</span>
                <span style={{ color: "var(--accent3)" }}>{e.carbs_g.toFixed(1)}g C</span>
                <span style={{ color: "var(--danger)" }}>{e.fat_g.toFixed(1)}g F</span>
                <button
                  onClick={() => onDelete(e.id)}
                  style={{ background: "none", color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
                  title="Remove"
                >×</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
