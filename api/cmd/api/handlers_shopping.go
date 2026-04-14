package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (a *App) HandleGetShoppingItems(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	rows, err := a.DB.Query(r.Context(), `
		SELECT id, recipe_id, name, amount, unit, sort_order
		FROM recipe_shopping_items
		WHERE recipe_id = $1
		ORDER BY sort_order, created_at
	`, recipeID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()
	items := []ShoppingItem{}
	for rows.Next() {
		var it ShoppingItem
		if err := rows.Scan(&it.ID, &it.RecipeID, &it.Name, &it.Amount, &it.Unit, &it.SortOrder); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		items = append(items, it)
	}
	writeJSON(w, 200, items)
}

func (a *App) HandleReplaceShoppingItems(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	var body struct {
		Items []struct {
			Name      string  `json:"name"`
			Amount    float64 `json:"amount"`
			Unit      string  `json:"unit"`
			SortOrder int     `json:"sort_order"`
		} `json:"items"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM recipe_shopping_items WHERE recipe_id = $1`, recipeID); err != nil {
		writeJSON(w, 500, map[string]any{"error": "delete"})
		return
	}
	for i, it := range body.Items {
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
		`, recipeID, strings.TrimSpace(it.Name), it.Amount, it.Unit, order); err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert: %v", err)})
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "commit"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// HandleShoppingList returns all shopping items for the given recipe IDs.
// Query param: recipe_ids=uuid1,uuid2,...
func (a *App) HandleShoppingList(w http.ResponseWriter, r *http.Request) {
	idsParam := r.URL.Query().Get("recipe_ids")
	if idsParam == "" {
		writeJSON(w, 400, map[string]any{"error": "recipe_ids required"})
		return
	}
	ids := strings.Split(idsParam, ",")
	// Build a safe IN clause using positional params
	placeholders := make([]string, len(ids))
	args := make([]any, len(ids))
	for i, id := range ids {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = strings.TrimSpace(id)
	}
	query := fmt.Sprintf(`
		SELECT rsi.name, rsi.amount, rsi.unit, r.name AS recipe_name
		FROM recipe_shopping_items rsi
		JOIN recipes r ON r.id = rsi.recipe_id
		WHERE rsi.recipe_id IN (%s)
		ORDER BY rsi.name, rsi.unit
	`, strings.Join(placeholders, ","))

	rows, err := a.DB.Query(r.Context(), query, args...)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()

	type ListItem struct {
		Name       string  `json:"name"`
		Amount     float64 `json:"amount"`
		Unit       string  `json:"unit"`
		RecipeName string  `json:"recipe_name"`
	}
	items := []ListItem{}
	for rows.Next() {
		var it ListItem
		if err := rows.Scan(&it.Name, &it.Amount, &it.Unit, &it.RecipeName); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		items = append(items, it)
	}
	writeJSON(w, 200, items)
}

