package main

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/jackc/pgx/v5/pgxpool"
)

type App struct {
	DB  *pgxpool.Pool
	Loc *time.Location
}

const DefaultUserID = "00000000-0000-0000-0000-000000000001"

func main() {
	port := os.Getenv("API_PORT")
	if port == "" {
		port = "8080"
	}
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		log.Fatal("DATABASE_URL is required")
	}
	loc := time.Local
	tz := os.Getenv("APP_TIMEZONE")
	if tz != "" {
		loaded, err := time.LoadLocation(tz)
		if err != nil {
			log.Printf("invalid APP_TIMEZONE=%q, falling back to local: %v", tz, err)
		} else {
			loc = loaded
		}
	}

	ctx := context.Background()
	db, err := pgxpool.New(ctx, dsn)
	if err != nil {
		log.Fatalf("db connect: %v", err)
	}
	defer db.Close()

	app := &App{DB: db, Loc: loc}
	if err := app.EnsureRecipePages(context.Background()); err != nil {
		log.Printf("ensure recipe pages failed: %v", err)
	}

	r := chi.NewRouter()
	r.Use(middleware.RealIP, middleware.RequestID, middleware.Logger, middleware.Recoverer)
	r.Use(middleware.Timeout(10 * time.Second))
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ww := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
			start := time.Now()
			reqID := middleware.GetReqID(r.Context())
			log.Printf("[api-debug] req_id=%s method=%s path=%s query=%q content_length=%d remote=%s",
				reqID, r.Method, r.URL.Path, r.URL.RawQuery, r.ContentLength, r.RemoteAddr)
			next.ServeHTTP(ww, r)
			log.Printf("[api-debug] req_id=%s status=%d bytes=%d duration_ms=%d",
				reqID, ww.Status(), ww.BytesWritten(), time.Since(start).Milliseconds())
		})
	})
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Access-Control-Allow-Origin", "*")
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
			next.ServeHTTP(w, r)
		})
	})

	r.Options("/*", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	})

	r.Get("/healthz", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, 200, map[string]any{"ok": true, "time": app.now().Format(time.RFC3339)})
	})

	r.Get("/dashboard/today", app.HandleDashboardToday)
	r.Get("/day/totals", app.HandleDayTotals)
	r.Post("/food-items", app.HandleCreateFoodItem)
	r.Get("/food-items", app.HandleListFoodItems)
	r.Get("/food-items/{id}", app.HandleGetFoodItem)
	r.Put("/food-items/{id}", app.HandleUpdateFoodItem)
	r.Delete("/food-items/{id}", app.HandleDeleteFoodItem)
	r.Get("/log/today", app.HandleLogToday)
	r.Get("/log/range", app.HandleLogRange)
	r.Post("/log/food", app.HandleLogFood)
	r.Delete("/log/{id}", app.HandleDeleteLogEntry)
	r.Post("/body/weight", app.HandleBodyWeight)
	r.Post("/activity/daily", app.HandleDailyActivity)
	r.Post("/presets", app.HandleCreatePreset)
	r.Post("/presets/{id}/apply", app.HandleApplyPreset)
	r.Get("/recipes", app.HandleListRecipes)
	r.Post("/recipes", app.HandleCreateRecipe)
	r.Get("/recipes/{id}", app.HandleGetRecipe)
	r.Put("/recipes/{id}", app.HandleUpdateRecipe)
	r.Post("/recipes/{id}/ingredients", app.HandleAddRecipeIngredient)
	r.Put("/recipes/{id}/ingredients", app.HandleReplaceRecipeIngredients)
	r.Put("/recipes/{id}/ingredients/{ingredient_id}", app.HandleUpdateRecipeIngredient)
	r.Delete("/recipes/{id}/ingredients/{ingredient_id}", app.HandleDeleteRecipeIngredient)
	r.Post("/recipes/export-ingredients", app.HandleExportRecipeIngredients)
	r.Get("/recipes/{id}/shopping-items", app.HandleGetShoppingItems)
	r.Put("/recipes/{id}/shopping-items", app.HandleReplaceShoppingItems)
	r.Get("/recipes/{id}/photo", app.HandleGetRecipePhoto)
	r.Put("/recipes/{id}/photo", app.HandlePutRecipePhoto)
	r.Delete("/recipes/{id}/photo", app.HandleDeleteRecipePhoto)
	r.Get("/shopping-list", app.HandleShoppingList)
	r.Get("/pantry", app.HandleListPantry)
	r.Put("/pantry/{food_item_id}", app.HandleUpsertPantry)
	r.Delete("/pantry/{food_item_id}", app.HandleDeletePantry)
	r.Post("/pantry/deduct", app.HandleDeductPantry)
	r.Get("/data/export", app.HandleExportData)
	r.Get("/data/export/markdown", app.HandleExportMarkdown)
	r.Post("/data/import", app.HandleImportData)

	srv := &http.Server{Addr: ":" + port, Handler: r, ReadHeaderTimeout: 5 * time.Second}
	log.Printf("api listening on :%s", port)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func (a *App) now() time.Time {
	if a.Loc == nil {
		return time.Now()
	}
	return time.Now().In(a.Loc)
}

// ── Food Items ────────────────────────────────────────────────────────────────

type CreateFoodItemRequest struct {
	UserID             string  `json:"user_id"`
	Name               string  `json:"name"`
	Brand              string  `json:"brand"`
	ServingLabel       string  `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinPerServing  float64 `json:"protein_g_per_serving"`
	CarbsPerServing    float64 `json:"carbs_g_per_serving"`
	FatPerServing      float64 `json:"fat_g_per_serving"`
	FiberPerServing    float64 `json:"fiber_g_per_serving"`
	RecipeInstructions string  `json:"recipe_instructions"`
	RecipeYieldCount   int     `json:"recipe_yield_count"`
	RecipeIngredients  []struct {
		FoodItemID string  `json:"food_item_id"`
		AmountG    float64 `json:"amount_g"`
	} `json:"recipe_ingredients"`
}

func (a *App) HandleCreateFoodItem(w http.ResponseWriter, r *http.Request) {
	var req CreateFoodItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}
	if req.ServingLabel == "" {
		req.ServingLabel = "1 serving"
	}
	if req.RecipeYieldCount <= 0 {
		req.RecipeYieldCount = 1
	}
	var id string
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	err = tx.QueryRow(ctx, `
    INSERT INTO food_items (user_id, name, brand, serving_label, calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'custom') RETURNING id;
  `, req.UserID, req.Name, req.Brand, req.ServingLabel, req.CaloriesPerServing, req.ProteinPerServing, req.CarbsPerServing, req.FatPerServing, req.FiberPerServing).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert food_item: %v", err)})
		return
	}
	_, err = tx.Exec(ctx, `
    INSERT INTO recipes (id, user_id, name, instructions, yield_count)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (id) DO UPDATE SET
      user_id = EXCLUDED.user_id,
      name = EXCLUDED.name,
      instructions = EXCLUDED.instructions,
      yield_count = EXCLUDED.yield_count;
  `, id, req.UserID, req.Name, req.RecipeInstructions, req.RecipeYieldCount)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert recipe: %v", err)})
		return
	}
	for _, it := range req.RecipeIngredients {
		if it.FoodItemID == "" || it.AmountG <= 0 {
			continue
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO recipe_ingredients (recipe_id, food_item_id, amount_g)
      VALUES ($1,$2,$3);
    `, id, it.FoodItemID, it.AmountG)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert recipe ingredient: %v", err)})
			return
		}
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "id": id, "recipe_id": id})
}

