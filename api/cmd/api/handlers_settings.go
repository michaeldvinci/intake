package main

import (
	"encoding/json"
	"fmt"
	"net/http"
)

func (a *App) HandleGetSettings(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	rows, err := a.DB.Query(r.Context(), `
		SELECT key, value FROM user_settings WHERE user_id = $1
	`, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()
	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		settings[k] = v
	}
	writeJSON(w, 200, settings)
}

func (a *App) HandlePutSetting(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	var req struct {
		Key   string `json:"key"`
		Value string `json:"value"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.Key == "" {
		writeJSON(w, 400, map[string]any{"error": "key is required"})
		return
	}
	_, err := a.DB.Exec(r.Context(), `
		INSERT INTO user_settings (user_id, key, value)
		VALUES ($1, $2, $3)
		ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
	`, userID, req.Key, req.Value)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ── Pantry Expiration Checker ────────────────────────────────────────────────

