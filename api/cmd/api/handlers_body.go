package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// ── Body Weight ───────────────────────────────────────────────────────────────

type BodyWeightRequest struct {
	UserID     string  `json:"user_id"`
	MeasuredAt string  `json:"measured_at"`
	WeightKg   float64 `json:"weight_kg"`
	Note       string  `json:"note"`
}

func (a *App) HandleBodyWeight(w http.ResponseWriter, r *http.Request) {
	var req BodyWeightRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.MeasuredAt == "" {
		req.MeasuredAt = a.now().Format(time.RFC3339)
	}
	if req.WeightKg <= 0 {
		writeJSON(w, 400, map[string]any{"error": "weight_kg required"})
		return
	}
	t, err := time.Parse(time.RFC3339, req.MeasuredAt)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "measured_at must be RFC3339"})
		return
	}

	_, err = a.DB.Exec(r.Context(),
		`INSERT INTO body_weights (user_id, measured_at, weight_kg, note) VALUES ($1,$2,$3,$4);`,
		req.UserID, t, req.WeightKg, req.Note,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true})
}

// ── Daily Activity ────────────────────────────────────────────────────────────

type DailyActivityRequest struct {
	UserID        string  `json:"user_id"`
	Date          string  `json:"date"`
	Steps         int     `json:"steps"`
	ActiveKcalEst float64 `json:"active_calories_est"`
}

func (a *App) HandleDailyActivity(w http.ResponseWriter, r *http.Request) {
	var req DailyActivityRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.Date == "" {
		req.Date = a.now().Format("2006-01-02")
	}

	_, err := a.DB.Exec(r.Context(), `
    INSERT INTO daily_activity (user_id, date, steps, active_calories_kcal_est, source)
    VALUES ($1,$2,$3,$4,'manual')
    ON CONFLICT (user_id, date) DO UPDATE SET
      steps = EXCLUDED.steps,
      active_calories_kcal_est = EXCLUDED.active_calories_kcal_est;
  `, req.UserID, req.Date, req.Steps, req.ActiveKcalEst)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true})
}

func (a *App) HandleGetWater(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	date := r.URL.Query().Get("date")
	if date == "" {
		date = a.now().Format("2006-01-02")
	}

	var glasses int
	err := a.DB.QueryRow(r.Context(), `
		SELECT COALESCE(water_glasses, 0)
		FROM daily_activity
		WHERE user_id = $1 AND date = $2
	`, userID, date).Scan(&glasses)
	if err != nil {
		// No row means no water logged yet
		glasses = 0
	}
	writeJSON(w, 200, map[string]any{"glasses": glasses})
}

type SetWaterRequest struct {
	UserID  string `json:"user_id"`
	Date    string `json:"date"`
	Glasses int    `json:"glasses"`
}

func (a *App) HandleSetWater(w http.ResponseWriter, r *http.Request) {
	var req SetWaterRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.Date == "" {
		req.Date = a.now().Format("2006-01-02")
	}
	if req.Glasses < 0 {
		req.Glasses = 0
	}

	_, err := a.DB.Exec(r.Context(), `
		INSERT INTO daily_activity (user_id, date, steps, active_calories_kcal_est, water_glasses, source)
		VALUES ($1, $2, 0, 0, $3, 'manual')
		ON CONFLICT (user_id, date) DO UPDATE SET
			water_glasses = EXCLUDED.water_glasses;
	`, req.UserID, req.Date, req.Glasses)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert water: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}