type FoodItem struct {
	ID                 string  `json:"id"`
	Name               string  `json:"name"`
	Brand              string  `json:"brand"`
	ServingLabel       string  `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinPerServing  float64 `json:"protein_g_per_serving"`
	CarbsPerServing    float64 `json:"carbs_g_per_serving"`
	FatPerServing      float64 `json:"fat_g_per_serving"`
	FiberPerServing    float64 `json:"fiber_g_per_serving"`
}

func (a *App) HandleListFoodItems(w http.ResponseWriter, r *http.Request) {
	rows, err := a.DB.Query(r.Context(), `
    SELECT id, name, COALESCE(brand,''), serving_label, calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving
    FROM food_items ORDER BY name;
  `)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()
	items := []FoodItem{}
	for rows.Next() {
		var it FoodItem
		if err := rows.Scan(&it.ID, &it.Name, &it.Brand, &it.ServingLabel, &it.CaloriesPerServing, &it.ProteinPerServing, &it.CarbsPerServing, &it.FatPerServing, &it.FiberPerServing); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan"})
			return
		}
		items = append(items, it)
	}
	writeJSON(w, 200, items)
}

func (a *App) HandleGetFoodItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing id"})
		return
	}
	var it FoodItem
	err := a.DB.QueryRow(r.Context(), `
    SELECT id, name, COALESCE(brand,''), serving_label, calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving
    FROM food_items
    WHERE id = $1;
  `, id).Scan(&it.ID, &it.Name, &it.Brand, &it.ServingLabel, &it.CaloriesPerServing, &it.ProteinPerServing, &it.CarbsPerServing, &it.FatPerServing, &it.FiberPerServing)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "food item not found"})
		return
	}
	writeJSON(w, 200, it)
}

type UpdateFoodItemRequest struct {
	Name               string  `json:"name"`
	Brand              string  `json:"brand"`
	ServingLabel       string  `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinPerServing  float64 `json:"protein_g_per_serving"`
	CarbsPerServing    float64 `json:"carbs_g_per_serving"`
	FatPerServing      float64 `json:"fat_g_per_serving"`
	FiberPerServing    float64 `json:"fiber_g_per_serving"`
	RecipeInstructions string  `json:"recipe_instructions"`
	RecipeYieldCount   int     `json:"recipe_yield_count"`
}

