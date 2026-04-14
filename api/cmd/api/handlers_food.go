package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// ── Food Items ────────────────────────────────────────────────────────────────

type CreateFoodItemRequest struct {
	UserID             string  `json:"user_id"`
	Name               string  `json:"name"`
	Brand              string  `json:"brand"`
	ServingLabel       string  `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinPerServing  float64 `json:"protein_g_per_serving"`
	CarbsPerServing    float64 `json:"carbs_g_per_serving"`
	FatPerServing      float64 `json:"fat_g_per_serving"`
	FiberPerServing    float64 `json:"fiber_g_per_serving"`
	RecipeInstructions string  `json:"recipe_instructions"`
	RecipeYieldCount   int     `json:"recipe_yield_count"`
	RecipeIngredients  []struct {
		FoodItemID string  `json:"food_item_id"`
		AmountG    float64 `json:"amount_g"`
	} `json:"recipe_ingredients"`
}

func (a *App) HandleCreateFoodItem(w http.ResponseWriter, r *http.Request) {
	var req CreateFoodItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}
	if req.ServingLabel == "" {
		req.ServingLabel = "1 serving"
	}
	if req.RecipeYieldCount <= 0 {
		req.RecipeYieldCount = 1
	}
	var id string
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	err = tx.QueryRow(ctx, `
    INSERT INTO food_items (user_id, name, brand, serving_label, calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'custom') RETURNING id;
  `, req.UserID, req.Name, req.Brand, req.ServingLabel, req.CaloriesPerServing, req.ProteinPerServing, req.CarbsPerServing, req.FatPerServing, req.FiberPerServing).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert food_item: %v", err)})
		return
	}
	_, err = tx.Exec(ctx, `
    INSERT INTO recipes (id, user_id, name, instructions, yield_count)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      name = EXCLUDED.name,
      instructions = EXCLUDED.instructions,
      yield_count = EXCLUDED.yield_count;
  `, id, req.UserID, req.Name, req.RecipeInstructions, req.RecipeYieldCount)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert recipe: %v", err)})
		return
	}
	for _, it := range req.RecipeIngredients {
		if it.FoodItemID == "" || it.AmountG <= 0 {
			continue
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO recipe_ingredients (recipe_id, food_item_id, amount_g)
      VALUES ($1,$2,$3);
    `, id, it.FoodItemID, it.AmountG)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert recipe ingredient: %v", err)})
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "id": id, "recipe_id": id})
}

type FoodItem struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Brand              string  `json:"brand"`
	ServingLabel       string  `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinPerServing  float64 `json:"protein_g_per_serving"`
	CarbsPerServing    float64 `json:"carbs_g_per_serving"`
	FatPerServing      float64 `json:"fat_g_per_serving"`
	FiberPerServing    float64 `json:"fiber_g_per_serving"`
}

func (a *App) HandleListFoodItems(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
    SELECT id, name, COALESCE(brand,''), serving_label, calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving
    FROM food_items ORDER BY name;
  `)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()
	items := []FoodItem{}
	for rows.Next() {
		var it FoodItem
		if err := rows.Scan(&it.ID, &it.Name, &it.Brand, &it.ServingLabel, &it.CaloriesPerServing, &it.ProteinPerServing, &it.CarbsPerServing, &it.FatPerServing, &it.FiberPerServing); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		items = append(items, it)
	}
	writeJSON(w, 200, items)
}

func (a *App) HandleGetFoodItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing id"})
		return
	}
	var it FoodItem
	err := a.DB.QueryRow(r.Context(), `
    SELECT id, name, COALESCE(brand,''), serving_label, calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving
    FROM food_items
    WHERE id = $1;
  `, id).Scan(&it.ID, &it.Name, &it.Brand, &it.ServingLabel, &it.CaloriesPerServing, &it.ProteinPerServing, &it.CarbsPerServing, &it.FatPerServing, &it.FiberPerServing)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "food item not found"})
		return
	}
	writeJSON(w, 200, it)
}

type UpdateFoodItemRequest struct {
	Name               string  `json:"name"`
	Brand              string  `json:"brand"`
	ServingLabel       string  `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinPerServing  float64 `json:"protein_g_per_serving"`
	CarbsPerServing    float64 `json:"carbs_g_per_serving"`
	FatPerServing      float64 `json:"fat_g_per_serving"`
	FiberPerServing    float64 `json:"fiber_g_per_serving"`
	RecipeInstructions string  `json:"recipe_instructions"`
	RecipeYieldCount   int     `json:"recipe_yield_count"`
}

func (a *App) HandleUpdateFoodItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing id"})
		return
	}
	var req UpdateFoodItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.ServingLabel == "" {
		req.ServingLabel = "1 serving"
	}
	if req.RecipeYieldCount <= 0 {
		req.RecipeYieldCount = 1
	}
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	ct, err := tx.Exec(ctx, `
    UPDATE food_items
    SET name = $1, brand = $2, serving_label = $3,
        calories_per_serving = $4,
        protein_g_per_serving = $5,
        carbs_g_per_serving = $6,
        fat_g_per_serving = $7,
        fiber_g_per_serving = $8
    WHERE id = $9;
  `, req.Name, req.Brand, req.ServingLabel,
		req.CaloriesPerServing, req.ProteinPerServing, req.CarbsPerServing, req.FatPerServing, req.FiberPerServing,
		id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("update food item: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "food item not found"})
		return
	}
	_, _ = tx.Exec(ctx, `
    UPDATE recipes
    SET name = $1,
        instructions = CASE WHEN $2 <> '' THEN $2 ELSE instructions END,
        yield_count = CASE WHEN $3 > 0 THEN $3 ELSE yield_count END
    WHERE id = $4;
  `, req.Name, req.RecipeInstructions, req.RecipeYieldCount, id)
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeleteFoodItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing id"})
		return
	}
	ct, err := a.DB.Exec(r.Context(), `DELETE FROM food_items WHERE id = $1;`, id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "food item not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) EnsureRecipePages(ctx context.Context) error {
	_, err := a.DB.Exec(ctx, `
    INSERT INTO recipes (id, user_id, name, instructions, yield_count, created_at)
    SELECT fi.id,
           COALESCE(fi.user_id, $1::uuid),
           fi.name,
           '',
           1,
           fi.created_at
    FROM food_items fi
    LEFT JOIN recipes r ON r.id = fi.id
    WHERE r.id IS NULL;
  `, DefaultUserID)
	return err
}
