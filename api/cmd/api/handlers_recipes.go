package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// ── Recipes ───────────────────────────────────────────────────────────────────

type RecipeSummary struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Brand              string    `json:"brand"`
	ServingLabel       string    `json:"serving_label"`
	Instructions       string    `json:"instructions"`
	YieldCount         int       `json:"yield_count"`
	CaloriesPerServing float64   `json:"calories_per_serving"`
	ProteinPerServing  float64   `json:"protein_g_per_serving"`
	CarbsPerServing    float64   `json:"carbs_g_per_serving"`
	FatPerServing      float64   `json:"fat_g_per_serving"`
	FiberPerServing    float64   `json:"fiber_g_per_serving"`
	CreatedAt          time.Time `json:"created_at"`
	IngredientCnt      int       `json:"ingredient_count"`
}

type RecipeIngredientDetail struct {
	ID         string  `json:"id"`
	FoodItemID string  `json:"food_item_id"`
	FoodName   string  `json:"food_name"`
	Brand      string  `json:"brand"`
	AmountG    float64 `json:"amount_g"`
}

type RecipeDetail struct {
	ID           string                   `json:"id"`
	UserID       string                   `json:"user_id"`
	Name         string                   `json:"name"`
	Instructions string                   `json:"instructions"`
	YieldCount   int                      `json:"yield_count"`
	CreatedAt    time.Time                `json:"created_at"`
	Ingredients  []RecipeIngredientDetail `json:"ingredients"`
}

type CreateRecipeRequest struct {
	UserID             string  `json:"user_id"`
	Name               string  `json:"name"`
	Brand              string  `json:"brand"`
	ServingLabel       string  `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinPerServing  float64 `json:"protein_g_per_serving"`
	CarbsPerServing    float64 `json:"carbs_g_per_serving"`
	FatPerServing      float64 `json:"fat_g_per_serving"`
	FiberPerServing    float64 `json:"fiber_g_per_serving"`
	Instructions       string  `json:"instructions"`
	YieldCount         int     `json:"yield_count"`
	ShoppingItems      []struct {
		Name      string  `json:"name"`
		Amount    float64 `json:"amount"`
		Unit      string  `json:"unit"`
		SortOrder int     `json:"sort_order"`
	} `json:"shopping_items"`
}

func (a *App) HandleListRecipes(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	rows, err := a.DB.Query(r.Context(), `
    SELECT r.id, fi.name, COALESCE(fi.brand,''), fi.serving_label,
           COALESCE(r.instructions,''), r.yield_count,
           fi.calories_per_serving, fi.protein_g_per_serving, fi.carbs_g_per_serving, fi.fat_g_per_serving, fi.fiber_g_per_serving,
           r.created_at, COUNT(rsi.id) AS ingredient_count
    FROM recipes r
    INNER JOIN food_items fi ON fi.id = r.id
    LEFT JOIN recipe_shopping_items rsi ON rsi.recipe_id = r.id
    WHERE r.user_id = $1
    GROUP BY r.id, fi.id
    ORDER BY fi.name ASC;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("list recipes: %v", err)})
		return
	}
	defer rows.Close()
	out := []RecipeSummary{}
	for rows.Next() {
		var it RecipeSummary
		if err := rows.Scan(&it.ID, &it.Name, &it.Brand, &it.ServingLabel,
			&it.Instructions, &it.YieldCount,
			&it.CaloriesPerServing, &it.ProteinPerServing, &it.CarbsPerServing, &it.FatPerServing, &it.FiberPerServing,
			&it.CreatedAt, &it.IngredientCnt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan recipes"})
			return
		}
		out = append(out, it)
	}
	writeJSON(w, 200, out)
}