func (a *App) HandleUpdateFoodItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing id"})
		return
	}
	var req UpdateFoodItemRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.ServingLabel == "" {
		req.ServingLabel = "1 serving"
	}
	if req.RecipeYieldCount <= 0 {
		req.RecipeYieldCount = 1
	}
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	ct, err := tx.Exec(ctx, `
    UPDATE food_items
    SET name = $1, brand = $2, serving_label = $3,
        calories_per_serving = $4,
        protein_g_per_serving = $5,
        carbs_g_per_serving = $6,
        fat_g_per_serving = $7,
        fiber_g_per_serving = $8
    WHERE id = $9;
  `, req.Name, req.Brand, req.ServingLabel,
		req.CaloriesPerServing, req.ProteinPerServing, req.CarbsPerServing, req.FatPerServing, req.FiberPerServing,
		id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("update food item: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "food item not found"})
		return
	}
	_, _ = tx.Exec(ctx, `
    UPDATE recipes
    SET name = $1,
        instructions = CASE WHEN $2 <> '' THEN $2 ELSE instructions END,
        yield_count = CASE WHEN $3 > 0 THEN $3 ELSE yield_count END
    WHERE id = $4;
  `, req.Name, req.RecipeInstructions, req.RecipeYieldCount, id)
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeleteFoodItem(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing id"})
		return
	}
	ct, err := a.DB.Exec(r.Context(), `DELETE FROM food_items WHERE id = $1;`, id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "food item not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) EnsureRecipePages(ctx context.Context) error {
	_, err := a.DB.Exec(ctx, `
    INSERT INTO recipes (id, user_id, name, instructions, yield_count, created_at)
    SELECT fi.id,
           COALESCE(fi.user_id, $1::uuid),
           fi.name,
           '',
           1,
           fi.created_at
    FROM food_items fi
    LEFT JOIN recipes r ON r.id = fi.id
    WHERE r.id IS NULL;
  `, DefaultUserID)
	return err
}

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

// ── Recipes ───────────────────────────────────────────────────────────────────

type RecipeSummary struct {
	ID                 string    `json:"id"`
	Name               string    `json:"name"`
	Brand              string    `json:"brand"`
	ServingLabel       string    `json:"serving_label"`
	Instructions       string    `json:"instructions"`
	YieldCount         int       `json:"yield_count"`
	CaloriesPerServing float64   `json:"calories_per_serving"`
	ProteinPerServing  float64   `json:"protein_g_per_serving"`
	CarbsPerServing    float64   `json:"carbs_g_per_serving"`
	FatPerServing      float64   `json:"fat_g_per_serving"`
	FiberPerServing    float64   `json:"fiber_g_per_serving"`
	CreatedAt          time.Time `json:"created_at"`
	IngredientCnt      int       `json:"ingredient_count"`
}

type RecipeIngredientDetail struct {
	ID         string  `json:"id"`
	FoodItemID string  `json:"food_item_id"`
	FoodName   string  `json:"food_name"`
	Brand      string  `json:"brand"`
	AmountG    float64 `json:"amount_g"`
}

type RecipeDetail struct {
	ID           string                   `json:"id"`
	UserID       string                   `json:"user_id"`
	Name         string                   `json:"name"`
	Instructions string                   `json:"instructions"`
	YieldCount   int                      `json:"yield_count"`
	CreatedAt    time.Time                `json:"created_at"`
	Ingredients  []RecipeIngredientDetail `json:"ingredients"`
}

type CreateRecipeRequest struct {
	UserID             string  `json:"user_id"`
	Name               string  `json:"name"`
	Brand              string  `json:"brand"`
	ServingLabel       string  `json:"serving_label"`
	CaloriesPerServing float64 `json:"calories_per_serving"`
	ProteinPerServing  float64 `json:"protein_g_per_serving"`
	CarbsPerServing    float64 `json:"carbs_g_per_serving"`
	FatPerServing      float64 `json:"fat_g_per_serving"`
	FiberPerServing    float64 `json:"fiber_g_per_serving"`
	Instructions       string  `json:"instructions"`
	YieldCount         int     `json:"yield_count"`
}

func (a *App) HandleListRecipes(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	rows, err := a.DB.Query(r.Context(), `
    SELECT r.id, fi.name, COALESCE(fi.brand,''), fi.serving_label,
           COALESCE(r.instructions,''), r.yield_count,
           fi.calories_per_serving, fi.protein_g_per_serving, fi.carbs_g_per_serving, fi.fat_g_per_serving, fi.fiber_g_per_serving,
           r.created_at, COUNT(rsi.id) AS ingredient_count
    FROM recipes r
    INNER JOIN food_items fi ON fi.id = r.id
    LEFT JOIN recipe_shopping_items rsi ON rsi.recipe_id = r.id
    WHERE r.user_id = $1
    GROUP BY r.id, fi.id
    ORDER BY fi.name ASC;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("list recipes: %v", err)})
		return
	}
	defer rows.Close()
	out := []RecipeSummary{}
	for rows.Next() {
		var it RecipeSummary
		if err := rows.Scan(&it.ID, &it.Name, &it.Brand, &it.ServingLabel,
			&it.Instructions, &it.YieldCount,
			&it.CaloriesPerServing, &it.ProteinPerServing, &it.CarbsPerServing, &it.FatPerServing, &it.FiberPerServing,
			&it.CreatedAt, &it.IngredientCnt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan recipes"})
			return
		}
		out = append(out, it)
	}
	writeJSON(w, 200, out)
}

func (a *App) HandleCreateRecipe(w http.ResponseWriter, r *http.Request) {
	var req CreateRecipeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.YieldCount <= 0 {
		req.YieldCount = 1
	}
	if req.ServingLabel == "" {
		req.ServingLabel = "1 serving"
	}
	// Always create food_item + recipe together so they share an ID.
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var id string
	err = tx.QueryRow(ctx, `
    INSERT INTO food_items (user_id, name, brand, serving_label, calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving, source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'custom') RETURNING id;
  `, req.UserID, req.Name, req.Brand, req.ServingLabel, req.CaloriesPerServing, req.ProteinPerServing, req.CarbsPerServing, req.FatPerServing, req.FiberPerServing).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("create food item: %v", err)})
		return
	}
	_, err = tx.Exec(ctx, `
    INSERT INTO recipes (id, user_id, name, instructions, yield_count)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, instructions=EXCLUDED.instructions, yield_count=EXCLUDED.yield_count;
  `, id, req.UserID, req.Name, req.Instructions, req.YieldCount)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("create recipe: %v", err)})
		return
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "id": id})
}

func (a *App) HandleGetRecipe(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing recipe id"})
		return
	}
	var out RecipeDetail
	err := a.DB.QueryRow(r.Context(), `
    SELECT id, user_id::text, name, COALESCE(instructions,''), yield_count, created_at
    FROM recipes
    WHERE id = $1 AND user_id = $2;
  `, id, userID).Scan(&out.ID, &out.UserID, &out.Name, &out.Instructions, &out.YieldCount, &out.CreatedAt)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "recipe not found"})
		return
	}
	rows, err := a.DB.Query(r.Context(), `
    SELECT ri.id, fi.id, fi.name, COALESCE(fi.brand,''), ri.amount_g
    FROM recipe_ingredients ri
    JOIN food_items fi ON fi.id = ri.food_item_id
    WHERE ri.recipe_id = $1
    ORDER BY fi.name;
  `, id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("list ingredients: %v", err)})
		return
	}
	defer rows.Close()
	for rows.Next() {
		var it RecipeIngredientDetail
		if err := rows.Scan(&it.ID, &it.FoodItemID, &it.FoodName, &it.Brand, &it.AmountG); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan ingredients"})
			return
		}
		out.Ingredients = append(out.Ingredients, it)
	}
	writeJSON(w, 200, out)
}

type UpdateRecipeRequest struct {
	UserID       string `json:"user_id"`
	Name         string `json:"name"`
	Instructions string `json:"instructions"`
	YieldCount   int    `json:"yield_count"`
}

func (a *App) HandleUpdateRecipe(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if id == "" {
		writeJSON(w, 400, map[string]any{"error": "missing recipe id"})
		return
	}
	var req UpdateRecipeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.YieldCount <= 0 {
		req.YieldCount = 1
	}
	ct, err := a.DB.Exec(r.Context(), `
    UPDATE recipes
    SET name = $1, instructions = $2, yield_count = $3
    WHERE id = $4 AND user_id = $5;
  `, req.Name, req.Instructions, req.YieldCount, id, req.UserID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("update recipe: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "recipe not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

type AddRecipeIngredientRequest struct {
	UserID     string  `json:"user_id"`
	FoodItemID string  `json:"food_item_id"`
	AmountG    float64 `json:"amount_g"`
}

func (a *App) HandleAddRecipeIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	if recipeID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing recipe id"})
		return
	}
	var req AddRecipeIngredientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.FoodItemID == "" || req.AmountG <= 0 {
		writeJSON(w, 400, map[string]any{"error": "food_item_id and amount_g required"})
		return
	}
	var exists bool
	if err := a.DB.QueryRow(r.Context(), `SELECT EXISTS(SELECT 1 FROM recipes WHERE id=$1 AND user_id=$2);`, recipeID, req.UserID).Scan(&exists); err != nil || !exists {
		writeJSON(w, 404, map[string]any{"error": "recipe not found"})
		return
	}
	var id string
	err := a.DB.QueryRow(r.Context(), `
    INSERT INTO recipe_ingredients (recipe_id, food_item_id, amount_g)
    VALUES ($1,$2,$3)
    RETURNING id;
  `, recipeID, req.FoodItemID, req.AmountG).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("add ingredient: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"ok": true, "id": id})
}

type UpdateRecipeIngredientRequest struct {
	UserID  string  `json:"user_id"`
	AmountG float64 `json:"amount_g"`
}

func (a *App) HandleUpdateRecipeIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	ingredientID := chi.URLParam(r, "ingredient_id")
	if recipeID == "" || ingredientID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing ids"})
		return
	}
	var req UpdateRecipeIngredientRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if req.AmountG <= 0 {
		writeJSON(w, 400, map[string]any{"error": "amount_g required"})
		return
	}
	ct, err := a.DB.Exec(r.Context(), `
    UPDATE recipe_ingredients ri
    SET amount_g = $1
    FROM recipes r
    WHERE ri.id = $2
      AND ri.recipe_id = $3
      AND r.id = ri.recipe_id
      AND r.user_id = $4;
  `, req.AmountG, ingredientID, recipeID, req.UserID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("update ingredient: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "ingredient not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

type ReplaceRecipeIngredientsRequest struct {
	UserID      string `json:"user_id"`
	Ingredients []struct {
		FoodItemID string  `json:"food_item_id"`
		AmountG    float64 `json:"amount_g"`
	} `json:"ingredients"`
}

func (a *App) HandleReplaceRecipeIngredients(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	if recipeID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing recipe id"})
		return
	}
	var req ReplaceRecipeIngredientsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}
	ctx := r.Context()
	tx, err := a.DB.Begin(ctx)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx begin"})
		return
	}
	defer func() { _ = tx.Rollback(ctx) }()
	var exists bool
	if err := tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM recipes WHERE id=$1 AND user_id=$2);`, recipeID, req.UserID).Scan(&exists); err != nil || !exists {
		writeJSON(w, 404, map[string]any{"error": "recipe not found"})
		return
	}
	if _, err := tx.Exec(ctx, `DELETE FROM recipe_ingredients WHERE recipe_id = $1;`, recipeID); err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("clear ingredients: %v", err)})
		return
	}
	inserted := 0
	for _, it := range req.Ingredients {
		if it.FoodItemID == "" || it.AmountG <= 0 {
			continue
		}
		if _, err := tx.Exec(ctx, `
      INSERT INTO recipe_ingredients (recipe_id, food_item_id, amount_g)
      VALUES ($1,$2,$3);
    `, recipeID, it.FoodItemID, it.AmountG); err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("replace ingredient: %v", err)})
			return
		}
		inserted++
	}
	if err := tx.Commit(ctx); err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true, "ingredient_count": inserted})
}

