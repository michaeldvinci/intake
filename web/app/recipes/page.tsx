"use client";

import { useEffect, useState } from "react";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

// ---------------------------------------------------------------------------
// Food group taxonomy (mirrors recipes/[id]/page.tsx)
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

type Item = {
  id: string;
  name: string;
  brand: string;
  serving_label: string;
  instructions: string;
  yield_count: number;
  calories_per_serving: number;
  protein_g_per_serving: number;
  carbs_g_per_serving: number;
  fat_g_per_serving: number;
  fiber_g_per_serving: number;
  ingredient_count: number;
};

type ShoppingItem = {
  id: string;
  name: string;
  amount: number;
  unit: string;
  sort_order: number;
};

function RecipePhoto({ id, size = 140 }: { id: string; size?: number }) {
  const [photo, setPhoto] = useState("");
  useEffect(() => {
    fetch(`${API}/recipes/${id}/photo`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.photo) setPhoto(data.photo); });
  }, [id]);
  return (
    <div style={{
      width: size,
      height: size,
      borderRadius: "var(--radius-sm)",
      border: "1px solid var(--border)",
      background: photo ? `url(${photo}) center/cover no-repeat` : "var(--surface2)",
      flexShrink: 0,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--muted)",
      fontSize: size < 60 ? 9 : 12,
    }}>
      {!photo && (size >= 60 ? "No photo" : "")}
    </div>
  );
}

// Minimal markdown → HTML renderer (no dependencies)
function renderMarkdown(md: string): string {
  if (!md) return "";
  let html = md
    // Escape HTML
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    // Headings
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    // Bold / italic
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    // Inline code
    .replace(/`(.+?)`/g, "<code>$1</code>")
    // HR
    .replace(/^---$/gm, "<hr/>")
    // Unordered list items
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    // Ordered list items
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>");

  // Wrap consecutive <li> blocks in <ul>
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);

  // Paragraphs: lines not already wrapped in a block tag
  html = html
    .split("\n")
    .map((line) => {
      if (!line.trim()) return "";
      if (/^<(h[123]|ul|ol|li|hr)/.test(line)) return line;
      return `<p>${line}</p>`;
    })
    .join("\n");

  return html;
}

