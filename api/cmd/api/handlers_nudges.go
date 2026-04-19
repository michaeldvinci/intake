package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

func (a *App) HandleListNudges(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())
	now := a.now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, a.Loc)
	dayEnd := dayStart.Add(24 * time.Hour)

	rows, err := a.DB.Query(r.Context(), `
		SELECT n.id, n.user_id, n.food_item_id, fi.name,
		       to_char(n.remind_at, 'HH24:MI'), n.webhook_url, n.enabled,
		       (SELECT COUNT(*) FROM log_entries le
		        WHERE le.user_id = n.user_id AND le.ref_id = n.food_item_id
		          AND le.kind = 'food' AND le.occurred_at >= $2 AND le.occurred_at < $3) AS logged
		FROM nudges n
		JOIN food_items fi ON fi.id = n.food_item_id
		WHERE n.user_id = $1
		ORDER BY n.remind_at
	`, userID, dayStart, dayEnd)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()

	nudges := []Nudge{}
	for rows.Next() {
		var n Nudge
		var logCount int
		if err := rows.Scan(&n.ID, &n.UserID, &n.FoodItemID, &n.FoodName,
			&n.RemindAt, &n.WebhookURL, &n.Enabled, &logCount); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		n.LoggedToday = logCount > 0
		nudges = append(nudges, n)
	}
	writeJSON(w, 200, nudges)
}

func (a *App) HandleCreateNudge(w http.ResponseWriter, r *http.Request) {
	var req struct {
		UserID     string `json:"user_id"`
		FoodItemID string `json:"food_item_id"`
		RemindAt   string `json:"remind_at"`
		WebhookURL string `json:"webhook_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	req.UserID = userIDFromContext(r.Context())
	if req.FoodItemID == "" || req.RemindAt == "" || req.WebhookURL == "" {
		writeJSON(w, 400, map[string]any{"error": "food_item_id, remind_at, and webhook_url are required"})
		return
	}

	var id string
	err := a.DB.QueryRow(r.Context(), `
		INSERT INTO nudges (user_id, food_item_id, remind_at, webhook_url)
		VALUES ($1, $2, $3::time, $4)
		ON CONFLICT (user_id, food_item_id) DO UPDATE
		  SET remind_at = EXCLUDED.remind_at, webhook_url = EXCLUDED.webhook_url, enabled = true
		RETURNING id
	`, req.UserID, req.FoodItemID, req.RemindAt, req.WebhookURL).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "id": id})
}

func (a *App) HandleUpdateNudge(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		RemindAt   *string `json:"remind_at"`
		WebhookURL *string `json:"webhook_url"`
		Enabled    *bool   `json:"enabled"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}

	if req.RemindAt != nil {
		a.DB.Exec(r.Context(), `UPDATE nudges SET remind_at = $2::time WHERE id = $1`, id, *req.RemindAt)
	}
	if req.WebhookURL != nil {
		a.DB.Exec(r.Context(), `UPDATE nudges SET webhook_url = $2 WHERE id = $1`, id, *req.WebhookURL)
	}
	if req.Enabled != nil {
		a.DB.Exec(r.Context(), `UPDATE nudges SET enabled = $2 WHERE id = $1`, id, *req.Enabled)
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeleteNudge(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	ct, err := a.DB.Exec(r.Context(), `DELETE FROM nudges WHERE id = $1`, id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleTestNudge(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var foodName, webhookURL string
	err := a.DB.QueryRow(r.Context(), `
		SELECT fi.name, n.webhook_url
		FROM nudges n JOIN food_items fi ON fi.id = n.food_item_id
		WHERE n.id = $1
	`, id).Scan(&foodName, &webhookURL)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "nudge not found"})
		return
	}
	msg := fmt.Sprintf("🔔 **Nudge:** You haven't logged **%s** yet today!", foodName)
	if err := fireDiscordWebhook(webhookURL, msg); err != nil {
		writeJSON(w, 502, map[string]any{"error": fmt.Sprintf("webhook failed: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "message": "webhook fired"})
}

func fireDiscordWebhook(webhookURL, message string) error {
	body, _ := json.Marshal(map[string]string{
		"content": message,
	})
	resp, err := http.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("discord returned %d", resp.StatusCode)
	}
	return nil
}

func (a *App) checkNudges() {
	now := a.now()
	dayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, a.Loc)
	dayEnd := dayStart.Add(24 * time.Hour)
	currentTime := now.Format("15:04")
	prevMinute := now.Add(-1 * time.Minute).Format("15:04")

	rows, err := a.DB.Query(context.Background(), `
		SELECT n.id, n.user_id, n.food_item_id, fi.name, n.webhook_url
		FROM nudges n
		JOIN food_items fi ON fi.id = n.food_item_id
		WHERE n.enabled = true
		  AND to_char(n.remind_at, 'HH24:MI') > $1
		  AND to_char(n.remind_at, 'HH24:MI') <= $2
	`, prevMinute, currentTime)
	if err != nil {
		log.Printf("[nudge] query error: %v", err)
		return
	}
	defer rows.Close()

	type pending struct {
		id, userID, foodItemID, foodName, webhookURL string
	}
	var checks []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.userID, &p.foodItemID, &p.foodName, &p.webhookURL); err != nil {
			log.Printf("[nudge] scan error: %v", err)
			continue
		}
		checks = append(checks, p)
	}

	for _, p := range checks {
		var count int
		err := a.DB.QueryRow(context.Background(), `
			SELECT COUNT(*) FROM log_entries
			WHERE user_id = $1 AND ref_id = $2 AND kind = 'food'
			  AND occurred_at >= $3 AND occurred_at < $4
		`, p.userID, p.foodItemID, dayStart, dayEnd).Scan(&count)
		if err != nil {
			log.Printf("[nudge] log check error for %s: %v", p.foodName, err)
			continue
		}
		if count == 0 {
			log.Printf("[nudge] firing webhook for %s (not logged today)", p.foodName)
			msg := fmt.Sprintf("🔔 **Nudge:** You haven't logged **%s** yet today!", p.foodName)
			if err := fireDiscordWebhook(p.webhookURL, msg); err != nil {
				log.Printf("[nudge] webhook error for %s: %v", p.foodName, err)
			}
		} else {
			log.Printf("[nudge] %s already logged today (%d entries), skipping", p.foodName, count)
		}
	}
}

// ── User Settings ────────────────────────────────────────────────────────────