func (a *App) HandleDeleteRecipeIngredient(w http.ResponseWriter, r *http.Request) {
	recipeID := chi.URLParam(r, "id")
	ingredientID := chi.URLParam(r, "ingredient_id")
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	if recipeID == "" || ingredientID == "" {
		writeJSON(w, 400, map[string]any{"error": "missing ids"})
		return
	}
	ct, err := a.DB.Exec(r.Context(), `
    DELETE FROM recipe_ingredients ri
    USING recipes r
    WHERE ri.id = $1 AND ri.recipe_id = $2 AND r.id = ri.recipe_id AND r.user_id = $3;
  `, ingredientID, recipeID, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete ingredient: %v", err)})
		return
	}
	if ct.RowsAffected() == 0 {
		writeJSON(w, 404, map[string]any{"error": "ingredient not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

type ExportIngredientsRequest struct {
	UserID    string   `json:"user_id"`
	RecipeIDs []string `json:"recipe_ids"`
}

type CombinedIngredient struct {
	FoodItemID string  `json:"food_item_id"`
	Name       string  `json:"name"`
	Brand      string  `json:"brand"`
	TotalG     float64 `json:"total_g"`
}

func (a *App) HandleExportRecipeIngredients(w http.ResponseWriter, r *http.Request) {
	var req ExportIngredientsRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = "00000000-0000-0000-0000-000000000001"
	}
	if len(req.RecipeIDs) == 0 {
		writeJSON(w, 400, map[string]any{"error": "recipe_ids required"})
		return
	}
	rows, err := a.DB.Query(r.Context(), `
    SELECT fi.id, fi.name, COALESCE(fi.brand,''), SUM(ri.amount_g)::float8 AS total_g
    FROM recipe_ingredients ri
    JOIN recipes r ON r.id = ri.recipe_id
    JOIN food_items fi ON fi.id = ri.food_item_id
    WHERE r.user_id = $1 AND r.id = ANY($2::uuid[])
    GROUP BY fi.id, fi.name, fi.brand
    ORDER BY fi.name;
  `, req.UserID, req.RecipeIDs)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export ingredients: %v", err)})
		return
	}
	defer rows.Close()
	out := []CombinedIngredient{}
	for rows.Next() {
		var it CombinedIngredient
		if err := rows.Scan(&it.FoodItemID, &it.Name, &it.Brand, &it.TotalG); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan combined ingredients"})
			return
		}
		out = append(out, it)
	}
	writeJSON(w, 200, map[string]any{
		"ok":          true,
		"ingredients": out,
	})
}

// ── Data Export / Import ─────────────────────────────────────────────────────

type ExportFoodItem struct {
	ID                 string    `json:"id"`
	UserID             string    `json:"user_id,omitempty"`
	Name               string    `json:"name"`
	Brand              string    `json:"brand"`
	ServingLabel       string    `json:"serving_label"`
	Source             string    `json:"source"`
	CaloriesPerServing float64   `json:"calories_per_serving"`
	ProteinPerServing  float64   `json:"protein_g_per_serving"`
	CarbsPerServing    float64   `json:"carbs_g_per_serving"`
	FatPerServing      float64   `json:"fat_g_per_serving"`
	FiberPerServing    float64   `json:"fiber_g_per_serving"`
	CreatedAt          time.Time `json:"created_at"`
}

type ExportRecipe struct {
	ID           string    `json:"id"`
	UserID       string    `json:"user_id"`
	Name         string    `json:"name"`
	Instructions string    `json:"instructions"`
	YieldCount   int       `json:"yield_count"`
	CreatedAt    time.Time `json:"created_at"`
}

type ExportRecipeIngredient struct {
	ID         string    `json:"id"`
	RecipeID   string    `json:"recipe_id"`
	FoodItemID string    `json:"food_item_id"`
	AmountG    float64   `json:"amount_g"`
	CreatedAt  time.Time `json:"created_at"`
}

type ExportRecipePortion struct {
	ID           string    `json:"id"`
	RecipeID     string    `json:"recipe_id"`
	Name         string    `json:"name"`
	PortionCount float64   `json:"portion_count"`
	CreatedAt    time.Time `json:"created_at"`
}

type ExportPreset struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	Name      string    `json:"name"`
	Pinned    bool      `json:"pinned"`
	CreatedAt time.Time `json:"created_at"`
}

