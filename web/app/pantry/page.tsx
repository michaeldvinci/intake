"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  FOOD_GROUPS,
  slugToLabel,
  normName,
  fetchCategories,
  saveCategory as saveCategoryAPI,
} from "../lib/categories";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type PantryItem = {
  food_item_id: string;
  food_name: string;
  brand: string;
  calories_per_serving: number;
  protein_g_per_serving: number;
  carbs_g_per_serving: number;
  fat_g_per_serving: number;
  quantity: number;
};

type PantryItemWithCategory = PantryItem & { category: string };

type FoodSearchResult = {
  id: string;
  name: string;
  brand: string;
  calories_per_serving: number;
  protein_g_per_serving: number;
  carbs_g_per_serving: number;
  fat_g_per_serving: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function attachCategories(items: PantryItem[], cats: Record<string, string>): PantryItemWithCategory[] {
  return items.map(it => ({
    ...it,
    category: cats[normName(it.food_name)] ?? "",
  }));
}

function groupByCategory(items: PantryItemWithCategory[]) {
  const order = Object.fromEntries(FOOD_GROUPS.map((g, i) => [g.slug, i]));
  const sorted = [...items].sort((a, b) => {
    const ga = order[a.category] ?? 999;
    const gb = order[b.category] ?? 999;
    if (ga !== gb) return ga - gb;
    return a.food_name.localeCompare(b.food_name);
  });

  const groups: { slug: string; label: string; items: PantryItemWithCategory[] }[] = [];
  for (const item of sorted) {
    const slug = item.category || "__other__";
    const label = item.category ? slugToLabel(item.category) : "Other";
    const last = groups[groups.length - 1];
    if (last && last.slug === slug) last.items.push(item);
    else groups.push({ slug, label, items: [item] });
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function MacroPill({ label, value, unit = "g" }: { label: string; value: number; unit?: string }) {
  return (
    <span style={{ fontSize: 11, color: "var(--muted)" }}>
      <span style={{ fontWeight: 600, color: "var(--fg)" }}>{Math.round(value)}</span>
      {unit} {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function PantryPage() {
  const router = useRouter();
  const [rawItems, setRawItems] = useState<PantryItem[]>([]);
  const [items, setItems] = useState<PantryItemWithCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>("__all__");

  const [search, setSearch] = useState("");
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);

  const [editQty, setEditQty] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const catsRef = useRef<Record<string, string>>({});

  const loadPantry = useCallback(async () => {
    try {
      const [res, cats] = await Promise.all([
        fetch(`${API}/pantry?user_id=${USER_ID}`),
        fetchCategories(),
      ]);
      catsRef.current = cats;
      if (res.ok) {
        const data: PantryItem[] = await res.json();
        setRawItems(data);
        setItems(attachCategories(data, cats));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => { loadPantry(); }, [loadPantry]);

  // Re-fetch when tab regains focus (e.g. after logging food)
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") loadPantry();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [loadPantry]);

  // Debounced food search
  useEffect(() => {
    if (!showSearch || search.trim().length < 2) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${API}/food-items?user_id=${USER_ID}&q=${encodeURIComponent(search.trim())}`);
        if (res.ok) setSearchResults(await res.json());
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [search, showSearch]);

  async function addToPantry(food: FoodSearchResult) {
    await fetch(`${API}/pantry/${food.id}?user_id=${USER_ID}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ quantity: 1 }),
    });
    setSearch("");
    setSearchResults([]);
    setShowSearch(false);
    await loadPantry();
  }

  async function updateQuantity(foodItemId: string, newQty: number) {
    if (newQty < 0) return;
    setSaving(prev => ({ ...prev, [foodItemId]: true }));
    try {
      if (newQty === 0) {
        await fetch(`${API}/pantry/${foodItemId}?user_id=${USER_ID}`, { method: "DELETE" });
      } else {
        await fetch(`${API}/pantry/${foodItemId}?user_id=${USER_ID}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ quantity: newQty }),
        });
      }
      await loadPantry();
    } finally {
      setSaving(prev => ({ ...prev, [foodItemId]: false }));
      setEditQty(prev => { const n = { ...prev }; delete n[foodItemId]; return n; });
    }
  }

  async function removeItem(foodItemId: string) {
    setSaving(prev => ({ ...prev, [foodItemId]: true }));
    try {
      await fetch(`${API}/pantry/${foodItemId}?user_id=${USER_ID}`, { method: "DELETE" });
      await loadPantry();
    } finally {
      setSaving(prev => ({ ...prev, [foodItemId]: false }));
    }
  }

  function setCategory(item: PantryItemWithCategory, slug: string) {
    saveCategoryAPI(item.food_name, slug);
    catsRef.current[normName(item.food_name)] = slug;
    setItems(attachCategories(rawItems, catsRef.current));
  }

  function commitEdit(item: PantryItemWithCategory) {
    const raw = editQty[item.food_item_id];
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n < 0) {
      setEditQty(prev => { const nx = { ...prev }; delete nx[item.food_item_id]; return nx; });
      return;
    }
    updateQuantity(item.food_item_id, Math.round(n * 10) / 10);
  }

  const isLowStock = (q: number) => q > 0 && q < 2;
  const isOutOfStock = (q: number) => q <= 0;

  // Build tab list from items that have categories + "All"
  const groups = groupByCategory(items);
  const tabs = [
    { slug: "__all__", label: "All" },
    ...groups.map(g => ({ slug: g.slug, label: g.label })),
  ];

  // Items to display in the active tab
  const visibleGroups = activeTab === "__all__"
    ? groups
    : groups.filter(g => g.slug === activeTab);

  const outCount = items.filter(i => isOutOfStock(i.quantity)).length;
  const lowCount = items.filter(i => isLowStock(i.quantity)).length;

  return (
    <div>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Pantry</h1>
        <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>
          Track food quantities. Auto-deducts when you log meals.
        </p>
      </div>

      {/* Add item */}
      <div className="card" style={{ marginBottom: 16 }}>
        {!showSearch ? (
          <button className="btn btn-primary" onClick={() => setShowSearch(true)}>
            + Add Item
          </button>
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                autoFocus
                type="text"
                placeholder="Search food items…"
                value={search}
                onChange={e => setSearch(e.target.value)}
                style={{ flex: 1 }}
              />
              <button className="btn btn-ghost" onClick={() => { setShowSearch(false); setSearch(""); setSearchResults([]); }}>
                Cancel
              </button>
            </div>
            {searching && <div style={{ fontSize: 13, color: "var(--muted)" }}>Searching…</div>}
            {searchResults.length > 0 && (
              <div style={{ display: "grid", gap: 4, maxHeight: 280, overflowY: "auto" }}>
                {searchResults.map(food => (
                  <div
                    key={food.id}
                    style={{
                      display: "flex", justifyContent: "space-between", alignItems: "center",
                      padding: "8px 10px", border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)", cursor: "pointer",
                    }}
                    onClick={() => addToPantry(food)}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {food.name}{food.brand ? ` — ${food.brand}` : ""}
                      </div>
                      <div style={{ display: "flex", gap: 10, marginTop: 2 }}>
                        <MacroPill label="kcal" value={food.calories_per_serving} unit="" />
                        <MacroPill label="P" value={food.protein_g_per_serving} />
                        <MacroPill label="C" value={food.carbs_g_per_serving} />
                        <MacroPill label="F" value={food.fat_g_per_serving} />
                      </div>
                    </div>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }}>Add</button>
                  </div>
                ))}
              </div>
            )}
            {!searching && search.trim().length >= 2 && searchResults.length === 0 && (
              <div style={{ fontSize: 13, color: "var(--muted)" }}>No results.</div>
            )}
          </div>
        )}
      </div>

      {/* Status bar */}
      {(outCount > 0 || lowCount > 0) && (
        <div style={{ display: "flex", gap: 12, marginBottom: 12, fontSize: 12 }}>
          {outCount > 0 && <span style={{ color: "var(--err, #ef4444)", fontWeight: 600 }}>{outCount} out of stock</span>}
          {lowCount > 0 && <span style={{ color: "var(--warn, #f59e0b)", fontWeight: 600 }}>{lowCount} running low</span>}
        </div>
      )}

      {/* Category tabs */}
      {items.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
          {tabs.map(tab => (
            <button
              key={tab.slug}
              onClick={() => setActiveTab(tab.slug)}
              className="btn btn-ghost"
              style={{
                fontSize: 12,
                padding: "4px 12px",
                borderRadius: 999,
                fontWeight: activeTab === tab.slug ? 700 : 400,
                background: activeTab === tab.slug ? "var(--accent)" : undefined,
                color: activeTab === tab.slug ? "#fff" : undefined,
                border: activeTab === tab.slug ? "1px solid var(--accent)" : undefined,
              }}
            >
              {tab.label}
              {tab.slug === "__all__" && <span style={{ marginLeft: 4, opacity: 0.7 }}>({items.length})</span>}
            </button>
          ))}
        </div>
      )}

      {/* Pantry list */}
      <div className="card">
        {loading ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>No pantry items yet. Add food items above.</div>
        ) : visibleGroups.length === 0 ? (
          <div style={{ color: "var(--muted)", fontSize: 13 }}>No items in this category.</div>
        ) : (
          <div style={{ display: "grid", gap: 20 }}>
            {visibleGroups.map(group => (
              <div key={group.slug}>
                {/* Category header */}
                <div style={{
                  fontSize: 11, fontWeight: 700, color: "var(--accent)",
                  textTransform: "uppercase", letterSpacing: "0.07em",
                  paddingBottom: 6, borderBottom: "1px solid var(--border)", marginBottom: 6,
                }}>
                  {group.label}
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  {group.items.map(item => {
                    const low = isLowStock(item.quantity);
                    const out = isOutOfStock(item.quantity);
                    const isEditing = item.food_item_id in editQty;
                    const isSaving = saving[item.food_item_id];

                    return (
                      <div
                        key={item.food_item_id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "1fr auto",
                          gap: 12,
                          alignItems: "center",
                          padding: "10px 12px",
                          border: `1px solid ${out ? "var(--err, #ef4444)" : low ? "var(--warn, #f59e0b)" : "var(--border)"}`,
                          borderRadius: "var(--radius-sm)",
                          opacity: isSaving ? 0.5 : 1,
                          background: out
                            ? "color-mix(in srgb, var(--err, #ef4444) 6%, transparent)"
                            : low
                            ? "color-mix(in srgb, var(--warn, #f59e0b) 6%, transparent)"
                            : undefined,
                        }}
                      >
                        {/* Left: food info + category selector */}
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 14, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                            {item.food_name}
                            {item.brand && <span style={{ fontSize: 12, fontWeight: 400, color: "var(--muted)" }}>{item.brand}</span>}
                            {out && <span style={{ fontSize: 11, color: "var(--err, #ef4444)", fontWeight: 700 }}>OUT</span>}
                            {low && !out && <span style={{ fontSize: 11, color: "var(--warn, #f59e0b)", fontWeight: 700 }}>LOW</span>}
                          </div>
                          <div style={{ display: "flex", gap: 10, marginTop: 3, flexWrap: "wrap", alignItems: "center" }}>
                            <MacroPill label="kcal" value={item.calories_per_serving} unit="" />
                            <MacroPill label="P" value={item.protein_g_per_serving} />
                            <MacroPill label="C" value={item.carbs_g_per_serving} />
                            <MacroPill label="F" value={item.fat_g_per_serving} />
                            <select
                              value={item.category}
                              onChange={e => setCategory(item, e.target.value)}
                              style={{ fontSize: 11, padding: "1px 4px", color: "var(--muted)", background: "transparent", border: "1px solid var(--border)", borderRadius: 4 }}
                            >
                              <option value="">Category…</option>
                              {FOOD_GROUPS.map(g => (
                                <option key={g.slug} value={g.slug}>{g.label}</option>
                              ))}
                            </select>
                          </div>
                        </div>

                        {/* Right: quantity controls */}
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <button
                            className="btn btn-ghost"
                            style={{ width: 30, height: 30, padding: 0, fontSize: 16, flexShrink: 0 }}
                            onClick={() => updateQuantity(item.food_item_id, Math.round((item.quantity - 1) * 10) / 10)}
                            disabled={isSaving}
                          >−</button>

                          {isEditing ? (
                            <input
                              autoFocus
                              type="number"
                              min={0}
                              step={0.5}
                              value={editQty[item.food_item_id]}
                              onChange={e => setEditQty(prev => ({ ...prev, [item.food_item_id]: e.target.value }))}
                              onBlur={() => commitEdit(item)}
                              onKeyDown={e => {
                                if (e.key === "Enter") commitEdit(item);
                                if (e.key === "Escape") setEditQty(prev => { const n = { ...prev }; delete n[item.food_item_id]; return n; });
                              }}
                              style={{ width: 60, textAlign: "center", padding: "4px 6px", fontSize: 14 }}
                            />
                          ) : (
                            <span
                              onClick={() => setEditQty(prev => ({ ...prev, [item.food_item_id]: String(item.quantity) }))}
                              style={{
                                minWidth: 52, textAlign: "center", fontWeight: 700, fontSize: 15,
                                color: out ? "var(--err, #ef4444)" : low ? "var(--warn, #f59e0b)" : "var(--fg)",
                                cursor: "text", padding: "4px 6px",
                                border: "1px solid transparent", borderRadius: "var(--radius-sm)",
                              }}
                              title="Click to edit"
                            >
                              {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(1)}
                              <span style={{ fontSize: 11, fontWeight: 400, color: "var(--muted)", marginLeft: 3 }}>srv</span>
                            </span>
                          )}

                          <button
                            className="btn btn-ghost"
                            style={{ width: 30, height: 30, padding: 0, fontSize: 16, flexShrink: 0 }}
                            onClick={() => updateQuantity(item.food_item_id, Math.round((item.quantity + 1) * 10) / 10)}
                            disabled={isSaving}
                          >+</button>

                          <button
                            className="btn btn-ghost"
                            style={{ width: 28, height: 28, padding: 0, fontSize: 13, flexShrink: 0, color: "var(--muted)" }}
                            onClick={() => router.push(`/recipes/${item.food_item_id}`)}
                            title="Edit food item"
                          >✎</button>

                          <button
                            className="btn btn-ghost"
                            style={{ width: 28, height: 28, padding: 0, fontSize: 14, flexShrink: 0, color: "var(--muted)" }}
                            onClick={() => removeItem(item.food_item_id)}
                            disabled={isSaving}
                            title="Remove from pantry"
                          >×</button>
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
    </div>
  );
}