func (a *App) HandleCreateRecipe(w http.ResponseWriter, r *http.Request) {
	var req CreateRecipeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.YieldCount <= 0 {
		req.YieldCount = 1
	}
	if req.ServingLabel == "" {
		req.ServingLabel = "1 serving"
	}
	// Always create food_item + recipe together so they share an ID.
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id string
	err = tx.QueryRow(ctx, `
    INSERT INTO food_items (user_id, name, brand, serving_label, calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'custom') RETURNING id;
  `, req.UserID, req.Name, req.Brand, req.ServingLabel, req.CaloriesPerServing, req.ProteinPerServing, req.CarbsPerServing, req.FatPerServing, req.FiberPerServing).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("create food item: %v", err)})
		return
	}
	_, err = tx.Exec(ctx, `
    INSERT INTO recipes (id, user_id, name, instructions, yield_count)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, instructions=EXCLUDED.instructions, yield_count=EXCLUDED.yield_count;
  `, id, req.UserID, req.Name, req.Instructions, req.YieldCount)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("create recipe: %v", err)})
		return
	}
	for i, it := range req.ShoppingItems {
		if strings.TrimSpace(it.Name) == "" {
			continue
		}
		order := it.SortOrder
		if order == 0 {
			order = i
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO recipe_shopping_items (recipe_id, name, amount, unit, sort_order)
			VALUES ($1, $2, $3, $4, $5)
		`, id, strings.TrimSpace(it.Name), it.Amount, it.Unit, order); err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert shopping item: %v", err)})
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "id": id})
}

func (a *App) HandleGetRecipe(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing recipe id"})
		return
	}
	var out RecipeDetail
	err := a.DB.QueryRow(r.Context(), `
    SELECT id, user_id::text, name, COALESCE(instructions,''), yield_count, created_at
    FROM recipes
    WHERE id = $1 AND user_id = $2;
  `, id, userID).Scan(&out.ID, &out.UserID, &out.Name, &out.Instructions, &out.YieldCount, &out.CreatedAt)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "recipe not found"})
		return
	}
	rows, err := a.DB.Query(r.Context(), `
    SELECT ri.id, fi.id, fi.name, COALESCE(fi.brand,''), ri.amount_g
    FROM recipe_ingredients ri
    JOIN food_items fi ON fi.id = ri.food_item_id
    WHERE ri.recipe_id = $1
    ORDER BY fi.name;
  `, id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("list ingredients: %v", err)})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var it RecipeIngredientDetail
		if err := rows.Scan(&it.ID, &it.FoodItemID, &it.FoodName, &it.Brand, &it.AmountG); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan ingredients"})
			return
		}
		out.Ingredients = append(out.Ingredients, it)
	}
	writeJSON(w, 200, out)
}

type UpdateRecipeRequest struct {
	UserID       string `json:"user_id"`
	Name         string `json:"name"`
	Instructions string `json:"instructions"`
	YieldCount   int    `json:"yield_count"`
}

func (a *App) HandleUpdateRecipe(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing recipe id"})
		return
	}
	var req UpdateRecipeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.YieldCount <= 0 {
		req.YieldCount = 1
	}
	ct, err := a.DB.Exec(r.Context(), `
    UPDATE recipes
    SET name = $1, instructions = $2, yield_count = $3
    WHERE id = $4 AND user_id = $5;
  `, req.Name, req.Instructions, req.YieldCount, id, req.UserID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("update recipe: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "recipe not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

type AddRecipeIngredientRequest struct {
	UserID     string  `json:"user_id"`
	FoodItemID string  `json:"food_item_id"`
	AmountG    float64 `json:"amount_g"`
}

func (a *App) HandleAddRecipeIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	if recipeID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing recipe id"})
		return
	}
	var req AddRecipeIngredientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.FoodItemID == "" || req.AmountG <= 0 {
		writeJSON(w, 400, map[string]any{"error": "food_item_id and amount_g required"})
		return
	}
	var exists bool
	if err := a.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM recipes WHERE id=$1 AND user_id=$2);`, recipeID, req.UserID).Scan(&exists); err != nil || !exists {
		writeJSON(w, 404, map[string]any{"error": "recipe not found"})
		return
	}
	var id string
	err := a.DB.QueryRow(r.Context(), `
    INSERT INTO recipe_ingredients (recipe_id, food_item_id, amount_g)
    VALUES ($1,$2,$3)
    RETURNING id;
  `, recipeID, req.FoodItemID, req.AmountG).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("add ingredient: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "id": id})
}

type UpdateRecipeIngredientRequest struct {
	UserID  string  `json:"user_id"`
	AmountG float64 `json:"amount_g"`
}

func (a *App) HandleUpdateRecipeIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	ingredientID := chi.URLParam(r, "ingredient_id")
	if recipeID == "" || ingredientID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing ids"})
		return
	}
	var req UpdateRecipeIngredientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.AmountG <= 0 {
		writeJSON(w, 400, map[string]any{"error": "amount_g required"})
		return
	}
	ct, err := a.DB.Exec(r.Context(), `
    UPDATE recipe_ingredients ri
    SET amount_g = $1
    FROM recipes r
    WHERE ri.id = $2
      AND ri.recipe_id = $3
      AND r.id = ri.recipe_id
      AND r.user_id = $4;
  `, req.AmountG, ingredientID, recipeID, req.UserID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("update ingredient: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "ingredient not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

type ReplaceRecipeIngredientsRequest struct {
	UserID      string `json:"user_id"`
	Ingredients []struct {
		FoodItemID string  `json:"food_item_id"`
		AmountG    float64 `json:"amount_g"`
	} `json:"ingredients"`
}

func (a *App) HandleReplaceRecipeIngredients(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	if recipeID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing recipe id"})
		return
	}
	var req ReplaceRecipeIngredientsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM recipes WHERE id=$1 AND user_id=$2);`, recipeID, req.UserID).Scan(&exists); err != nil || !exists {
		writeJSON(w, 404, map[string]any{"error": "recipe not found"})
		return
	}
	if _, err := tx.Exec(ctx, `DELETE FROM recipe_ingredients WHERE recipe_id = $1;`, recipeID); err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("clear ingredients: %v", err)})
		return
	}
	inserted := 0
	for _, it := range req.Ingredients {
		if it.FoodItemID == "" || it.AmountG <= 0 {
			continue
		}
		if _, err := tx.Exec(ctx, `
      INSERT INTO recipe_ingredients (recipe_id, food_item_id, amount_g)
      VALUES ($1,$2,$3);
    `, recipeID, it.FoodItemID, it.AmountG); err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("replace ingredient: %v", err)})
			return
		}
		inserted++
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "ingredient_count": inserted})
}

func (a *App) HandleDeleteRecipeIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	ingredientID := chi.URLParam(r, "ingredient_id")
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	if recipeID == "" || ingredientID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing ids"})
		return
	}
	ct, err := a.DB.Exec(r.Context(), `
    DELETE FROM recipe_ingredients ri
    USING recipes r
    WHERE ri.id = $1 AND ri.recipe_id = $2 AND r.id = ri.recipe_id AND r.user_id = $3;
  `, ingredientID, recipeID, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete ingredient: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "ingredient not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

type ExportIngredientsRequest struct {
	UserID    string   `json:"user_id"`
	RecipeIDs []string `json:"recipe_ids"`
}

type CombinedIngredient struct {
	FoodItemID string  `json:"food_item_id"`
	Name       string  `json:"name"`
	Brand      string  `json:"brand"`
	TotalG     float64 `json:"total_g"`
}

func (a *App) HandleExportRecipeIngredients(w http.ResponseWriter, r *http.Request) {
	var req ExportIngredientsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if len(req.RecipeIDs) == 0 {
		writeJSON(w, 400, map[string]any{"error": "recipe_ids required"})
		return
	}
	rows, err := a.DB.Query(r.Context(), `
    SELECT fi.id, fi.name, COALESCE(fi.brand,''), SUM(ri.amount_g)::float8 AS total_g
    FROM recipe_ingredients ri
    JOIN recipes r ON r.id = ri.recipe_id
    JOIN food_items fi ON fi.id = ri.food_item_id
    WHERE r.user_id = $1 AND r.id = ANY($2::uuid[])
    GROUP BY fi.id, fi.name, fi.brand
    ORDER BY fi.name;
  `, req.UserID, req.RecipeIDs)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export ingredients: %v", err)})
		return
	}
	defer rows.Close()
	out := []CombinedIngredient{}
	for rows.Next() {
		var it CombinedIngredient
		if err := rows.Scan(&it.FoodItemID, &it.Name, &it.Brand, &it.TotalG); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan combined ingredients"})
			return
		}
		out = append(out, it)
	}
	writeJSON(w, 200, map[string]any{
		"ok":          true,
		"ingredients": out,
	})
}