type ExportPresetItem struct {
	ID        string    `json:"id"`
	PresetID  string    `json:"preset_id"`
	Kind      string    `json:"kind"`
	RefID     string    `json:"ref_id"`
	Servings  float64   `json:"servings"`
	CreatedAt time.Time `json:"created_at"`
}

type ExportLogEntry struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	OccurredAt time.Time `json:"occurred_at"`
	Kind       string    `json:"kind"`
	RefID      string    `json:"ref_id"`
	Servings   float64   `json:"servings"`
	Meal       string    `json:"meal"`
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"created_at"`
}

type ExportBodyWeight struct {
	ID         string    `json:"id"`
	UserID     string    `json:"user_id"`
	MeasuredAt time.Time `json:"measured_at"`
	WeightKg   float64   `json:"weight_kg"`
	Source     string    `json:"source"`
	Note       string    `json:"note"`
	CreatedAt  time.Time `json:"created_at"`
}

type ExportDailyActivity struct {
	UserID        string    `json:"user_id"`
	Date          string    `json:"date"`
	Steps         int       `json:"steps"`
	ActiveKcalEst float64   `json:"active_calories_kcal_est"`
	Source        string    `json:"source"`
	CreatedAt     time.Time `json:"created_at"`
}

type ExportBundle struct {
	Version           int                      `json:"version"`
	ExportedAt        time.Time                `json:"exported_at"`
	UserID            string                   `json:"user_id"`
	FoodItems         []ExportFoodItem         `json:"food_items"`
	Recipes           []ExportRecipe           `json:"recipes"`
	RecipeIngredients []ExportRecipeIngredient `json:"recipe_ingredients"`
	RecipePortions    []ExportRecipePortion    `json:"recipe_portions"`
	Presets           []ExportPreset           `json:"presets"`
	PresetItems       []ExportPresetItem       `json:"preset_items"`
	LogEntries        []ExportLogEntry         `json:"log_entries"`
	BodyWeights       []ExportBodyWeight       `json:"body_weights"`
	DailyActivity     []ExportDailyActivity    `json:"daily_activity"`
}

func (a *App) HandleExportData(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = "00000000-0000-0000-0000-000000000001"
	}
	reqID := middleware.GetReqID(r.Context())
	log.Printf("[api-debug] req_id=%s export start user_id=%s", reqID, userID)
	ctx := r.Context()
	out := ExportBundle{
		Version:    1,
		ExportedAt: time.Now().UTC(),
		UserID:     userID,
	}

	foodRows, err := a.DB.Query(ctx, `
    SELECT id, COALESCE(user_id::text, ''), name, COALESCE(brand,''), serving_label, source,
           calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving, created_at
    FROM food_items
    ORDER BY created_at, id;
  `)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export food_items: %v", err)})
		return
	}
	defer foodRows.Close()
	for foodRows.Next() {
		var it ExportFoodItem
		if err := foodRows.Scan(
			&it.ID, &it.UserID, &it.Name, &it.Brand, &it.ServingLabel, &it.Source,
			&it.CaloriesPerServing, &it.ProteinPerServing, &it.CarbsPerServing, &it.FatPerServing, &it.FiberPerServing, &it.CreatedAt,
		); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export food_items scan"})
			return
		}
		out.FoodItems = append(out.FoodItems, it)
	}

	recipeRows, err := a.DB.Query(ctx, `
    SELECT id, user_id::text, name, COALESCE(instructions,''), yield_count, created_at
    FROM recipes
    WHERE user_id = $1
    ORDER BY created_at, id;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export recipes: %v", err)})
		return
	}
	defer recipeRows.Close()
	for recipeRows.Next() {
		var it ExportRecipe
		if err := recipeRows.Scan(&it.ID, &it.UserID, &it.Name, &it.Instructions, &it.YieldCount, &it.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export recipes scan"})
			return
		}
		out.Recipes = append(out.Recipes, it)
	}

	ingredientRows, err := a.DB.Query(ctx, `
    SELECT ri.id, ri.recipe_id::text, ri.food_item_id::text, ri.amount_g, ri.created_at
    FROM recipe_ingredients ri
    JOIN recipes r ON r.id = ri.recipe_id
    WHERE r.user_id = $1
    ORDER BY ri.created_at, ri.id;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export recipe_ingredients: %v", err)})
		return
	}
	defer ingredientRows.Close()
	for ingredientRows.Next() {
		var it ExportRecipeIngredient
		if err := ingredientRows.Scan(&it.ID, &it.RecipeID, &it.FoodItemID, &it.AmountG, &it.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export recipe_ingredients scan"})
			return
		}
		out.RecipeIngredients = append(out.RecipeIngredients, it)
	}

	portionRows, err := a.DB.Query(ctx, `
    SELECT rp.id, rp.recipe_id::text, rp.name, rp.portion_count, rp.created_at
    FROM recipe_portions rp
    JOIN recipes r ON r.id = rp.recipe_id
    WHERE r.user_id = $1
    ORDER BY rp.created_at, rp.id;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export recipe_portions: %v", err)})
		return
	}
	defer portionRows.Close()
	for portionRows.Next() {
		var it ExportRecipePortion
		if err := portionRows.Scan(&it.ID, &it.RecipeID, &it.Name, &it.PortionCount, &it.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export recipe_portions scan"})
			return
		}
		out.RecipePortions = append(out.RecipePortions, it)
	}

	presetRows, err := a.DB.Query(ctx, `
    SELECT id, user_id::text, name, pinned, created_at
    FROM presets
    WHERE user_id = $1
    ORDER BY created_at, id;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export presets: %v", err)})
		return
	}
	defer presetRows.Close()
	for presetRows.Next() {
		var it ExportPreset
		if err := presetRows.Scan(&it.ID, &it.UserID, &it.Name, &it.Pinned, &it.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export presets scan"})
			return
		}
		out.Presets = append(out.Presets, it)
	}

	presetItemRows, err := a.DB.Query(ctx, `
    SELECT pi.id, pi.preset_id::text, pi.kind, pi.ref_id::text, pi.servings, pi.created_at
    FROM preset_items pi
    JOIN presets p ON p.id = pi.preset_id
    WHERE p.user_id = $1
    ORDER BY pi.created_at, pi.id;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export preset_items: %v", err)})
		return
	}
	defer presetItemRows.Close()
	for presetItemRows.Next() {
		var it ExportPresetItem
		if err := presetItemRows.Scan(&it.ID, &it.PresetID, &it.Kind, &it.RefID, &it.Servings, &it.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export preset_items scan"})
			return
		}
		out.PresetItems = append(out.PresetItems, it)
	}

	logRows, err := a.DB.Query(ctx, `
    SELECT id, user_id::text, occurred_at, kind, ref_id::text, servings, meal, COALESCE(note,''), created_at
    FROM log_entries
    WHERE user_id = $1
    ORDER BY occurred_at, id;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export log_entries: %v", err)})
		return
	}
	defer logRows.Close()
	for logRows.Next() {
		var it ExportLogEntry
		if err := logRows.Scan(&it.ID, &it.UserID, &it.OccurredAt, &it.Kind, &it.RefID, &it.Servings, &it.Meal, &it.Note, &it.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export log_entries scan"})
			return
		}
		out.LogEntries = append(out.LogEntries, it)
	}

	weightRows, err := a.DB.Query(ctx, `
    SELECT id, user_id::text, measured_at, weight_kg, source, COALESCE(note,''), created_at
    FROM body_weights
    WHERE user_id = $1
    ORDER BY measured_at, id;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export body_weights: %v", err)})
		return
	}
	defer weightRows.Close()
	for weightRows.Next() {
		var it ExportBodyWeight
		if err := weightRows.Scan(&it.ID, &it.UserID, &it.MeasuredAt, &it.WeightKg, &it.Source, &it.Note, &it.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export body_weights scan"})
			return
		}
		out.BodyWeights = append(out.BodyWeights, it)
	}

	activityRows, err := a.DB.Query(ctx, `
    SELECT user_id::text, date, steps, active_calories_kcal_est, source, created_at
    FROM daily_activity
    WHERE user_id = $1
    ORDER BY date;
  `, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("export daily_activity: %v", err)})
		return
	}
	defer activityRows.Close()
	for activityRows.Next() {
		var it ExportDailyActivity
		var dateVal time.Time
		if err := activityRows.Scan(&it.UserID, &dateVal, &it.Steps, &it.ActiveKcalEst, &it.Source, &it.CreatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "export daily_activity scan"})
			return
		}
		it.Date = dateVal.Format("2006-01-02")
		out.DailyActivity = append(out.DailyActivity, it)
	}

	log.Printf("[api-debug] req_id=%s export done food_items=%d recipes=%d recipe_ingredients=%d recipe_portions=%d presets=%d preset_items=%d log_entries=%d body_weights=%d daily_activity=%d",
		reqID, len(out.FoodItems), len(out.Recipes), len(out.RecipeIngredients), len(out.RecipePortions), len(out.Presets), len(out.PresetItems), len(out.LogEntries), len(out.BodyWeights), len(out.DailyActivity))
	writeJSON(w, 200, out)
}