export default function RecipesPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [creating, setCreating] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // View modal state
  const [viewItem, setViewItem] = useState<Item | null>(null);
  const [viewIngredients, setViewIngredients] = useState<ShoppingItem[]>([]);
  const [loadingIngredients, setLoadingIngredients] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`${API}/recipes?user_id=${USER_ID}`);
    if (res.ok) setItems(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function openView(item: Item) {
    setViewItem(item);
    setViewIngredients([]);
    if (item.ingredient_count > 0) {
      setLoadingIngredients(true);
      const res = await fetch(`${API}/recipes/${item.id}/shopping-items`);
      if (res.ok) setViewIngredients(await res.json());
      setLoadingIngredients(false);
    }
  }

  function closeView() {
    setViewItem(null);
    setViewIngredients([]);
  }

  async function create(nameOverride?: string) {
    const name = (nameOverride ?? newName).trim();
    if (!name) return;
    setCreating(true);
    setStatus(null);
    const res = await fetch(`${API}/recipes`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: USER_ID, name, instructions: "", yield_count: 1 }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && body.id) {
      window.location.href = `/recipes/${body.id}`;
      return;
    }
    setStatus({ msg: body?.error || "Could not create item", ok: false });
    setCreating(false);
  }

  async function deleteItem(id: string) {
    setDeletingId(id);
    const res = await fetch(`${API}/food-items/${id}`, { method: "DELETE" });
    if (res.ok) {
      setItems(prev => prev.filter(i => i.id !== id));
      if (viewItem?.id === id) closeView();
    } else {
      const body = await res.json().catch(() => ({}));
      setStatus({ msg: body?.error || "Could not delete item", ok: false });
    }
    setDeletingId(null);
  }

  const q = search.trim().toLowerCase();
  const filtered = items
    .filter(it => it.ingredient_count > 0)
    .filter(it => !q || it.name.toLowerCase().includes(q) || (it.brand && it.brand.toLowerCase().includes(q)));

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>

      {/* Fixed header */}
      <div style={{ flexShrink: 0, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px" }}>Food Items</h1>
            <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 2 }}>
              Every item has macros per serving and optional recipe details.
            </p>
          </div>
          <button
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
            onClick={() => create(search.trim() || undefined)}
            disabled={creating || !search.trim()}
            title={search.trim() ? `Create "${search.trim()}"` : "Type a name to create"}
          >
            {creating ? "Creating…" : `+ New${search.trim() ? ` "${search.trim()}"` : " Item"}`}
          </button>
        </div>

        {/* Search bar */}
        <div style={{ position: "relative" }}>
          <i className="fa-solid fa-magnifying-glass" style={{
            position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)",
            color: "var(--muted)", fontSize: 13, pointerEvents: "none",
          }} />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && filtered.length === 0 && search.trim()) {
                create(search.trim());
              }
            }}
            placeholder="Search items… or press Enter to create"
            style={{ paddingLeft: 36 }}
          />
        </div>

        {status && (
          <div className={`pill ${status.ok ? "pill-ok" : "pill-err"}`} style={{ marginTop: 10 }}>
            {status.msg}
          </div>
        )}
      </div>

      {/* Scrollable list */}
      <div className="card" style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column", minHeight: 0 }}>
        <div style={{ flex: 1, overflowY: "auto" }}>
          {loading ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
          ) : filtered.length === 0 && !q ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>No items yet. Type a name above and press Enter to create one.</div>
          ) : filtered.length === 0 ? (
            <div style={{ color: "var(--muted)", fontSize: 13 }}>
              No results for <strong>"{search}"</strong> — press Enter to create it.
            </div>
          ) : (
            <div style={{ display: "grid", gap: 6 }}>
              {filtered.map(item => (
                <div
                  key={item.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "40px 1fr auto auto",
                    gap: 12,
                    alignItems: "center",
                    padding: "8px 12px",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                  }}
                  onClick={() => openView(item)}
                >
                  <RecipePhoto id={item.id} size={40} />
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>
                      {item.name.length > 45 ? item.name.slice(0, 45) + "…" : item.name}
                      {item.brand ? ` (${item.brand})` : ""}
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {item.serving_label}
                      {" · "}
                      <span style={{ color: "var(--accent)" }}>{Math.round(item.calories_per_serving)} kcal</span>
                      {" · "}
                      {item.protein_g_per_serving.toFixed(1)}g P
                      {" · "}
                      {item.carbs_g_per_serving.toFixed(1)}g C
                      {" · "}
                      {item.fat_g_per_serving.toFixed(1)}g F
                      {item.ingredient_count > 0 && (
                        <span style={{ marginLeft: 6, color: "var(--accent3)" }}>
                          · {item.ingredient_count} ingredient{item.ingredient_count !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                  </div>
                  <a
                    href={`/recipes/${item.id}`}
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "4px 10px", whiteSpace: "nowrap" }}
                    onClick={e => e.stopPropagation()}
                  >
                    Edit
                  </a>
                  <button
                    className="btn btn-ghost"
                    style={{ fontSize: 12, padding: "4px 10px", color: "var(--danger)" }}
                    onClick={e => { e.stopPropagation(); deleteItem(item.id); }}
                    disabled={deletingId === item.id}
                  >
                    {deletingId === item.id ? "…" : "Delete"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* View Modal */}
      {viewItem && (
        <div className="modal-backdrop" onClick={closeView}>
          <div className="modal-wide" onClick={e => e.stopPropagation()}>

            {/* Header: photo + name/macros */}
            <div className="recipe-modal-header">
              {/* Photo */}
              <RecipePhoto id={viewItem.id} />

              {/* Name, serving info, macros, actions */}
              <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.3px", lineHeight: 1.2 }}>
                      {viewItem.name}
                    </div>
                    {viewItem.brand && (
                      <div style={{ fontSize: 13, color: "var(--muted)", marginTop: 2 }}>{viewItem.brand}</div>
                    )}
                    {viewItem.serving_label && (
                      <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>
                        per {viewItem.serving_label}
                        {viewItem.yield_count > 1 && ` · ${viewItem.yield_count} servings`}
                      </div>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                    <a href={`/recipes/${viewItem.id}`} className="btn btn-primary" style={{ fontSize: 12, padding: "4px 12px" }}>
                      Edit
                    </a>
                    <button className="btn btn-ghost" style={{ fontSize: 12, padding: "4px 10px" }} onClick={closeView}>
                      Close
                    </button>
                  </div>
                </div>

                {/* Macro tiles */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 6 }}>
                  {[
                    { label: "Cal", value: Math.round(viewItem.calories_per_serving), unit: "kcal", color: "var(--accent)" },
                    { label: "Protein", value: viewItem.protein_g_per_serving.toFixed(1), unit: "g", color: "var(--accent2)" },
                    { label: "Carbs", value: viewItem.carbs_g_per_serving.toFixed(1), unit: "g", color: "var(--accent3)" },
                    { label: "Fat", value: viewItem.fat_g_per_serving.toFixed(1), unit: "g", color: "var(--muted)" },
                    { label: "Fiber", value: viewItem.fiber_g_per_serving.toFixed(1), unit: "g", color: "var(--muted)" },
                  ].map(m => (
                    <div key={m.label} style={{ background: "var(--surface2)", borderRadius: "var(--radius-sm)", padding: "8px 6px", textAlign: "center" }}>
                      <div style={{ fontSize: 15, fontWeight: 700, color: m.color, lineHeight: 1 }}>{m.value}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{m.label}</div>
                      <div style={{ fontSize: 10, color: "var(--muted)" }}>{m.unit}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Body: ingredients | instructions — both scroll independently */}
            <div className="recipe-modal-body">
              {/* Ingredients column */}
              <div className="recipe-modal-ingredients">
                <div className="card-label" style={{ marginBottom: 10 }}>Ingredients</div>
                {loadingIngredients ? (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>Loading…</div>
                ) : viewIngredients.length === 0 ? (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>No ingredients listed.</div>
                ) : (() => {
                  const cats = loadCategories();
                  // Attach category to each ingredient
                  const withCat = viewIngredients.map(ing => ({
                    ...ing,
                    category: cats[normName(ing.name)] ?? "",
                  }));
                  // Sort by group order
                  withCat.sort((a, b) => {
                    const ga = GROUP_ORDER[a.category] ?? 999;
                    const gb = GROUP_ORDER[b.category] ?? 999;
                    return ga - gb;
                  });
                  // Group
                  const groups: { slug: string; label: string; items: typeof withCat }[] = [];
                  for (const ing of withCat) {
                    const slug = ing.category || "__uncategorized__";
                    const label = ing.category ? slugToLabel(ing.category) : "Other";
                    const last = groups[groups.length - 1];
                    if (last && last.slug === slug) last.items.push(ing);
                    else groups.push({ slug, label, items: [ing] });
                  }
                  return (
                    <div style={{ display: "grid", gap: 0 }}>
                      {groups.map(group => (
                        <div key={group.slug} style={{ marginBottom: 12 }}>
                          <div style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "var(--accent)",
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            marginBottom: 4,
                          }}>
                            {group.label}
                          </div>
                          {group.items.map(ing => (
                            <div key={ing.id} style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 8,
                              fontSize: 13,
                              padding: "5px 0",
                              borderBottom: "1px solid var(--border)",
                            }}>
                              <span>{ing.name}</span>
                              <span style={{ color: "var(--muted)", whiteSpace: "nowrap" }}>{ing.amount} {ing.unit}</span>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Instructions column */}
              <div className="recipe-modal-instructions">
                <div className="card-label" style={{ marginBottom: 10 }}>Instructions</div>
                {viewItem.instructions ? (
                  <div
                    className="md-body"
                    dangerouslySetInnerHTML={{ __html: renderMarkdown(viewItem.instructions) }}
                  />
                ) : (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>No instructions added.</div>
                )}
              </div>
            </div>

          </div>
        </div>
      )}
    </div>
  );
}
