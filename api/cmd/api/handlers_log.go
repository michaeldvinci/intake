package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"
)

// ── Dashboard ─────────────────────────────────────────────────────────────────

type DashboardResponse struct {
	Date          string  `json:"date"`
	UserID        string  `json:"user_id"`
	CaloriesIn    float64 `json:"calories_in"`
	ProteinG      float64 `json:"protein_g"`
	CarbsG        float64 `json:"carbs_g"`
	FatG          float64 `json:"fat_g"`
	FiberG        float64 `json:"fiber_g"`
	Steps         int     `json:"steps"`
	ActiveKcalEst float64 `json:"active_calories_est"`
}

func (a *App) HandleDashboardToday(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	dateStr := r.URL.Query().Get("date")
	if dateStr == "" {
		dateStr = a.now().Format("2006-01-02")
	}

	dayStart, err := time.ParseInLocation("2006-01-02", dateStr, a.Loc)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "bad date"})
		return
	}
	dayEnd := dayStart.Add(24 * time.Hour)

	ctx := r.Context()
	var caloriesIn, protein, carbs, fat, fiber float64
	q := `
    SELECT COALESCE(SUM(le.servings * fi.calories_per_serving),0),
           COALESCE(SUM(le.servings * fi.protein_g_per_serving),0),
           COALESCE(SUM(le.servings * fi.carbs_g_per_serving),0),
           COALESCE(SUM(le.servings * fi.fat_g_per_serving),0),
           COALESCE(SUM(le.servings * fi.fiber_g_per_serving),0)
    FROM log_entries le
    JOIN food_items fi ON fi.id = le.ref_id
    WHERE le.user_id = $1 AND le.kind = 'food' AND le.occurred_at >= $2 AND le.occurred_at < $3;
  `
	if err := a.DB.QueryRow(ctx, q, userID, dayStart, dayEnd).Scan(&caloriesIn, &protein, &carbs, &fat, &fiber); err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("dashboard query: %v", err)})
		return
	}

	var steps int
	var activeKcal float64
	_ = a.DB.QueryRow(ctx, `SELECT COALESCE(steps,0), COALESCE(active_calories_kcal_est,0) FROM daily_activity WHERE user_id=$1 AND date=$2;`, userID, dateStr).
		Scan(&steps, &activeKcal)

	writeJSON(w, 200, DashboardResponse{
		Date: dateStr, UserID: userID,
		CaloriesIn: caloriesIn, ProteinG: protein, CarbsG: carbs, FatG: fat, FiberG: fiber,
		Steps: steps, ActiveKcalEst: activeKcal,
	})
}

// ── Day Totals ────────────────────────────────────────────────────────────────

type DayTotalsResponse struct {
	Date       string  `json:"date"`
	EntryCount int     `json:"entry_count"`
	CaloriesIn float64 `json:"calories_in"`
	ProteinG   float64 `json:"protein_g"`
	CarbsG     float64 `json:"carbs_g"`
	FatG       float64 `json:"fat_g"`
	FiberG     float64 `json:"fiber_g"`
}

func (a *App) HandleDayTotals(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	dateStr := r.URL.Query().Get("date")
	if dateStr == "" {
		dateStr = a.now().Format("2006-01-02")
	}

	dayStart, err := time.ParseInLocation("2006-01-02", dateStr, a.Loc)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "bad date: use YYYY-MM-DD"})
		return
	}
	dayEnd := dayStart.Add(24 * time.Hour)

	var count int
	var calories, protein, carbs, fat, fiber float64
	err = a.DB.QueryRow(r.Context(), `
    SELECT COUNT(*),
           COALESCE(SUM(le.servings * fi.calories_per_serving), 0),
           COALESCE(SUM(le.servings * fi.protein_g_per_serving), 0),
           COALESCE(SUM(le.servings * fi.carbs_g_per_serving), 0),
           COALESCE(SUM(le.servings * fi.fat_g_per_serving), 0),
           COALESCE(SUM(le.servings * fi.fiber_g_per_serving), 0)
    FROM log_entries le
    JOIN food_items fi ON fi.id = le.ref_id
    WHERE le.user_id = $1 AND le.kind = 'food'
      AND le.occurred_at >= $2 AND le.occurred_at < $3
  `, userID, dayStart, dayEnd).Scan(&count, &calories, &protein, &carbs, &fat, &fiber)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}

	writeJSON(w, 200, DayTotalsResponse{
		Date: dateStr, EntryCount: count,
		CaloriesIn: calories, ProteinG: protein, CarbsG: carbs, FatG: fat, FiberG: fiber,
	})
}

// ── Log Food ──────────────────────────────────────────────────────────────────

// ── Log Today ─────────────────────────────────────────────────────────────────