func (a *App) HandleImportData(w http.ResponseWriter, r *http.Request) {
	reqID := middleware.GetReqID(r.Context())
	queryUserID := r.URL.Query().Get("user_id")
	if queryUserID == "" {
		queryUserID = "00000000-0000-0000-0000-000000000001"
	}

	var req ExportBundle
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		log.Printf("[api-debug] req_id=%s import decode error: %v", reqID, err)
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

	rowsImported := 0
	now := time.Now().UTC()
	effectiveUserID := queryUserID
	if r.URL.Query().Get("user_id") == "" && req.UserID != "" {
		effectiveUserID = req.UserID
	}
	log.Printf("[api-debug] req_id=%s import start query_user_id=%s payload_user_id=%s effective_user_id=%s food_items=%d recipes=%d recipe_ingredients=%d recipe_portions=%d presets=%d preset_items=%d log_entries=%d body_weights=%d daily_activity=%d",
		reqID, queryUserID, req.UserID, effectiveUserID,
		len(req.FoodItems), len(req.Recipes), len(req.RecipeIngredients), len(req.RecipePortions),
		len(req.Presets), len(req.PresetItems), len(req.LogEntries), len(req.BodyWeights), len(req.DailyActivity))

	// Ensure the target user exists so FK inserts don't fail on a fresh DB.
	if _, err := tx.Exec(ctx, `
      INSERT INTO users (id, display_name)
      VALUES ($1, 'Imported User')
      ON CONFLICT (id) DO NOTHING;
    `, effectiveUserID); err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("ensure user: %v", err)})
		return
	}

	for _, it := range req.FoodItems {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		var foodUserID any
		if it.UserID != "" {
			foodUserID = effectiveUserID
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO food_items (
        id, user_id, name, brand, serving_label, source,
        calories_per_serving, protein_g_per_serving, carbs_g_per_serving, fat_g_per_serving, fiber_g_per_serving, created_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        brand = EXCLUDED.brand,
        serving_label = EXCLUDED.serving_label,
        source = EXCLUDED.source,
        calories_per_serving = EXCLUDED.calories_per_serving,
        protein_g_per_serving = EXCLUDED.protein_g_per_serving,
        carbs_g_per_serving = EXCLUDED.carbs_g_per_serving,
        fat_g_per_serving = EXCLUDED.fat_g_per_serving,
        fiber_g_per_serving = EXCLUDED.fiber_g_per_serving;
    `, it.ID, foodUserID, it.Name, it.Brand, it.ServingLabel, it.Source,
			it.CaloriesPerServing, it.ProteinPerServing, it.CarbsPerServing, it.FatPerServing, it.FiberPerServing, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import food_items: %v", err)})
			return
		}
		rowsImported++
	}

	for _, it := range req.Recipes {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO recipes (id, user_id, name, instructions, yield_count, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        instructions = EXCLUDED.instructions,
        yield_count = EXCLUDED.yield_count;
    `, it.ID, effectiveUserID, it.Name, it.Instructions, it.YieldCount, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import recipes: %v", err)})
			return
		}
		rowsImported++
	}

	for _, it := range req.RecipeIngredients {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO recipe_ingredients (id, recipe_id, food_item_id, amount_g, created_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET
        recipe_id = EXCLUDED.recipe_id,
        food_item_id = EXCLUDED.food_item_id,
        amount_g = EXCLUDED.amount_g;
    `, it.ID, it.RecipeID, it.FoodItemID, it.AmountG, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import recipe_ingredients: %v", err)})
			return
		}
		rowsImported++
	}

	for _, it := range req.RecipePortions {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO recipe_portions (id, recipe_id, name, portion_count, created_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET
        recipe_id = EXCLUDED.recipe_id,
        name = EXCLUDED.name,
        portion_count = EXCLUDED.portion_count;
    `, it.ID, it.RecipeID, it.Name, it.PortionCount, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import recipe_portions: %v", err)})
			return
		}
		rowsImported++
	}

	for _, it := range req.Presets {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO presets (id, user_id, name, pinned, created_at)
      VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        name = EXCLUDED.name,
        pinned = EXCLUDED.pinned;
    `, it.ID, effectiveUserID, it.Name, it.Pinned, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import presets: %v", err)})
			return
		}
		rowsImported++
	}

	for _, it := range req.PresetItems {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO preset_items (id, preset_id, kind, ref_id, servings, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET
        preset_id = EXCLUDED.preset_id,
        kind = EXCLUDED.kind,
        ref_id = EXCLUDED.ref_id,
        servings = EXCLUDED.servings;
    `, it.ID, it.PresetID, it.Kind, it.RefID, it.Servings, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import preset_items: %v", err)})
			return
		}
		rowsImported++
	}

	for _, it := range req.LogEntries {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		occurredAt := it.OccurredAt
		if occurredAt.IsZero() {
			occurredAt = now
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO log_entries (id, user_id, occurred_at, kind, ref_id, servings, meal, note, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        occurred_at = EXCLUDED.occurred_at,
        kind = EXCLUDED.kind,
        ref_id = EXCLUDED.ref_id,
        servings = EXCLUDED.servings,
        meal = EXCLUDED.meal,
        note = EXCLUDED.note;
    `, it.ID, effectiveUserID, occurredAt, it.Kind, it.RefID, it.Servings, it.Meal, it.Note, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import log_entries: %v", err)})
			return
		}
		rowsImported++
	}

	for _, it := range req.BodyWeights {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		measuredAt := it.MeasuredAt
		if measuredAt.IsZero() {
			measuredAt = now
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO body_weights (id, user_id, measured_at, weight_kg, source, note, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO UPDATE SET
        user_id = EXCLUDED.user_id,
        measured_at = EXCLUDED.measured_at,
        weight_kg = EXCLUDED.weight_kg,
        source = EXCLUDED.source,
        note = EXCLUDED.note;
    `, it.ID, effectiveUserID, measuredAt, it.WeightKg, it.Source, it.Note, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import body_weights: %v", err)})
			return
		}
		rowsImported++
	}

	for _, it := range req.DailyActivity {
		createdAt := it.CreatedAt
		if createdAt.IsZero() {
			createdAt = now
		}
		if _, err := time.Parse("2006-01-02", it.Date); err != nil {
			writeJSON(w, 400, map[string]any{"error": fmt.Sprintf("invalid activity date: %s", it.Date)})
			return
		}
		_, err := tx.Exec(ctx, `
      INSERT INTO daily_activity (user_id, date, steps, active_calories_kcal_est, source, created_at)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (user_id, date) DO UPDATE SET
        steps = EXCLUDED.steps,
        active_calories_kcal_est = EXCLUDED.active_calories_kcal_est,
        source = EXCLUDED.source;
    `, effectiveUserID, it.Date, it.Steps, it.ActiveKcalEst, it.Source, createdAt)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("import daily_activity: %v", err)})
			return
		}
		rowsImported++
	}

	if err := tx.Commit(ctx); err != nil {
		log.Printf("[api-debug] req_id=%s import tx commit error: %v", reqID, err)
		writeJSON(w, 500, map[string]any{"error": "tx commit"})
		return
	}
	log.Printf("[api-debug] req_id=%s import success imported_rows=%d", reqID, rowsImported)
	writeJSON(w, 200, map[string]any{"ok": true, "imported_rows": rowsImported})
}

