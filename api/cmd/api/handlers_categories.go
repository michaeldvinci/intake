package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"
)

func (a *App) HandleListIngredientCategories(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	rows, err := a.DB.Query(r.Context(), `
		SELECT ingredient_name, category_slug
		FROM ingredient_categories
		WHERE user_id = $1
		ORDER BY ingredient_name
	`, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("list ingredient categories: %v", err)})
		return
	}
	defer rows.Close()
	items := []IngredientCategory{}
	for rows.Next() {
		var it IngredientCategory
		if err := rows.Scan(&it.IngredientName, &it.CategorySlug); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		items = append(items, it)
	}
	writeJSON(w, 200, items)
}

func (a *App) HandleReplaceIngredientCategories(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	var body struct {
		Items []IngredientCategory `json:"items"`
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
	if _, err := tx.Exec(ctx, `DELETE FROM ingredient_categories WHERE user_id = $1`, userID); err != nil {
		writeJSON(w, 500, map[string]any{"error": "delete"})
		return
	}
	for _, it := range body.Items {
		name := strings.TrimSpace(strings.ToLower(it.IngredientName))
		if name == "" || strings.TrimSpace(it.CategorySlug) == "" {
			continue
		}
		if _, err := tx.Exec(ctx, `
			INSERT INTO ingredient_categories (user_id, ingredient_name, category_slug)
			VALUES ($1, $2, $3)
			ON CONFLICT (user_id, ingredient_name) DO UPDATE SET category_slug = EXCLUDED.category_slug
		`, userID, name, strings.TrimSpace(it.CategorySlug)); err != nil {
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

func (a *App) HandleSetIngredientCategoryBody(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	var body struct {
		IngredientName string `json:"ingredient_name"`
		CategorySlug   string `json:"category_slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	name := strings.TrimSpace(strings.ToLower(body.IngredientName))
	if name == "" || strings.TrimSpace(body.CategorySlug) == "" {
		writeJSON(w, 400, map[string]any{"error": "ingredient_name and category_slug are required"})
		return
	}
	_, err := a.DB.Exec(r.Context(), `
		INSERT INTO ingredient_categories (user_id, ingredient_name, category_slug)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, ingredient_name) DO UPDATE SET category_slug = EXCLUDED.category_slug
	`, userID, name, strings.TrimSpace(body.CategorySlug))
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleSetIngredientCategory(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	rawName, _ := url.PathUnescape(chi.URLParam(r, "name"))
	name := strings.TrimSpace(strings.ToLower(rawName))
	if name == "" {
		writeJSON(w, 400, map[string]any{"error": "name is required"})
		return
	}
	var body struct {
		CategorySlug string `json:"category_slug"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || strings.TrimSpace(body.CategorySlug) == "" {
		writeJSON(w, 400, map[string]any{"error": "category_slug is required"})
		return
	}
	_, err := a.DB.Exec(r.Context(), `
		INSERT INTO ingredient_categories (user_id, ingredient_name, category_slug)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, ingredient_name) DO UPDATE SET category_slug = EXCLUDED.category_slug
	`, userID, name, strings.TrimSpace(body.CategorySlug))
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeleteIngredientCategory(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	rawName, _ := url.PathUnescape(chi.URLParam(r, "name"))
	name := strings.TrimSpace(strings.ToLower(rawName))
	if name == "" {
		writeJSON(w, 400, map[string]any{"error": "name is required"})
		return
	}
	_, err := a.DB.Exec(r.Context(), `
		DELETE FROM ingredient_categories WHERE user_id = $1 AND ingredient_name = $2
	`, userID, name)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ── Nudges ───────────────────────────────────────────────────────────────────

type Nudge struct {
	ID         string `json:"id"`
	UserID     string `json:"user_id"`
	FoodItemID string `json:"food_item_id"`
	FoodName   string `json:"food_name"`
	RemindAt   string `json:"remind_at"`
	WebhookURL string `json:"webhook_url"`
	Enabled    bool   `json:"enabled"`
	LoggedToday bool  `json:"logged_today"`
}

