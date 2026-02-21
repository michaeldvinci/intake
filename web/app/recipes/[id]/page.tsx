"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  FOOD_GROUPS,
  GROUP_ORDER,
  slugToLabel,
  normName,
  fetchCategories,
  saveCategory,
} from "../../lib/categories";

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------
function renderMarkdown(md: string): string {
  if (!md) return "";
  let html = md
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^---$/gm, "<hr/>")
    .replace(/^[-*] (.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`);
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

// ---------------------------------------------------------------------------
// Constants / types
// ---------------------------------------------------------------------------
const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

type ShoppingItem = {
  id?: string;
  name: string;
  amount: number;
  unit: string;
  sort_order: number;
};

type RecipeDetail = {
  id: string;
  name: string;
  instructions: string;
  yield_count: number;
  ingredients: null;
};

type FoodItemDetail = {
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

function makeRowID() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `row_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// DraftItem carries a client-only `category` slug that is NOT sent to the API
type DraftItem = ShoppingItem & { row_id: string; category: string };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>();
  const recipeID = params?.id;
  const router = useRouter();
  const [recipe, setRecipe] = useState<RecipeDetail | null>(null);
  const [food, setFood] = useState<FoodItemDetail | null>(null);
  const [shoppingDraft, setShoppingDraft] = useState<DraftItem[]>([]);
  const [status, setStatus] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [photo, setPhoto] = useState<string>("");
  const [previewMd, setPreviewMd] = useState(false);
  const catsRef = useRef<Record<string, string>>({});

  async function loadAll() {
    if (!recipeID) return;
    const [recipeRes, linkedFoodRes, shoppingRes, cats] = await Promise.all([
      fetch(`${API}/recipes/${recipeID}?user_id=${USER_ID}`, { cache: "no-store" }),
      fetch(`${API}/food-items/${recipeID}`, { cache: "no-store" }),
      fetch(`${API}/recipes/${recipeID}/shopping-items`, { cache: "no-store" }),
      fetchCategories(),
    ]);
    catsRef.current = cats;
    if (recipeRes.ok) setRecipe(await recipeRes.json());
    if (linkedFoodRes.ok) setFood(await linkedFoodRes.json());
    if (shoppingRes.ok) {
      const items: ShoppingItem[] = await shoppingRes.json();
      setShoppingDraft(
        items.map(it => ({
          ...it,
          row_id: it.id || makeRowID(),
          category: cats[normName(it.name)] ?? "",
        }))
      );
    }
  }

  useEffect(() => { loadAll(); }, [recipeID]);

  useEffect(() => {
    if (!recipeID) return;
    fetch(`${API}/recipes/${recipeID}/photo`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.photo) setPhoto(data.photo); });
  }, [recipeID]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") router.back();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [router]);

  async function saveRecipe() {
    if (!recipe || !food || !recipeID) return;
    setIsSaving(true);
    setStatus("");

    // Persist categories for every named ingredient via API
    await Promise.all(
      shoppingDraft
        .filter(it => it.name.trim() && it.category)
        .map(it => saveCategory(it.name, it.category))
    );

    const shoppingPayload = shoppingDraft
      .filter(it => it.name.trim())
      .map((it, i) => ({
        name: it.name.trim(),
        amount: Number(it.amount) || 0,
        unit: it.unit,
        sort_order: i,
      }));

    const [foodRes, recipeRes, shoppingRes] = await Promise.all([
      fetch(`${API}/food-items/${recipeID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: food.name,
          brand: food.brand,
          serving_label: food.serving_label,
          calories_per_serving: food.calories_per_serving,
          protein_g_per_serving: food.protein_g_per_serving,
          carbs_g_per_serving: food.carbs_g_per_serving,
          fat_g_per_serving: food.fat_g_per_serving,
          fiber_g_per_serving: food.fiber_g_per_serving,
        }),
      }),
      fetch(`${API}/recipes/${recipeID}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: USER_ID,
          name: food.name,
          instructions: recipe.instructions,
          yield_count: recipe.yield_count,
        }),
      }),
      fetch(`${API}/recipes/${recipeID}/shopping-items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: shoppingPayload }),
      }),
    ]);

    if (foodRes.ok && recipeRes.ok && shoppingRes.ok) {
      setStatus("Saved.");
      setIsSaving(false);
      await loadAll();
      return;
    }
    const errors = [];
    if (!foodRes.ok) errors.push("Food save failed");
    if (!recipeRes.ok) errors.push("Recipe save failed");
    if (!shoppingRes.ok) errors.push("Ingredients save failed");
    setStatus(errors.join(" | "));
    setIsSaving(false);
  }

  function onPhotoFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      setPhoto(result);
      fetch(`${API}/recipes/${recipeID}/photo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ photo: result }),
      });
    };
    reader.readAsDataURL(file);
  }

  function addRow() {
    setShoppingDraft(prev => [
      ...prev,
      { row_id: makeRowID(), name: "", amount: 1, unit: "", sort_order: prev.length, category: "" },
    ]);
  }

  function removeRow(rowID: string) {
    setShoppingDraft(prev => prev.filter(it => it.row_id !== rowID));
  }

  function updateRow(rowID: string, patch: Partial<DraftItem>) {
    setShoppingDraft(prev => prev.map(it => {
      if (it.row_id !== rowID) return it;
      const updated = { ...it, ...patch };
      // When the name changes, look up any stored category for it
      if (patch.name !== undefined && patch.category === undefined) {
        const stored = catsRef.current[normName(patch.name)];
        if (stored) updated.category = stored;
      }
      return updated;
    }));
  }

  // Display rows sorted by category order, then by original sort_order within group
  const sortedDraft = useMemo(() => {
    return [...shoppingDraft].sort((a, b) => {
      const ga = GROUP_ORDER[a.category] ?? 999;
      const gb = GROUP_ORDER[b.category] ?? 999;
      if (ga !== gb) return ga - gb;
      return a.sort_order - b.sort_order;
    });
  }, [shoppingDraft]);

  // Group the sorted draft by category for display
  const groupedDraft = useMemo(() => {
    const groups: { slug: string; label: string; items: DraftItem[] }[] = [];
    for (const item of sortedDraft) {
      const slug = item.category || "__uncategorized__";
      const label = item.category ? slugToLabel(item.category) : "Uncategorized";
      const last = groups[groups.length - 1];
      if (last && last.slug === slug) {
        last.items.push(item);
      } else {
        groups.push({ slug, label, items: [item] });
      }
    }
    return groups;
  }, [sortedDraft]);

  if (!recipe || !food) {
    return (
      <div className="modal-backdrop">
        <div className="modal" style={{ maxWidth: 860, width: "100%", display: "flex", alignItems: "center", justifyContent: "center", minHeight: 120 }}>
          <div style={{ color: "var(--muted)" }}>Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="modal-backdrop"
      onClick={e => { if (e.target === e.currentTarget) router.back(); }}
    >
      <div className="modal" style={{ maxWidth: 860, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <button
            className="btn btn-ghost"
            style={{ fontSize: 20, padding: "2px 10px", lineHeight: 1 }}
            onClick={() => router.back()}
            aria-label="Close"
          >×</button>
        </div>

        {/* Body */}
        <div style={{ display: "grid", gridTemplateColumns: "180px 1fr", gap: 20 }}>
          {/* Photo column */}
          <div>
            <div style={{
              width: 180, height: 180,
              borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)",
              background: photo ? `url(${photo}) center/cover no-repeat` : "var(--surface2)",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "var(--muted)", fontSize: 12,
            }}>
              {!photo && "No photo"}
            </div>
            <label className="btn btn-ghost" style={{ marginTop: 8, width: "100%", fontSize: 12 }}>
              Upload Photo
              <input type="file" accept="image/*" style={{ display: "none" }}
                onChange={e => { const file = e.target.files?.[0]; if (file) onPhotoFile(file); }} />
            </label>
          </div>

          {/* Fields column */}
          <div style={{ display: "grid", gap: 12 }}>
            <div>
              <label className="field-label">Name</label>
              <input value={food.name} onChange={e => setFood({ ...food, name: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Brand</label>
              <input value={food.brand} onChange={e => setFood({ ...food, brand: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Serving label</label>
              <input value={food.serving_label} onChange={e => setFood({ ...food, serving_label: e.target.value })} />
            </div>
            <div>
              <label className="field-label">Servings (yield)</label>
              <input
                type="number" min={1}
                value={recipe.yield_count}
                onChange={e => setRecipe({ ...recipe, yield_count: Math.max(1, Number(e.target.value) || 1) })}
                style={{ maxWidth: 120 }}
              />
            </div>
            <div className="modal-grid">
              <div>
                <label className="field-label">Calories</label>
                <input type="number" min={0} value={food.calories_per_serving} onChange={e => setFood({ ...food, calories_per_serving: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="field-label">Protein (g)</label>
                <input type="number" min={0} value={food.protein_g_per_serving} onChange={e => setFood({ ...food, protein_g_per_serving: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="field-label">Carbs (g)</label>
                <input type="number" min={0} value={food.carbs_g_per_serving} onChange={e => setFood({ ...food, carbs_g_per_serving: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="field-label">Fat (g)</label>
                <input type="number" min={0} value={food.fat_g_per_serving} onChange={e => setFood({ ...food, fat_g_per_serving: Number(e.target.value) || 0 })} />
              </div>
              <div>
                <label className="field-label">Fiber (g)</label>
                <input type="number" min={0} value={food.fiber_g_per_serving} onChange={e => setFood({ ...food, fiber_g_per_serving: Number(e.target.value) || 0 })} />
              </div>
            </div>

            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
                <label className="field-label" style={{ marginBottom: 0 }}>Instructions</label>
                <div style={{ display: "flex", gap: 4 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "2px 8px", opacity: previewMd ? 0.5 : 1 }}
                    onClick={() => setPreviewMd(false)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    style={{ fontSize: 11, padding: "2px 8px", opacity: previewMd ? 1 : 0.5 }}
                    onClick={() => setPreviewMd(true)}
                  >
                    Preview
                  </button>
                </div>
              </div>
              {previewMd ? (
                <div
                  className="md-body"
                  style={{
                    minHeight: 120,
                    padding: "10px 12px",
                    background: "var(--surface2)",
                    borderRadius: "var(--radius-sm)",
                    border: "1px solid var(--border)",
                  }}
                  dangerouslySetInnerHTML={{ __html: renderMarkdown(recipe.instructions) || "<span style=\"color:var(--muted);font-size:13px\">Nothing to preview yet.</span>" }}
                />
              ) : (
                <textarea
                  rows={6}
                  value={recipe.instructions}
                  onChange={e => setRecipe({ ...recipe, instructions: e.target.value })}
                  placeholder="Write cooking steps… Markdown supported: **bold**, *italic*, # Heading, - list item"
                />
              )}
            </div>

            {/* Ingredients */}
            <div>
              <datalist id="unit-options">
                <option value="tsp" />
                <option value="Tbsp" />
                <option value="fl oz" />
                <option value="c" />
                <option value="pt" />
                <option value="qt" />
                <option value="gal" />
                <option value="ml" />
                <option value="L" />
                <option value="oz" />
                <option value="lbs" />
                <option value="g" />
                <option value="kg" />
                <option value="cloves" />
                <option value="slices" />
                <option value="whole" />
              </datalist>

              <div className="field-label" style={{ marginBottom: 8 }}>Ingredients</div>
              <div style={{ display: "grid", gap: 6 }}>
                {shoppingDraft.length === 0 && (
                  <div style={{ color: "var(--muted)", fontSize: 13 }}>No ingredients yet.</div>
                )}

                {groupedDraft.map(group => (
                  <div key={group.slug}>
                    {/* Group header */}
                    <div style={{
                      fontSize: 11,
                      fontWeight: 700,
                      color: "var(--accent)",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      padding: "6px 0 4px",
                      borderBottom: "1px solid var(--border)",
                      marginBottom: 4,
                    }}>
                      {group.label}
                    </div>

                    {/* Column headers on first group only */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 140px auto", gap: 6, paddingBottom: 2, marginBottom: 2 }}>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>ITEM</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>AMOUNT</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>UNIT</span>
                      <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>CATEGORY</span>
                      <span />
                    </div>

                    {group.items.map(it => (
                      <div key={it.row_id} style={{ display: "grid", gridTemplateColumns: "1fr 90px 90px 140px auto", gap: 6, alignItems: "center", marginBottom: 4 }}>
                        <input
                          placeholder="e.g. Chicken breast"
                          value={it.name}
                          onChange={e => updateRow(it.row_id, { name: e.target.value })}
                        />
                        <input
                          type="number"
                          min={0}
                          step="any"
                          value={it.amount}
                          onChange={e => updateRow(it.row_id, { amount: Number(e.target.value) || 0 })}
                        />
                        <input
                          list="unit-options"
                          placeholder="unit…"
                          value={it.unit}
                          onChange={e => updateRow(it.row_id, { unit: e.target.value })}
                        />
                        <select
                          value={it.category}
                          onChange={e => updateRow(it.row_id, { category: e.target.value })}
                          style={{ fontSize: 12 }}
                        >
                          <option value="">— category —</option>
                          {FOOD_GROUPS.map(g => (
                            <option key={g.slug} value={g.slug}>{g.label}</option>
                          ))}
                        </select>
                        <button
                          className="btn btn-ghost"
                          style={{ fontSize: 12, padding: "4px 10px" }}
                          onClick={() => removeRow(it.row_id)}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                ))}

                <div style={{ marginTop: 4 }}>
                  <button className="btn btn-ghost" onClick={addRow}>+ Add Ingredient</button>
                </div>
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button className="btn btn-primary" onClick={saveRecipe} disabled={isSaving}>
                {isSaving ? "Saving..." : "Save"}
              </button>
              {status && (
                <span className={`pill ${status === "Saved." ? "pill-ok" : "pill-err"}`}>
                  {status}
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