// ── Markdown Export ───────────────────────────────────────────────────────────

func (a *App) HandleExportMarkdown(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	fromStr := r.URL.Query().Get("from")
	toStr := r.URL.Query().Get("to")
	if fromStr == "" || toStr == "" {
		writeJSON(w, 400, map[string]any{"error": "from and to required (YYYY-MM-DD)"})
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
	if to.Before(from) {
		writeJSON(w, 400, map[string]any{"error": "to must be >= from"})
		return
	}

	ctx := r.Context()

	// Fetch all log entries in range in one query, ordered by day + meal + time
	type mdEntry struct {
		Date     string
		Meal     string
		FoodName string
		Servings float64
		Kcal     float64
		ProteinG float64
		CarbsG   float64
		FatG     float64
		FiberG   float64
	}
	rangeEnd := to.Add(24 * time.Hour)
	logRows, err := a.DB.Query(ctx, `
		SELECT DATE(le.occurred_at AT TIME ZONE $4) AS day,
		       le.meal, fi.name, le.servings,
		       le.servings * fi.calories_per_serving,
		       le.servings * fi.protein_g_per_serving,
		       le.servings * fi.carbs_g_per_serving,
		       le.servings * fi.fat_g_per_serving,
		       le.servings * fi.fiber_g_per_serving
		FROM log_entries le
		JOIN food_items fi ON fi.id = le.ref_id
		WHERE le.user_id = $1 AND le.kind = 'food'
		  AND le.occurred_at >= $2 AND le.occurred_at < $3
		ORDER BY day, le.meal, le.occurred_at
	`, userID, from, rangeEnd, a.Loc.String())
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query log: %v", err)})
		return
	}
	defer logRows.Close()

	entriesByDay := map[string][]mdEntry{}
	for logRows.Next() {
		var e mdEntry
		var day time.Time
		if err := logRows.Scan(&day, &e.Meal, &e.FoodName, &e.Servings,
			&e.Kcal, &e.ProteinG, &e.CarbsG, &e.FatG, &e.FiberG); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan log"})
			return
		}
		e.Date = day.Format("2006-01-02")
		entriesByDay[e.Date] = append(entriesByDay[e.Date], e)
	}
	logRows.Close()

	// Fetch body weights in range
	type mdWeight struct {
		Date     string
		WeightKg float64
	}
	weightByDay := map[string]mdWeight{}
	wRows, err := a.DB.Query(ctx, `
		SELECT DATE(measured_at AT TIME ZONE $4), AVG(weight_kg)
		FROM body_weights
		WHERE user_id = $1 AND measured_at >= $2 AND measured_at < $3
		GROUP BY 1 ORDER BY 1
	`, userID, from, rangeEnd, a.Loc.String())
	if err == nil {
		defer wRows.Close()
		for wRows.Next() {
			var d time.Time
			var kg float64
			if wRows.Scan(&d, &kg) == nil {
				weightByDay[d.Format("2006-01-02")] = mdWeight{Date: d.Format("2006-01-02"), WeightKg: kg}
			}
		}
		wRows.Close()
	}

	// Fetch activity in range
	type mdActivity struct {
		Steps      int
		ActiveKcal float64
	}
	activityByDay := map[string]mdActivity{}
	aRows, err := a.DB.Query(ctx, `
		SELECT date, steps, active_calories_kcal_est
		FROM daily_activity
		WHERE user_id = $1 AND date >= $2 AND date <= $3
		ORDER BY date
	`, userID, fromStr, toStr)
	if err == nil {
		defer aRows.Close()
		for aRows.Next() {
			var d time.Time
			var act mdActivity
			if aRows.Scan(&d, &act.Steps, &act.ActiveKcal) == nil {
				activityByDay[d.Format("2006-01-02")] = act
			}
		}
		aRows.Close()
	}

	// Build zip in memory
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)

	for cur := from; !cur.After(to); cur = cur.Add(24 * time.Hour) {
		dateStr := cur.Format("2006-01-02")
		entries := entriesByDay[dateStr]
		weight := weightByDay[dateStr]
		activity := activityByDay[dateStr]

		var sb strings.Builder
		sb.WriteString("# " + dateStr + "\n\n")

		// Summary totals
		var totalKcal, totalProtein, totalCarbs, totalFat, totalFiber float64
		for _, e := range entries {
			totalKcal += e.Kcal
			totalProtein += e.ProteinG
			totalCarbs += e.CarbsG
			totalFat += e.FatG
			totalFiber += e.FiberG
		}

		sb.WriteString("## Summary\n\n")
		sb.WriteString(fmt.Sprintf("| | |\n|---|---|\n"))
		sb.WriteString(fmt.Sprintf("| Calories | %.0f kcal |\n", totalKcal))
		sb.WriteString(fmt.Sprintf("| Protein | %.1f g |\n", totalProtein))
		sb.WriteString(fmt.Sprintf("| Carbs | %.1f g |\n", totalCarbs))
		sb.WriteString(fmt.Sprintf("| Fat | %.1f g |\n", totalFat))
		sb.WriteString(fmt.Sprintf("| Fiber | %.1f g |\n", totalFiber))
		if weight.WeightKg > 0 {
			sb.WriteString(fmt.Sprintf("| Weight | %.2f kg |\n", weight.WeightKg))
		}
		if activity.Steps > 0 {
			sb.WriteString(fmt.Sprintf("| Steps | %d |\n", activity.Steps))
		}
		if activity.ActiveKcal > 0 {
			sb.WriteString(fmt.Sprintf("| Active kcal | %.0f |\n", activity.ActiveKcal))
		}
		sb.WriteString("\n")

		// Food log grouped by meal
		if len(entries) > 0 {
			sb.WriteString("## Food Log\n\n")
			currentMeal := ""
			var mealKcal, mealProtein float64
			mealEntries := []mdEntry{}

			flushMeal := func() {
				if currentMeal == "" {
					return
				}
				sb.WriteString("### " + strings.Title(strings.ReplaceAll(currentMeal, "_", " ")) + "\n\n")
				sb.WriteString("| Food | Servings | kcal | Protein | Carbs | Fat |\n")
				sb.WriteString("|---|---|---|---|---|---|\n")
				for _, me := range mealEntries {
					sb.WriteString(fmt.Sprintf("| %s | %.2g | %.0f | %.1fg | %.1fg | %.1fg |\n",
						me.FoodName, me.Servings, me.Kcal, me.ProteinG, me.CarbsG, me.FatG))
				}
				sb.WriteString(fmt.Sprintf("\n**Meal total:** %.0f kcal · %.1fg protein\n\n", mealKcal, mealProtein))
			}

			for _, e := range entries {
				if e.Meal != currentMeal {
					flushMeal()
					currentMeal = e.Meal
					mealKcal = 0
					mealProtein = 0
					mealEntries = nil
				}
				mealKcal += e.Kcal
				mealProtein += e.ProteinG
				mealEntries = append(mealEntries, e)
			}
			flushMeal()
		} else {
			sb.WriteString("_No food logged._\n\n")
		}

		f, err := zw.Create(dateStr + ".md")
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": "zip create"})
			return
		}
		if _, err := f.Write([]byte(sb.String())); err != nil {
			writeJSON(w, 500, map[string]any{"error": "zip write"})
			return
		}
	}

	if err := zw.Close(); err != nil {
		writeJSON(w, 500, map[string]any{"error": "zip close"})
		return
	}

	filename := fmt.Sprintf("intake-md-%s-to-%s.zip", fromStr, toStr)
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
	w.WriteHeader(200)
	_, _ = w.Write(buf.Bytes())
}

