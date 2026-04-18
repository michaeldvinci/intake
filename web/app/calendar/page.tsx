"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { addDaysISO, appDateParts, todayISOInAppTZ } from "../lib/date";

const API = "/api";

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MEALS = ["breakfast","lunch","dinner"] as const;
type Meal = typeof MEALS[number];
const MEAL_LABELS: Record<Meal, string> = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner" };

// ── types ─────────────────────────────────────────────────────────────────────

type DayTotal = { date: string; calories: number };

type LogEntry = {
  id: string;
  meal: string;
  food_name: string;
  serving_label: string;
  servings: number;
  calories: number;
};

type DashData = {
  calories_in: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
};

type PlanEntry = {
  id: string;
  date: string;
  meal: Meal;
  food_item_id: string;
  food_name: string;
  brand: string;
  servings: number;
  calories_per_serving: number;
};

type FoodItem = {
  id: string;
  name: string;
  brand: string;
  serving_label: string;
  calories_per_serving: number;
  protein_g_per_serving: number;
};

// ── date helpers ──────────────────────────────────────────────────────────────

function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function firstDow(y: number, m: number) { return new Date(y, m, 1).getDay(); }
function toDateStr(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function sundayOf(dateStr: string) {
  const dow = new Date(dateStr + "T12:00:00").getDay(); // 0=Sun
  return addDaysISO(dateStr, -dow);
}
function formatFull(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });
}
function formatWeekday(dateStr: string) {
  return new Date(dateStr + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric",
  });
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function CalendarPage() {
  const router = useRouter();
  const appNow = appDateParts();
  const today = todayISOInAppTZ();

  const [year, setYear] = useState(appNow.year);
  const [month, setMonth] = useState(appNow.month - 1);
  const [selected, setSelected] = useState(today);

  // Month calorie totals
  const [monthTotals, setMonthTotals] = useState<Record<string, number>>({});

  // Agenda data (for selected date)
  const [agendaLog, setAgendaLog] = useState<LogEntry[]>([]);
  const [agendaDash, setAgendaDash] = useState<DashData | null>(null);
  const [agendaLoading, setAgendaLoading] = useState(false);

  // Week plan entries
  const [planEntries, setPlanEntries] = useState<PlanEntry[]>([]);
  const [foodItems, setFoodItems] = useState<FoodItem[]>([]);

  // Day plan modal
  const [dayModal, setDayModal] = useState<string | null>(null); // date string
  const [addMeal, setAddMeal] = useState<Meal | null>(null);     // which meal is open for adding
  const [addSearch, setAddSearch] = useState("");
  const [addFood, setAddFood] = useState("");
  const [addServings, setAddServings] = useState("1");
  const [addBusy, setAddBusy] = useState(false);

  // Settings
  const [planWeeks, setPlanWeeks] = useState(1); // only used for ICS range

  // ── fetch helpers ────────────────────────────────────────────────────────────

  useEffect(() => {
    const from = toDateStr(year, month, 1);
    const to = toDateStr(year, month, daysInMonth(year, month));
    fetch(`${API}/log/range?from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: DayTotal[]) => {
        const map: Record<string, number> = {};
        data.forEach(d => { map[d.date] = d.calories; });
        setMonthTotals(map);
      })
      .catch(() => {});
  }, [year, month]);

  useEffect(() => {
    fetch(`${API}/settings`)
      .then(r => r.ok ? r.json() : {})
      .then((s: Record<string, string>) => {
        if (s.meal_plan_weeks) setPlanWeeks(Math.max(1, Math.min(4, Number(s.meal_plan_weeks) || 1)));
      })
      .catch(() => {});
    fetch(`${API}/food-items`)
      .then(r => r.ok ? r.json() : [])
      .then(setFoodItems)
      .catch(() => {});
  }, []);

  // Fetch agenda when selected date changes
  useEffect(() => {
    setAgendaLoading(true);
    Promise.all([
      fetch(`${API}/log/today?date=${selected}`).then(r => r.ok ? r.json() : []),
      fetch(`${API}/dashboard/today?date=${selected}`).then(r => r.ok ? r.json() : null),
    ]).then(([log, dash]) => {
      setAgendaLog(log || []);
      setAgendaDash(dash);
    }).catch(() => {}).finally(() => setAgendaLoading(false));
  }, [selected]);

  // Fetch plan entries for week containing selected date
  const weekStart = sundayOf(selected);
  const weekEnd = addDaysISO(weekStart, 6);

  const fetchPlan = useCallback(async () => {
    const res = await fetch(`${API}/meal-plan?start=${weekStart}&end=${weekEnd}`);
    if (res.ok) setPlanEntries(await res.json());
  }, [weekStart, weekEnd]);

  useEffect(() => { fetchPlan(); }, [fetchPlan]);

  // ── plan actions ──────────────────────────────────────────────────────────────

  async function removePlanEntry(id: string) {
    await fetch(`${API}/meal-plan/${id}`, { method: "DELETE" });
    setPlanEntries(prev => prev.filter(e => e.id !== id));
  }

  function openDay(date: string) {
    setDayModal(date);
    setAddMeal(null);
    setAddSearch(""); setAddFood(""); setAddServings("1");
  }

  function openAddMeal(meal: Meal) {
    setAddMeal(meal);
    setAddSearch(""); setAddFood(""); setAddServings("1");
  }

  async function submitAdd() {
    if (!dayModal || !addMeal || !addFood) return;
    setAddBusy(true);
    const res = await fetch(`${API}/meal-plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({

        date: dayModal,
        meal: addMeal,
        food_item_id: addFood,
        servings: Number(addServings) || 1,
      }),
    });
    if (res.ok) {
      await fetchPlan();
      setAddMeal(null);
      setAddSearch(""); setAddFood(""); setAddServings("1");
    }
    setAddBusy(false);
  }

  // ── month nav ─────────────────────────────────────────────────────────────────

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  // ── derived ───────────────────────────────────────────────────────────────────

  const weekDays = Array.from({ length: 7 }, (_, i) => addDaysISO(weekStart, i));
  const totalDays = daysInMonth(year, month);
  const startPad = firstDow(year, month);

  function planFor(date: string, meal: Meal) {
    return planEntries.filter(e => e.date === date && e.meal === meal);
  }

  const agendaByMeal = MEALS.map(meal => ({
    meal,
    logged: agendaLog.filter(e => e.meal === meal),
    planned: planEntries.filter(e => e.date === selected && e.meal === meal),
  }));

  const filteredFoods = (() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return foodItems;
    return foodItems.filter(f =>
      f.name.toLowerCase().includes(q) || (f.brand && f.brand.toLowerCase().includes(q))
    );
  })();

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <div>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20, flexWrap: "wrap", gap: 10 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Calendar</h1>
        <a
          href={`${API}/meal-plan/export.ics?weeks=${planWeeks}`}
          className="btn btn-ghost"
          style={{ fontSize: 12, textDecoration: "none" }}
          download="intake-meal-plan.ics"
        >
          Export ICS
        </a>
      </div>

      {/* Top: month + agenda */}
      <div className="cal-top">

        {/* ── Month grid ── */}
        <div className="card" style={{ padding: 0, overflow: "hidden", alignSelf: "start" }}>
          {/* Month nav */}
          <div style={{ display: "flex", alignItems: "center", padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <button className="btn btn-ghost" onClick={prevMonth} style={{ padding: "4px 10px" }}>‹</button>
            <span style={{ flex: 1, textAlign: "center", fontWeight: 700, fontSize: 14 }}>
              {MONTH_NAMES[month]} {year}
            </span>
            <button className="btn btn-ghost" onClick={nextMonth} style={{ padding: "4px 10px" }}>›</button>
          </div>

          {/* Day headers */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", borderBottom: "1px solid var(--border)" }}>
            {DAY_NAMES_SHORT.map(d => (
              <div key={d} style={{ padding: "8px 0", textAlign: "center", fontSize: 11, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.05em" }}>
                {d}
              </div>
            ))}
          </div>

          {/* Day cells */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
            {Array.from({ length: startPad }).map((_, i) => (
              <div key={`p${i}`} style={{ borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)", minHeight: 64 }} />
            ))}
            {Array.from({ length: totalDays }).map((_, i) => {
              const day = i + 1;
              const dateStr = toDateStr(year, month, day);
              const kcal = monthTotals[dateStr];
              const isToday = dateStr === today;
              const isSelected = dateStr === selected;
              const col = (startPad + i) % 7;
              const hasPlan = planEntries.some(e => e.date === dateStr);

              return (
                <div
                  key={day}
                  onClick={() => setSelected(dateStr)}
                  style={{
                    minHeight: 64,
                    padding: "8px 6px 6px",
                    borderBottom: "1px solid var(--border)",
                    borderRight: col < 6 ? "1px solid var(--border)" : undefined,
                    cursor: "pointer",
                    background: isSelected ? "color-mix(in srgb, var(--accent) 12%, transparent)"
                      : isToday ? "var(--surface2)" : undefined,
                    transition: "background 0.12s",
                    display: "flex",
                    flexDirection: "column",
                    gap: 3,
                  }}
                >
                  <span style={{
                    fontSize: 12,
                    fontWeight: isToday || isSelected ? 800 : 400,
                    color: isSelected ? "var(--accent)" : isToday ? "var(--accent2)" : "var(--fg)",
                    width: 22, height: 22,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    borderRadius: "50%",
                    background: isSelected ? "color-mix(in srgb, var(--accent) 20%, transparent)" : undefined,
                  }}>{day}</span>
                  {kcal !== undefined && (
                    <span style={{ fontSize: 10, color: "var(--muted)", fontWeight: 500, lineHeight: 1 }}>
                      {Math.round(kcal)}
                    </span>
                  )}
                  {hasPlan && (
                    <div style={{ display: "flex", gap: 2, marginTop: 1 }}>
                      <div style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--accent2)" }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* ── Agenda ── */}
        <div className="cal-agenda">
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontWeight: 800, fontSize: 16 }}>{formatFull(selected)}</div>
              {agendaDash && agendaDash.calories_in > 0 && (
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                  {Math.round(agendaDash.calories_in)} kcal · {Math.round(agendaDash.protein_g)}g protein
                </div>
              )}
            </div>
            <button
              className="btn btn-ghost"
              style={{ fontSize: 11, padding: "3px 8px" }}
              onClick={() => router.push(`/?date=${selected}`)}
            >
              Ledger →
            </button>
          </div>

          {agendaLoading ? (
            <div style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</div>
          ) : (
            <div style={{ display: "grid", gap: 12 }}>
              {agendaByMeal.map(({ meal, logged, planned }) => {
                const hasLogged = logged.length > 0;
                const hasPlanned = planned.length > 0;
                if (!hasLogged && !hasPlanned) return null;
                return (
                  <div key={meal}>
                    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 5 }}>
                      {MEAL_LABELS[meal]}
                    </div>
                    <div style={{ display: "grid", gap: 3 }}>
                      {hasLogged ? logged.map(e => (
                        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ color: "var(--fg)" }}>{e.food_name}</span>
                          <span style={{ color: "var(--muted)", marginLeft: 8, whiteSpace: "nowrap" }}>{Math.round(e.calories)} kcal</span>
                        </div>
                      )) : planned.map(e => (
                        <div key={e.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
                          <span style={{ color: "var(--muted)", fontStyle: "italic" }}>
                            {e.food_name}{e.brand ? ` (${e.brand})` : ""}
                          </span>
                          <span style={{ color: "var(--muted)", marginLeft: 8, whiteSpace: "nowrap" }}>
                            {Math.round(e.calories_per_serving * e.servings)} kcal
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
              {agendaLog.length === 0 && planEntries.filter(e => e.date === selected).length === 0 && (
                <div style={{ fontSize: 13, color: "var(--muted)" }}>Nothing logged or planned.</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Week plan grid */}
      <div style={{ marginTop: 24 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
            Week of {formatWeekday(weekStart)}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setSelected(s => addDaysISO(s, -7))}>‹ Prev</button>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setSelected(today)}>This week</button>
            <button className="btn btn-ghost" style={{ fontSize: 11, padding: "3px 8px" }} onClick={() => setSelected(s => addDaysISO(s, 7))}>Next ›</button>
          </div>
        </div>

        <div className="week-grid">
          {weekDays.map(date => {
            const isToday = date === today;
            const isSel = date === selected;
            return (
              <div key={date} style={{ minWidth: 0 }}>
                {/* Day header */}
                <div
                  onClick={() => setSelected(date)}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: isSel ? "var(--accent)" : isToday ? "var(--accent2)" : "var(--muted)",
                    textAlign: "center",
                    marginBottom: 6,
                    cursor: "pointer",
                    padding: "2px 0",
                    borderBottom: isSel ? "2px solid var(--accent)" : "2px solid transparent",
                  }}
                >
                  {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                  <div style={{ fontSize: 13, fontWeight: isSel || isToday ? 800 : 500, color: isSel ? "var(--accent)" : "var(--fg)", marginTop: 1 }}>
                    {new Date(date + "T12:00:00").getDate()}
                  </div>
                </div>

                {/* Meal slots */}
                <div style={{ display: "grid", gap: 4 }}>
                  {MEALS.map(meal => {
                    const slots = planFor(date, meal);
                    const slotKcal = slots.reduce((s, e) => s + e.calories_per_serving * e.servings, 0);
                    return (
                      <div
                        key={meal}
                        onClick={() => openDay(date)}
                        style={{
                          background: "var(--surface2)",
                          borderRadius: "var(--radius-sm)",
                          padding: "6px 7px",
                          minHeight: 48,
                          display: "flex",
                          flexDirection: "column",
                          gap: 3,
                          cursor: "pointer",
                          transition: "background 0.12s",
                        }}
                        onMouseEnter={e => (e.currentTarget.style.background = "var(--border)")}
                        onMouseLeave={e => (e.currentTarget.style.background = "var(--surface2)")}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {MEAL_LABELS[meal]}
                          </span>
                          {slotKcal > 0 && (
                            <span style={{ fontSize: 9, color: "var(--accent)", fontWeight: 600 }}>
                              {Math.round(slotKcal)}
                            </span>
                          )}
                        </div>
                        {slots.map(e => (
                          <div key={e.id} style={{ display: "flex", alignItems: "center", gap: 2, minWidth: 0 }}>
                            <span style={{
                              fontSize: 10, color: "var(--fg)", flex: 1, minWidth: 0,
                              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                            }}>
                              {e.food_name.length > 18 ? e.food_name.slice(0, 16) + "…" : e.food_name}
                            </span>
                            <span
                              role="button"
                              onClick={ev => { ev.stopPropagation(); removePlanEntry(e.id); }}
                              style={{ color: "var(--muted)", fontSize: 11, padding: "0 1px", lineHeight: 1, flexShrink: 0, cursor: "pointer" }}
                            >×</span>
                          </div>
                        ))}
                        {slots.length === 0 && (
                          <span style={{ fontSize: 10, color: "var(--border)" }}>+</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day plan modal */}
      {dayModal && (
        <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) setDayModal(null); }}>
          <div className="modal" style={{ maxWidth: 500 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
              <div className="modal-title" style={{ marginBottom: 0 }}>{formatFull(dayModal)}</div>
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: "2px 8px" }} onClick={() => setDayModal(null)}>✕</button>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              {MEALS.map(meal => {
                const slots = planEntries.filter(e => e.date === dayModal && e.meal === meal);
                const mealKcal = slots.reduce((s, e) => s + e.calories_per_serving * e.servings, 0);
                const isAdding = addMeal === meal;

                return (
                  <div key={meal} style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
                    {/* Meal header */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 12px", background: "var(--surface2)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>{MEAL_LABELS[meal]}</span>
                        {mealKcal > 0 && <span style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600 }}>{Math.round(mealKcal)} kcal</span>}
                      </div>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        style={{ fontSize: 11, padding: "2px 8px" }}
                        onClick={() => isAdding ? setAddMeal(null) : openAddMeal(meal)}
                      >
                        {isAdding ? "Cancel" : "+ Add"}
                      </button>
                    </div>

                    {/* Existing items */}
                    {slots.length > 0 && (
                      <div style={{ padding: "6px 12px", display: "grid", gap: 4 }}>
                        {slots.map(e => (
                          <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ fontSize: 13 }}>{e.food_name}{e.brand ? ` (${e.brand})` : ""}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
                              <span style={{ fontSize: 11, color: "var(--muted)" }}>×{e.servings} · {Math.round(e.calories_per_serving * e.servings)} kcal</span>
                              <button type="button" onClick={() => removePlanEntry(e.id)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 14, padding: 0, lineHeight: 1 }}>×</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Inline add section */}
                    {isAdding && (
                      <div style={{ padding: "10px 12px", borderTop: "1px solid var(--border)", display: "grid", gap: 8 }}>
                        {!addFood ? (
                          <>
                            <input
                              autoFocus
                              placeholder="Search food…"
                              value={addSearch}
                              onChange={e => setAddSearch(e.target.value)}
                            />
                            <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", maxHeight: 200, overflowY: "auto" }}>
                              {filteredFoods.slice(0, 30).map(f => (
                                <div
                                  key={f.id}
                                  onClick={() => { setAddFood(f.id); setAddSearch(f.name + (f.brand ? ` (${f.brand})` : "")); }}
                                  style={{ padding: "7px 10px", cursor: "pointer", borderBottom: "1px solid var(--border)" }}
                                  onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
                                  onMouseLeave={e => (e.currentTarget.style.background = "")}
                                >
                                  <div style={{ fontSize: 13, fontWeight: 600 }}>{f.name}{f.brand ? ` (${f.brand})` : ""}</div>
                                  <div style={{ fontSize: 11, color: "var(--muted)" }}>{f.serving_label} · {Math.round(f.calories_per_serving)} kcal · {f.protein_g_per_serving}g P</div>
                                </div>
                              ))}
                              {filteredFoods.length === 0 && <div style={{ padding: "10px", fontSize: 13, color: "var(--muted)" }}>No results.</div>}
                            </div>
                          </>
                        ) : (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{addSearch}</span>
                            <button type="button" className="btn btn-ghost" style={{ fontSize: 11, padding: "2px 8px" }} onClick={() => { setAddFood(""); setAddSearch(""); }}>Change</button>
                            <input
                              autoFocus
                              type="number" inputMode="decimal" min="0.25" step="0.5"
                              value={addServings}
                              onChange={e => setAddServings(e.target.value)}
                              style={{ width: 70 }}
                            />
                            <span style={{ fontSize: 11, color: "var(--muted)" }}>
                              {Math.round((foodItems.find(x => x.id === addFood)?.calories_per_serving ?? 0) * (Number(addServings) || 0))} kcal
                            </span>
                            <button type="button" className="btn btn-primary" style={{ fontSize: 12 }} onClick={submitAdd} disabled={addBusy}>
                              {addBusy ? "…" : "Add"}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