type LogEntry struct {
	ID           string  `json:"id"`
	Meal         string  `json:"meal"`
	FoodItemID   string  `json:"food_item_id"`
	FoodName     string  `json:"food_name"`
	ServingLabel string  `json:"serving_label"`
	Servings     float64 `json:"servings"`
	Calories     float64 `json:"calories"`
	ProteinG     float64 `json:"protein_g"`
	CarbsG       float64 `json:"carbs_g"`
	FatG         float64 `json:"fat_g"`
	FiberG       float64 `json:"fiber_g"`
	OccurredAt   string  `json:"occurred_at"`
}

func (a *App) HandleLogToday(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	dateStr := r.URL.Query().Get("date")
	if dateStr == "" {
		dateStr = a.now().Format("2006-01-02")
	}

	dayStart, err := time.ParseInLocation("2006-01-02", dateStr, a.Loc)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "bad date"})
		return
	}
	dayEnd := dayStart.Add(24 * time.Hour)

	rows, err := a.DB.Query(r.Context(), `
    SELECT le.id, le.meal, le.ref_id, fi.name, fi.serving_label, le.servings,
           le.servings * fi.calories_per_serving,
           le.servings * fi.protein_g_per_serving,
           le.servings * fi.carbs_g_per_serving,
           le.servings * fi.fat_g_per_serving,
           le.servings * fi.fiber_g_per_serving,
           le.occurred_at
    FROM log_entries le
    JOIN food_items fi ON fi.id = le.ref_id
    WHERE le.user_id = $1 AND le.kind = 'food' AND le.occurred_at >= $2 AND le.occurred_at < $3
    ORDER BY le.occurred_at;
  `, userID, dayStart, dayEnd)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()

	entries := []LogEntry{}
	for rows.Next() {
		var e LogEntry
		var ts time.Time
		if err := rows.Scan(&e.ID, &e.Meal, &e.FoodItemID, &e.FoodName, &e.ServingLabel, &e.Servings,
			&e.Calories, &e.ProteinG, &e.CarbsG, &e.FatG, &e.FiberG, &ts); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		e.OccurredAt = ts.Format(time.RFC3339)
		entries = append(entries, e)
	}
	writeJSON(w, 200, entries)
}

func (a *App) HandleDeleteLogEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing id"})
		return
	}
	ct, err := a.DB.Exec(r.Context(), `DELETE FROM log_entries WHERE id = $1;`, id)
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

// HandleLogRange returns per-day calorie totals for a date range (for the calendar view).
// Query params: user_id, from (YYYY-MM-DD), to (YYYY-MM-DD)
func (a *App) HandleLogRange(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	if fromStr == "" || toStr == "" {
		writeJSON(w, 400, map[string]any{"error": "from and to required"})
		return
	}
	from, err := time.ParseInLocation("2006-01-02", fromStr, a.Loc)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "bad from date"})
		return
	}
	to, err := time.ParseInLocation("2006-01-02", toStr, a.Loc)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "bad to date"})
		return
	}
	to = to.Add(24 * time.Hour) // inclusive

	rows, err := a.DB.Query(r.Context(), `
    SELECT DATE(le.occurred_at AT TIME ZONE $4) AS day, COALESCE(SUM(le.servings * fi.calories_per_serving), 0)
    FROM log_entries le
    JOIN food_items fi ON fi.id = le.ref_id
    WHERE le.user_id = $1 AND le.kind = 'food' AND le.occurred_at >= $2 AND le.occurred_at < $3
    GROUP BY day ORDER BY day;
  `, userID, from, to, a.Loc.String())
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()

	type DayTotal struct {
		Date     string  `json:"date"`
		Calories float64 `json:"calories"`
	}
	totals := []DayTotal{}
	for rows.Next() {
		var d DayTotal
		var day time.Time
		if err := rows.Scan(&day, &d.Calories); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		d.Date = day.Format("2006-01-02")
		totals = append(totals, d)
	}
	writeJSON(w, 200, totals)
}

// ── Log Food ──────────────────────────────────────────────────────────────────

type LogFoodRequest struct {
	UserID     string  `json:"user_id"`
	OccurredAt string  `json:"occurred_at"`
	FoodItemID string  `json:"food_item_id"`
	Servings   float64 `json:"servings"`
	Meal       string  `json:"meal"`
	Note       string  `json:"note"`
}

func (a *App) HandleLogFood(w http.ResponseWriter, r *http.Request) {
	var req LogFoodRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.OccurredAt == "" {
		req.OccurredAt = a.now().Format(time.RFC3339)
	}
	if req.Meal == "" {
		req.Meal = "breakfast"
	}
	if req.FoodItemID == "" || req.Servings <= 0 {
		writeJSON(w, 400, map[string]any{"error": "food_item_id and servings required"})
		return
	}
	t, err := time.Parse(time.RFC3339, req.OccurredAt)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "occurred_at must be RFC3339"})
		return
	}

	_, err = a.DB.Exec(r.Context(),
		`INSERT INTO log_entries (user_id, occurred_at, kind, ref_id, servings, meal, note) VALUES ($1,$2,'food',$3,$4,$5,$6);`,
		req.UserID, t, req.FoodItemID, req.Servings, req.Meal, req.Note,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true})
}
