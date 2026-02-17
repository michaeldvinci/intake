"use client";

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

type MealSection = {
  meal: string;
  entries: LogEntry[];
  totalKcal: number;
  totalProtein: number;
};

type Props = {
  section: MealSection;
  mealLabel: (meal: string) => string;
  onDelete: (id: string) => void;
  onOpenLog: (meal: string) => void;
};

export function MealGroup({ section, mealLabel, onDelete, onOpenLog }: Props) {
  return (
    <div style={{ border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", overflow: "hidden" }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "8px 10px", background: "var(--surface2)", fontSize: 12, fontWeight: 700,
      }}>
        <span>{mealLabel(section.meal)}</span>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{ color: "var(--muted)" }}>
            {Math.round(section.totalKcal)} kcal · <span style={{ color: "var(--accent)" }}>{Math.round(section.totalProtein)}g P</span>
          </span>
          <button
            className="btn btn-ghost"
            onClick={() => onOpenLog(section.meal)}
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
              onClick={() => onDelete(e.id)}
              style={{ background: "none", color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
              title="Remove"
            >×</button>
          </div>
        ))}
      </div>
    </div>
  );
}
