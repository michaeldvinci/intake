"use client";

import { useNutritionGoals } from "../context/NutritionGoals";

type Props = {
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  fiber_g: number;
};

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

export function MacroSummaryCard({ protein_g, carbs_g, fat_g, fiber_g }: Props) {
  const { goals } = useNutritionGoals();
  return (
    <div className="card">
      <div className="card-label" style={{ marginBottom: 16 }}>Macros</div>
      <MacroBar label="Protein" value={protein_g} goal={goals.protein} color="var(--accent)" />
      <MacroBar label="Carbs"   value={carbs_g}   goal={goals.carbs}   color="var(--accent3)" />
      <MacroBar label="Fat"     value={fat_g}     goal={goals.fat}     color="var(--danger)" />
      <MacroBar label="Fiber"   value={fiber_g}   goal={goals.fiber}   color="var(--accent2)" />
    </div>
  );
}
