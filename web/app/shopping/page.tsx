"use client";

import { useEffect, useState } from "react";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

// ---------------------------------------------------------------------------
// Food group taxonomy
// ---------------------------------------------------------------------------
const FOOD_GROUPS: { slug: string; label: string }[] = [
  { slug: "produce",            label: "Produce" },
  { slug: "meat-seafood",       label: "Meat & Seafood" },
  { slug: "dairy-refrigerated", label: "Dairy & Refrigerated" },
  { slug: "pantry-dry-goods",   label: "Pantry/Dry Goods" },
  { slug: "spices-oils",        label: "Spices & Oils" },
  { slug: "frozen",             label: "Frozen" },
];

const GROUP_ORDER = Object.fromEntries(FOOD_GROUPS.map((g, i) => [g.slug, i]));

function slugToLabel(slug: string): string {
  return FOOD_GROUPS.find(g => g.slug === slug)?.label ?? slug;
}

function loadCategories(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem("ingredient_categories") || "{}");
  } catch {
    return {};
  }
}

function normName(name: string) {
  return name.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type Recipe = {
  id: string;
  name: string;
  brand: string;
  ingredient_count: number;
};

type ShoppingEntry = {
  name: string;
  amount: number;
  unit: string;
  recipe_name: string;
};

type MergedItem = {
  name: string;
  amount: number;
  unit: string;
  recipes: string[];
  category: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function mergeAndCategorise(items: ShoppingEntry[]): MergedItem[] {
  const cats = loadCategories();
  const map = new Map<string, MergedItem>();

  for (const it of items) {
    // Total items that share the same name + unit
    const key = `${normName(it.name)}||${it.unit.toLowerCase()}`;
    const cur = map.get(key);
    if (cur) {
      cur.amount += it.amount;
      if (!cur.recipes.includes(it.recipe_name)) cur.recipes.push(it.recipe_name);
    } else {
      map.set(key, {
        name: it.name,
        amount: it.amount,
        unit: it.unit,
        recipes: [it.recipe_name],
        category: cats[normName(it.name)] ?? "",
      });
    }
  }

  return Array.from(map.values()).sort((a, b) => {
    const ga = GROUP_ORDER[a.category] ?? 999;
    const gb = GROUP_ORDER[b.category] ?? 999;
    if (ga !== gb) return ga - gb;
    return a.name.localeCompare(b.name);
  });
}

function groupByCategory(items: MergedItem[]): { slug: string; label: string; items: MergedItem[] }[] {
  const groups: { slug: string; label: string; items: MergedItem[] }[] = [];
  for (const item of items) {
    const slug = item.category || "__uncategorized__";
    const label = item.category ? slugToLabel(item.category) : "Other";
    const last = groups[groups.length - 1];
    if (last && last.slug === slug) last.items.push(item);
    else groups.push({ slug, label, items: [item] });
  }
  return groups;
}

function fmtAmt(amount: number) {
  return amount % 1 === 0 ? amount.toString() : amount.toFixed(2).replace(/\.?0+$/, "");
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ShoppingPage() {
  const [recipes, setRecipes] = useState<Recipe[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [listItems, setListItems] = useState<ShoppingEntry[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`${API}/recipes?user_id=${USER_ID}`)
      .then(r => r.ok ? r.json() : [])
      .then(setRecipes)
      .finally(() => setLoading(false));
  }, []);

  function toggle(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setListItems(null);
    setChecked(new Set());
  }

  function selectAll() { setSelected(new Set(recipes.map(r => r.id))); setListItems(null); setChecked(new Set()); }
  function clearAll()  { setSelected(new Set()); setListItems(null); setChecked(new Set()); }

  async function generateList() {
    if (selected.size === 0) return;
    setGenerating(true);
    setListItems(null);
    setChecked(new Set());
    const ids = Array.from(selected).join(",");
    const res = await fetch(`${API}/shopping-list?recipe_ids=${ids}`);
    if (res.ok) setListItems(await res.json());
    setGenerating(false);
  }

  function toggleChecked(key: string) {
    setChecked(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function exportMarkdown() {
    if (!listItems || listItems.length === 0) return;
    const merged = mergeAndCategorise(listItems);
    const groups = groupByCategory(merged);
    const lines: string[] = ["# Shopping List\n"];
    for (const group of groups) {
      lines.push(`## ${group.label}\n`);
      for (const it of group.items) {
        lines.push(`- [ ] ${fmtAmt(it.amount)}${it.unit ? " " + it.unit : ""} ${it.name}`);
      }
      lines.push("");
    }
    const blob = new Blob([lines.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "shopping-list.md"; a.click();
    URL.revokeObjectURL(url);
  }

  const merged = listItems ? mergeAndCategorise(listItems) : [];
  const groups = groupByCategory(merged);

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Shopping List</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>
          Select recipes to build a combined ingredient list.
        </p>
      </div>

      {/* Recipe selector */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div className="card-label">Recipes</div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={selectAll}>Select all</button>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={clearAll}>Clear</button>
          </div>
        </div>

        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
        ) : recipes.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>No recipes yet.</div>
        ) : (
          <div style={{ display: "grid", gap: 6 }}>
            {recipes.map(r => (
              <label key={r.id} style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "8px 10px", border: "1px solid var(--border)",
                borderRadius: "var(--radius-sm)", cursor: "pointer",
                background: selected.has(r.id) ? "var(--surface2)" : undefined,
              }}>
                <input
                  type="checkbox"
                  checked={selected.has(r.id)}
                  onChange={() => toggle(r.id)}
                  style={{ width: 16, height: 16, flexShrink: 0 }}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>
                    {r.name}{r.brand ? ` (${r.brand})` : ""}
                  </div>
                  {r.ingredient_count > 0 && (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>
                      {r.ingredient_count} ingredient{r.ingredient_count !== 1 ? "s" : ""}
                    </div>
                  )}
                </div>
              </label>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, display: "flex", gap: 8 }}>
          <button
            className="btn btn-primary"
            onClick={generateList}
            disabled={selected.size === 0 || generating}
          >
            {generating ? "Building…" : `Build List (${selected.size} recipe${selected.size !== 1 ? "s" : ""})`}
          </button>
          {listItems && listItems.length > 0 && (
            <button className="btn btn-ghost" onClick={exportMarkdown}>
              Export .md
            </button>
          )}
        </div>
      </div>

      {/* Combined list grouped by category */}
      {listItems && (
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <div className="card-label">Combined List</div>
            {checked.size > 0 && (
              <span style={{ fontSize: 12, color: "var(--muted)" }}>
                {checked.size} / {merged.length} checked
              </span>
            )}
          </div>

          {merged.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              No ingredients found. Add ingredients to your recipes first.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 20 }}>
              {groups.map(group => (
                <div key={group.slug}>
                  {/* Category header */}
                  <div style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: "var(--accent)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    paddingBottom: 6,
                    borderBottom: "1px solid var(--border)",
                    marginBottom: 6,
                  }}>
                    {group.label}
                  </div>

                  <div style={{ display: "grid", gap: 4 }}>
                    {group.items.map(it => {
                      const key = `${normName(it.name)}||${it.unit.toLowerCase()}`;
                      const isChecked = checked.has(key);
                      return (
                        <div
                          key={key}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "auto 1fr auto",
                            gap: 10,
                            alignItems: "center",
                            padding: "7px 10px",
                            border: "1px solid var(--border)",
                            borderRadius: "var(--radius-sm)",
                            opacity: isChecked ? 0.45 : 1,
                            cursor: "pointer",
                          }}
                          onClick={() => toggleChecked(key)}
                        >
                          <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={() => toggleChecked(key)}
                            onClick={e => e.stopPropagation()}
                            style={{ width: 16, height: 16 }}
                          />
                          <div>
                            <span style={{
                              fontWeight: 600,
                              fontSize: 14,
                              textDecoration: isChecked ? "line-through" : "none",
                            }}>
                              {it.name}
                            </span>
                            {it.recipes.length > 1 && (
                              <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>
                                {it.recipes.join(", ")}
                              </span>
                            )}
                          </div>
                          <div style={{ fontSize: 13, color: "var(--accent)", whiteSpace: "nowrap", fontWeight: 700 }}>
                            {fmtAmt(it.amount)}{it.unit ? " " + it.unit : ""}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
