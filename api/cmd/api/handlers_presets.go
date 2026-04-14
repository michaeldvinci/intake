package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// ── Presets ───────────────────────────────────────────────────────────────────

type CreatePresetRequest struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Pinned bool   `json:"pinned"`
	Items  []struct {
		Kind     string  `json:"kind"` // food|recipe_portion
		RefID    string  `json:"ref_id"`
		Servings float64 `json:"servings"`
	} `json:"items"`
}

func (a *App) HandleCreatePreset(w http.ResponseWriter, r *http.Request) {
	var req CreatePresetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.Name == "" || len(req.Items) == 0 {
		writeJSON(w, 400, map[string]any{"error": "name and items required"})
		return
	}

	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var presetID string
	if err := tx.QueryRow(ctx, `INSERT INTO presets (user_id, name, pinned) VALUES ($1,$2,$3) RETURNING id;`, req.UserID, req.Name, req.Pinned).Scan(&presetID); err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("preset insert: %v", err)})
		return
	}

	for _, it := range req.Items {
		if it.Kind != "food" && it.Kind != "recipe_portion" {
			writeJSON(w, 400, map[string]any{"error": "invalid preset item kind"})
			return
		}
		if it.Servings <= 0 {
			it.Servings = 1
		}
		_, err := tx.Exec(ctx,
			`INSERT INTO preset_items (preset_id, kind, ref_id, servings) VALUES ($1,$2,$3,$4);`,
			presetID, it.Kind, it.RefID, it.Servings)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("preset item insert: %v", err)})
			return
		}
	}

	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "preset_id": presetID})
}

func (a *App) HandleApplyPreset(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	presetID := chi.URLParam(r, "id")
	if presetID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing preset id"})
		return
	}
	occurredAt := time.Now().UTC()

	rows, err := a.DB.Query(r.Context(), `SELECT kind, ref_id, servings FROM preset_items WHERE preset_id=$1;`, presetID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "query preset items"})
		return
	}
	defer rows.Close()

	n := 0
	for rows.Next() {
		var kind, refID string
		var servings float64
		if err := rows.Scan(&kind, &refID, &servings); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		_, err = a.DB.Exec(r.Context(),
			`INSERT INTO log_entries (user_id, occurred_at, kind, ref_id, servings) VALUES ($1,$2,$3,$4,$5);`,
			userID, occurredAt, kind, refID, servings)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("apply insert: %v", err)})
			return
		}
		n++
	}
	writeJSON(w, 200, map[string]any{"ok": true, "logged_items": n})
}
