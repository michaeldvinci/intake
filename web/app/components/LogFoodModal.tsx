"use client";

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

type Props = {
  meal: string;
  foodItems: FoodItem[];
  foodSearch: string;
  selectedFood: string;
  servings: string;
  logging: boolean;
  logError: string | null;
  mealLabel: (meal: string) => string;
  onFoodSearchChange: (val: string) => void;
  onFoodSelect: (id: string, name: string, brand: string) => void;
  onServingsChange: (val: string) => void;
  onClose: () => void;
  onSubmit: () => void;
  onNewItem: () => void;
};

export function LogFoodModal({
  meal, foodItems, foodSearch, selectedFood, servings, logging, logError,
  mealLabel, onFoodSearchChange, onFoodSelect, onServingsChange, onClose, onSubmit, onNewItem,
}: Props) {
  const selectedItem = foodItems.find(f => f.id === selectedFood);
  const kcalPreview = selectedItem && Number(servings) > 0
    ? Math.round(Number(servings) * selectedItem.calories_per_serving)
    : null;

  return (
    <div className="modal-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-title">Add to {mealLabel(meal)}</div>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ position: "relative" }}>
            <label className="field-label">Food item</label>
            <input
              autoFocus
              placeholder="Search…"
              value={foodSearch}
              onChange={e => onFoodSearchChange(e.target.value)}
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
                      onMouseDown={() => onFoodSelect(f.id, f.name, f.brand)}
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
              onChange={e => onServingsChange(e.target.value)}
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
            onClick={onNewItem}
          >
            + New item
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            onClick={onSubmit}
            disabled={!selectedFood || Number(servings) <= 0 || logging}
          >
            {logging ? "…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}