// ── Shopping Items ────────────────────────────────────────────────────────────

type ShoppingItem struct {
	ID        string  `json:"id"`
	RecipeID  string  `json:"recipe_id"`
	Name      string  `json:"name"`
	Amount    float64 `json:"amount"`
	Unit      string  `json:"unit"`
	SortOrder int     `json:"sort_order"`
}

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
}

func (a *App) HandleListPantry(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	rows, err := a.DB.Query(r.Context(), `
		SELECT fi.id, fi.name, COALESCE(fi.brand,''), COALESCE(fi.serving_label,'1 serving'),
		       fi.calories_per_serving, fi.protein_g_per_serving, fi.carbs_g_per_serving, fi.fat_g_per_serving,
		       p.quantity, p.updated_at
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
		if err := rows.Scan(&it.FoodItemID, &it.FoodName, &it.Brand, &it.ServingLabel,
			&it.CaloriesPerServing, &it.ProteinGPerServing, &it.CarbsGPerServing, &it.FatGPerServing,
			&it.Quantity, &updatedAt); err != nil {
			writeJSON(w, 500, map[string]any{"error": "scan pantry"})
			return
		}
		if t, ok := updatedAt.(interface{ Format(string) string }); ok {
			it.UpdatedAt = t.Format(time.RFC3339)
		}
		items = append(items, it)
	}
	writeJSON(w, 200, items)
}

func (a *App) HandleUpsertPantry(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	foodItemID := chi.URLParam(r, "food_item_id")
	var req struct {
		Quantity float64 `json:"quantity"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	_, err := a.DB.Exec(r.Context(), `
		INSERT INTO pantry_items (user_id, food_item_id, quantity, updated_at)
		VALUES ($1, $2, $3, now())
		ON CONFLICT (user_id, food_item_id)
		DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = now()
	`, userID, foodItemID, req.Quantity)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert pantry: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeletePantry(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
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
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
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
