const API = "/api";
const USER_ID = "00000000-0000-0000-0000-000000000001";

export const FOOD_GROUPS: { slug: string; label: string }[] = [
  { slug: "produce",            label: "Produce" },
  { slug: "meat-seafood",       label: "Meat & Seafood" },
  { slug: "dairy-refrigerated", label: "Dairy & Refrigerated" },
  { slug: "pantry-dry-goods",   label: "Pantry/Dry Goods" },
  { slug: "spices-oils",        label: "Spices & Oils" },
  { slug: "frozen",             label: "Frozen" },
];

export const GROUP_ORDER = Object.fromEntries(
  FOOD_GROUPS.map((g, i) => [g.slug, i])
);

export function slugToLabel(slug: string): string {
  return FOOD_GROUPS.find((g) => g.slug === slug)?.label ?? slug;
}

export function normName(name: string): string {
  return name.trim().toLowerCase();
}

export async function fetchCategories(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${API}/ingredient-categories?user_id=${USER_ID}`);
    if (!res.ok) return {};
    const items: { ingredient_name: string; category_slug: string }[] =
      await res.json();
    const map: Record<string, string> = {};
    for (const it of items) {
      map[it.ingredient_name] = it.category_slug;
    }
    return map;
  } catch {
    return {};
  }
}

export async function saveCategory(
  ingredientName: string,
  categorySlug: string
): Promise<void> {
  const name = normName(ingredientName);
  if (!name) return;
  await fetch(
    `${API}/ingredient-categories/set?user_id=${USER_ID}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingredient_name: name, category_slug: categorySlug }),
    }
  ).catch(() => {});
}
