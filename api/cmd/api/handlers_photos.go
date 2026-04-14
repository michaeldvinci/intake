package main

import (
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"
)

func (a *App) HandleGetRecipePhoto(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var data string
	err := a.DB.QueryRow(r.Context(),
		`SELECT photo_data FROM recipe_photos WHERE recipe_id = $1`, id,
	).Scan(&data)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "no photo"})
		return
	}
	writeJSON(w, 200, map[string]any{"photo": data})
}

func (a *App) HandlePutRecipePhoto(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Photo string `json:"photo"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.Photo == "" {
		writeJSON(w, 400, map[string]any{"error": "invalid request"})
		return
	}
	_, err := a.DB.Exec(r.Context(), `
		INSERT INTO recipe_photos (recipe_id, photo_data, updated_at)
		VALUES ($1, $2, now())
		ON CONFLICT (recipe_id) DO UPDATE SET photo_data = EXCLUDED.photo_data, updated_at = now()
	`, id, req.Photo)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("save photo: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeleteRecipePhoto(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	_, err := a.DB.Exec(r.Context(), `DELETE FROM recipe_photos WHERE recipe_id = $1`, id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete photo: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ── Pantry ────────────────────────────────────────────────────────────────────

type PantryItem struct {
	FoodItemID string  `json:"food_item_id"`
	FoodName   string  `json:"food_name"`
	Brand      string  `json:"brand"`
	ServingLabel string `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinGPerServing float64 `json:"protein_g_per_serving"`
	CarbsGPerServing   float64 `json:"carbs_g_per_serving"`
	FatGPerServing     float64 `json:"fat_g_per_serving"`
	Quantity   float64 `json:"quantity"`
	UpdatedAt  string  `json:"updated_at"`
	ExpiresAt  *string `json:"expires_at"`
}

