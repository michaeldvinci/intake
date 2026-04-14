package main

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"

	"github.com/go-chi/chi/v5/middleware"
	"strings"
	"time"
)

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
	WaterGlasses  int       `json:"water_glasses"`
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
    SELECT user_id::text, date, steps, active_calories_kcal_est, COALESCE(water_glasses, 0), source, created_at
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
		if err := activityRows.Scan(&it.UserID, &dateVal, &it.Steps, &it.ActiveKcalEst, &it.WaterGlasses, &it.Source, &it.CreatedAt); err != nil {
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

