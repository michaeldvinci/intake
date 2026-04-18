package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

func (a *App) HandleListPantry(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())
	rows, err := a.DB.Query(r.Context(), `
		SELECT fi.id, fi.name, COALESCE(fi.brand,''), COALESCE(fi.serving_label,'1 serving'),
		       fi.calories_per_serving, fi.protein_g_per_serving, fi.carbs_g_per_serving, fi.fat_g_per_serving,
		       p.quantity, p.updated_at, p.expires_at
		FROM pantry_items p
		JOIN food_items fi ON fi.id = p.food_item_id
		WHERE p.user_id = $1
		ORDER BY fi.name
	`, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("list pantry: %v", err)})
		return
	}
	defer rows.Close()
	items := []PantryItem{}
	for rows.Next() {
		var it PantryItem
		var updatedAt interface{}
		var expiresAt *time.Time
		if err := rows.Scan(&it.FoodItemID, &it.FoodName, &it.Brand, &it.ServingLabel,
			&it.CaloriesPerServing, &it.ProteinGPerServing, &it.CarbsGPerServing, &it.FatGPerServing,
			&it.Quantity, &updatedAt, &expiresAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan pantry"})
			return
		}
		if t, ok := updatedAt.(interface{ Format(string) string }); ok {
			it.UpdatedAt = t.Format(time.RFC3339)
		}
		if expiresAt != nil {
			s := expiresAt.Format("2006-01-02")
			it.ExpiresAt = &s
		}
		items = append(items, it)
	}
	writeJSON(w, 200, items)
}

func (a *App) HandleUpsertPantry(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())
	foodItemID := chi.URLParam(r, "food_item_id")
	var req struct {
		Quantity  float64 `json:"quantity"`
		ExpiresAt *string `json:"expires_at"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	var expiresAt interface{}
	if req.ExpiresAt != nil && *req.ExpiresAt != "" {
		t, err := time.Parse("2006-01-02", *req.ExpiresAt)
		if err != nil {
			writeJSON(w, 400, map[string]any{"error": "invalid expires_at date format (YYYY-MM-DD)"})
			return
		}
		expiresAt = t
	}
	_, err := a.DB.Exec(r.Context(), `
		INSERT INTO pantry_items (user_id, food_item_id, quantity, updated_at, expires_at)
		VALUES ($1, $2, $3, now(), $4)
		ON CONFLICT (user_id, food_item_id)
		DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now(), expires_at = EXCLUDED.expires_at
	`, userID, foodItemID, req.Quantity, expiresAt)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert pantry: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeletePantry(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())
	foodItemID := chi.URLParam(r, "food_item_id")
	_, err := a.DB.Exec(r.Context(), `
		DELETE FROM pantry_items WHERE user_id = $1 AND food_item_id = $2
	`, userID, foodItemID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete pantry: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeductPantry(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())
	var req struct {
		FoodItemID string  `json:"food_item_id"`
		Servings   float64 `json:"servings"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || req.FoodItemID == "" || req.Servings <= 0 {
		writeJSON(w, 400, map[string]any{"error": "invalid request"})
		return
	}
	_, err := a.DB.Exec(r.Context(), `
		UPDATE pantry_items
		SET quantity = GREATEST(0, quantity - $3), updated_at = now()
		WHERE user_id = $1 AND food_item_id = $2
	`, userID, req.FoodItemID, req.Servings)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("deduct pantry: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ── Ingredient Categories ─────────────────────────────────────────────────────

type IngredientCategory struct {
	IngredientName string `json:"ingredient_name"`
	CategorySlug   string `json:"category_slug"`
}


func (a *App) checkPantryExpirations() {
	now := a.now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, a.Loc)
	tomorrow := today.AddDate(0, 0, 1)

	// Get all users with pantry expiration webhook configured
	rows, err := a.DB.Query(context.Background(), `
		SELECT us.user_id, us.value
		FROM user_settings us
		WHERE us.key = 'pantry_expiration_webhook' AND us.value != ''
	`)
	if err != nil {
		log.Printf("[pantry-expiry] settings query error: %v", err)
		return
	}
	defer rows.Close()

	type userWebhook struct {
		userID, webhookURL string
	}
	var users []userWebhook
	for rows.Next() {
		var uw userWebhook
		if err := rows.Scan(&uw.userID, &uw.webhookURL); err != nil {
			continue
		}
		users = append(users, uw)
	}

	for _, uw := range users {
		// Find items expiring today or tomorrow
		itemRows, err := a.DB.Query(context.Background(), `
			SELECT fi.name, p.quantity, p.expires_at
			FROM pantry_items p
			JOIN food_items fi ON fi.id = p.food_item_id
			WHERE p.user_id = $1 AND p.quantity > 0
			  AND p.expires_at IS NOT NULL
			  AND p.expires_at <= $2
			ORDER BY p.expires_at
		`, uw.userID, tomorrow)
		if err != nil {
			log.Printf("[pantry-expiry] item query error for user %s: %v", uw.userID, err)
			continue
		}

		var messages []string
		for itemRows.Next() {
			var name string
			var qty float64
			var expiresAt time.Time
			if err := itemRows.Scan(&name, &qty, &expiresAt); err != nil {
				continue
			}
			expDate := time.Date(expiresAt.Year(), expiresAt.Month(), expiresAt.Day(), 0, 0, 0, 0, a.Loc)
			qtyStr := fmt.Sprintf("%.0f", qty)
			if qty != float64(int(qty)) {
				qtyStr = fmt.Sprintf("%.1f", qty)
			}
			if expDate.Before(today) {
				messages = append(messages, fmt.Sprintf("🚨 **Expired:** %s (qty: %s)", name, qtyStr))
			} else if expDate.Equal(today) {
				messages = append(messages, fmt.Sprintf("⚠️ **Expiring today:** %s (qty: %s)", name, qtyStr))
			} else {
				messages = append(messages, fmt.Sprintf("📅 **Expiring tomorrow:** %s (qty: %s)", name, qtyStr))
			}
		}
		itemRows.Close()

		if len(messages) > 0 {
			msg := "🥫 **Pantry Expiration Alert**\n" + strings.Join(messages, "\n")
			log.Printf("[pantry-expiry] sending %d alerts for user %s", len(messages), uw.userID)
			if err := fireDiscordWebhook(uw.webhookURL, msg); err != nil {
				log.Printf("[pantry-expiry] webhook error: %v", err)
			}
		}
	}
}

// ── AI Daily Review ───────────────────────────────────────────────────────────

type aiGoals struct {
	Calories int `json:"calories"`
	Protein  int `json:"protein"`
	Carbs    int `json:"carbs"`
	Fat      int `json:"fat"`
	Fiber    int `json:"fiber"`
}

type aiLogEntry struct {
	meal, name, servingLabel    string
	servings, cals              float64
	protein, carbs, fat, fiber  float64
}

type aiTotals struct {
	cals, protein, carbs, fat, fiber float64
}

