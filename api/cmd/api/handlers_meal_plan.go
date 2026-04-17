package main

import (
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// ── types ─────────────────────────────────────────────────────────────────────

type MealPlanEntry struct {
	ID          string  `json:"id"`
	Date        string  `json:"date"`
	Meal        string  `json:"meal"`
	FoodItemID  string  `json:"food_item_id"`
	FoodName    string  `json:"food_name"`
	Brand       string  `json:"brand"`
	ServingLabel string `json:"serving_label"`
	Servings    float64 `json:"servings"`
	CaloriesPer float64 `json:"calories_per_serving"`
	ProteinPer  float64 `json:"protein_g_per_serving"`
	CarbsPer    float64 `json:"carbs_g_per_serving"`
	FatPer      float64 `json:"fat_g_per_serving"`
}

// ── GET /meal-plan ─────────────────────────────────────────────────────────────

func (a *App) HandleListMealPlan(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	start := r.URL.Query().Get("start")
	end := r.URL.Query().Get("end")
	if start == "" || end == "" {
		writeJSON(w, 400, map[string]any{"error": "start and end required (YYYY-MM-DD)"})
		return
	}

	rows, err := a.DB.Query(r.Context(),
		`SELECT mp.id, mp.date, mp.meal, mp.food_item_id,
		        fi.name, COALESCE(fi.brand,''), fi.serving_label, mp.servings,
		        fi.calories_per_serving, fi.protein_g_per_serving,
		        fi.carbs_g_per_serving, fi.fat_g_per_serving
		 FROM meal_plan_entries mp
		 JOIN food_items fi ON fi.id = mp.food_item_id
		 WHERE mp.user_id=$1 AND mp.date >= $2 AND mp.date <= $3
		 ORDER BY mp.date, mp.meal, mp.created_at`,
		userID, start, end,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()

	result := []MealPlanEntry{}
	for rows.Next() {
		var e MealPlanEntry
		var d time.Time
		if err := rows.Scan(&e.ID, &d, &e.Meal, &e.FoodItemID,
			&e.FoodName, &e.Brand, &e.ServingLabel, &e.Servings,
			&e.CaloriesPer, &e.ProteinPer, &e.CarbsPer, &e.FatPer,
		); err != nil {
			continue
		}
		e.Date = d.Format("2006-01-02")
		result = append(result, e)
	}
	writeJSON(w, 200, result)
}

// ── POST /meal-plan ────────────────────────────────────────────────────────────

type AddMealPlanEntryRequest struct {
	UserID     string  `json:"user_id"`
	Date       string  `json:"date"`
	Meal       string  `json:"meal"`
	FoodItemID string  `json:"food_item_id"`
	Servings   float64 `json:"servings"`
}

func (a *App) HandleAddMealPlanEntry(w http.ResponseWriter, r *http.Request) {
	var req AddMealPlanEntryRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}
	if req.Date == "" || req.Meal == "" || req.FoodItemID == "" {
		writeJSON(w, 400, map[string]any{"error": "date, meal, food_item_id required"})
		return
	}
	if req.Servings <= 0 {
		req.Servings = 1
	}

	var id string
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO meal_plan_entries (user_id, date, meal, food_item_id, servings)
		 VALUES ($1,$2,$3,$4,$5) RETURNING id`,
		req.UserID, req.Date, req.Meal, req.FoodItemID, req.Servings,
	).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"id": id})
}

// ── DELETE /meal-plan/{id} ─────────────────────────────────────────────────────

func (a *App) HandleDeleteMealPlanEntry(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	ct, err := a.DB.Exec(r.Context(),
		`DELETE FROM meal_plan_entries WHERE id=$1 AND user_id=$2`, id, userID,
	)
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

// ── GET /meal-plan/export.ics ──────────────────────────────────────────────────

func (a *App) HandleExportMealPlanICS(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}

	// Fetch meal-time settings
	settings := map[string]string{}
	sRows, _ := a.DB.Query(r.Context(),
		`SELECT key, value FROM user_settings WHERE user_id=$1 AND key LIKE 'meal_plan_%'`,
		userID,
	)
	if sRows != nil {
		for sRows.Next() {
			var k, v string
			if err := sRows.Scan(&k, &v); err == nil {
				settings[k] = v
			}
		}
		sRows.Close()
	}

	breakfastTime := settingOr(settings, "meal_plan_breakfast_time", "08:00")
	lunchTime := settingOr(settings, "meal_plan_lunch_time", "12:30")
	dinnerTime := settingOr(settings, "meal_plan_dinner_time", "19:00")
	weeksStr := settingOr(settings, "meal_plan_weeks", "2")
	weeks := 2
	if n := parseInt(weeksStr); n >= 1 && n <= 4 {
		weeks = n
	}

	now := a.now()
	// Start from Monday of current week
	weekday := int(now.Weekday())
	if weekday == 0 {
		weekday = 7
	}
	start := now.AddDate(0, 0, -(weekday - 1)).Format("2006-01-02")
	end := now.AddDate(0, 0, -(weekday-1)+weeks*7-1).Format("2006-01-02")

	rows, err := a.DB.Query(r.Context(),
		`SELECT mp.id, mp.date, mp.meal, fi.name, COALESCE(fi.brand,''),
		        mp.servings, fi.calories_per_serving
		 FROM meal_plan_entries mp
		 JOIN food_items fi ON fi.id = mp.food_item_id
		 WHERE mp.user_id=$1 AND mp.date >= $2 AND mp.date <= $3
		 ORDER BY mp.date, mp.meal, mp.created_at`,
		userID, start, end,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()

	// Group by date+meal
	type entry struct {
		name     string
		brand    string
		servings float64
		kcal     float64
	}
	type mealKey struct {
		date string
		meal string
	}
	grouped := map[mealKey][]entry{}
	order := []mealKey{}
	seen := map[mealKey]bool{}

	for rows.Next() {
		var id, dateRaw, meal, name, brand string
		var servings, kcalPer float64
		var d time.Time
		if err := rows.Scan(&id, &d, &meal, &name, &brand, &servings, &kcalPer); err != nil {
			continue
		}
		dateRaw = d.Format("2006-01-02")
		k := mealKey{dateRaw, meal}
		grouped[k] = append(grouped[k], entry{name, brand, servings, kcalPer})
		if !seen[k] {
			order = append(order, k)
			seen[k] = true
		}
	}
	rows.Close()

	tzName := a.Loc.String()
	if tzName == "Local" {
		tzName = "UTC"
	}
	stamp := now.UTC().Format("20060102T150405Z")

	var sb strings.Builder
	sb.WriteString("BEGIN:VCALENDAR\r\n")
	sb.WriteString("VERSION:2.0\r\n")
	sb.WriteString("PRODID:-//Intake//Meal Plan//EN\r\n")
	sb.WriteString("X-WR-CALNAME:Intake Meal Plan\r\n")
	sb.WriteString("METHOD:PUBLISH\r\n")

	for _, k := range order {
		entries := grouped[k]
		mealStart := mealTimeStr(k.date, mealTimeFor(k.meal, breakfastTime, lunchTime, dinnerTime))
		mealEnd := addMinutesStr(mealStart, 30)

		var descParts []string
		totalKcal := 0.0
		for _, e := range entries {
			label := e.name
			if e.brand != "" {
				label += " (" + e.brand + ")"
			}
			kcal := math.Round(e.kcal * e.servings)
			descParts = append(descParts, fmt.Sprintf("%s — %.4g serv / %g kcal", label, e.servings, kcal))
			totalKcal += kcal
		}
		desc := strings.Join(descParts, "\\n")
		summary := fmt.Sprintf("%s — Meal Plan (%.0f kcal)", capitalise(k.meal), totalKcal)

		uid := fmt.Sprintf("intake-meal-%s-%s@intake", k.date, k.meal)

		sb.WriteString("BEGIN:VEVENT\r\n")
		fmt.Fprintf(&sb, "UID:%s\r\n", uid)
		fmt.Fprintf(&sb, "DTSTAMP:%s\r\n", stamp)
		fmt.Fprintf(&sb, "DTSTART;TZID=%s:%s\r\n", tzName, mealStart)
		fmt.Fprintf(&sb, "DTEND;TZID=%s:%s\r\n", tzName, mealEnd)
		fmt.Fprintf(&sb, "SUMMARY:%s\r\n", summary)
		fmt.Fprintf(&sb, "DESCRIPTION:%s\r\n", desc)
		sb.WriteString("BEGIN:VALARM\r\n")
		sb.WriteString("TRIGGER:-PT5M\r\n")
		sb.WriteString("ACTION:DISPLAY\r\n")
		fmt.Fprintf(&sb, "DESCRIPTION:Time to log %s in Intake\r\n", k.meal)
		sb.WriteString("END:VALARM\r\n")
		sb.WriteString("END:VEVENT\r\n")
	}

	sb.WriteString("END:VCALENDAR\r\n")

	w.Header().Set("Content-Type", "text/calendar; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=intake-meal-plan.ics")
	w.WriteHeader(200)
	w.Write([]byte(sb.String())) //nolint:errcheck
}

// ── helpers ───────────────────────────────────────────────────────────────────

func settingOr(m map[string]string, key, def string) string {
	if v, ok := m[key]; ok && v != "" {
		return v
	}
	return def
}

func parseInt(s string) int {
	n := 0
	for _, c := range s {
		if c >= '0' && c <= '9' {
			n = n*10 + int(c-'0')
		}
	}
	return n
}

func capitalise(s string) string {
	if s == "" {
		return s
	}
	return strings.ToUpper(s[:1]) + s[1:]
}

func mealTimeFor(meal, breakfast, lunch, dinner string) string {
	switch meal {
	case "lunch":
		return lunch
	case "dinner":
		return dinner
	default:
		return breakfast
	}
}

// mealTimeStr converts "2026-04-15" + "08:00" → "20260415T080000"
func mealTimeStr(date, hhmm string) string {
	d := strings.ReplaceAll(date, "-", "")
	t := strings.ReplaceAll(hhmm, ":", "") + "00"
	return d + "T" + t
}

// addMinutesStr adds minutes to an ICS datetime string like "20260415T080000"
func addMinutesStr(dt string, mins int) string {
	// parse hhmm from T portion
	if len(dt) < 15 {
		return dt
	}
	h := parseInt(dt[9:11])
	m := parseInt(dt[11:13])
	total := h*60 + m + mins
	h2 := (total / 60) % 24
	m2 := total % 60
	return fmt.Sprintf("%sT%02d%02d00", dt[:8], h2, m2)
}
