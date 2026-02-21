"use client";

import React, { useState } from "react";

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
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpandedIds((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

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
        {section.entries.map(e => {
          const isExpanded = expandedIds.has(e.id);
          return (
            <div key={e.id}>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto auto",
                  gap: 10,
                  padding: "8px 10px",
                  alignItems: "center",
                  cursor: "pointer",
                  background: isExpanded ? "var(--surface2)" : "transparent",
                  transition: "background 0.15s",
                }}
                onClick={() => toggleExpanded(e.id)}
              >
                <div style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1 }}>
                  {isExpanded ? "▼" : "▶"}
                </div>
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
                  onClick={(ev: React.MouseEvent) => {
                    ev.stopPropagation();
                    onDelete(e.id);
                  }}
                  style={{ background: "none", color: "var(--muted)", fontSize: 16, lineHeight: 1, padding: "0 2px" }}
                  title="Remove"
                >×</button>
              </div>
              {isExpanded && (
                <div style={{
                  padding: "8px 10px 12px 10px",
                  background: "var(--surface2)",
                  borderTop: "1px solid var(--border)",
                }}>
                  <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
                    <div style={{
                      padding: "10px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      textAlign: "center",
                    }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Calories</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{Math.round(e.calories)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>kcal</div>
                    </div>
                    <div style={{
                      padding: "10px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      textAlign: "center",
                    }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Protein</div>
                      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent)" }}>{e.protein_g.toFixed(1)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>g</div>
                    </div>
                    <div style={{
                      padding: "10px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      textAlign: "center",
                    }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Carbs</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{e.carbs_g.toFixed(1)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>g</div>
                    </div>
                    <div style={{
                      padding: "10px",
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)",
                      textAlign: "center",
                    }}>
                      <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 4 }}>Fat</div>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{e.fat_g.toFixed(1)}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>g</div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
