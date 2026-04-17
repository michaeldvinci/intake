package main

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/go-co-op/gocron/v2"
	"github.com/jackc/pgx/v5/pgxpool"
)

//go:embed schema.sql
var schemaSQL string

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

	if _, err := db.Exec(ctx, schemaSQL); err != nil {
		log.Fatalf("migrate: %v", err)
	}
	log.Println("schema applied")

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
	r.Get("/activity/water", app.HandleGetWater)
	r.Post("/activity/water", app.HandleSetWater)
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
	r.Get("/ingredient-categories", app.HandleListIngredientCategories)
	r.Put("/ingredient-categories", app.HandleReplaceIngredientCategories)
	r.Put("/ingredient-categories/set", app.HandleSetIngredientCategoryBody)
	r.Put("/ingredient-categories/{name}", app.HandleSetIngredientCategory)
	r.Delete("/ingredient-categories/{name}", app.HandleDeleteIngredientCategory)
	r.Get("/settings", app.HandleGetSettings)
	r.Put("/settings", app.HandlePutSetting)
	r.Post("/ai-review/run", app.HandleTriggerAIReview)
	r.Get("/ai-review/last", app.HandleGetLastAIReview)
	r.Get("/nudges", app.HandleListNudges)
	r.Post("/nudges", app.HandleCreateNudge)
	r.Put("/nudges/{id}", app.HandleUpdateNudge)
	r.Delete("/nudges/{id}", app.HandleDeleteNudge)
	r.Post("/nudges/{id}/test", app.HandleTestNudge)
	r.Get("/meal-plan", app.HandleListMealPlan)
	r.Post("/meal-plan", app.HandleAddMealPlanEntry)
	r.Delete("/meal-plan/{id}", app.HandleDeleteMealPlanEntry)
	r.Get("/meal-plan/export.ics", app.HandleExportMealPlanICS)

	r.Get("/workout-programs", app.HandleListWorkoutPrograms)
	r.Post("/workout-programs", app.HandleCreateWorkoutProgram)
	r.Put("/workout-programs/{id}", app.HandleUpdateWorkoutProgram)
	r.Delete("/workout-programs/{id}", app.HandleDeleteWorkoutProgram)
	r.Post("/workout-programs/{id}/exercises", app.HandleCreateExercise)
	r.Delete("/workout-programs/{id}/exercises/{exercise_id}", app.HandleDeleteExercise)
	r.Get("/workout-sessions/day", app.HandleGetWorkoutSessionsForDate)
	r.Post("/workout-sessions", app.HandleCreateWorkoutSession)
	r.Put("/workout-session-sets", app.HandleUpsertSessionSet)
	r.Get("/data/export", app.HandleExportData)
	r.Get("/data/export/markdown", app.HandleExportMarkdown)
	r.Post("/data/import", app.HandleImportData)

	s, err := gocron.NewScheduler(gocron.WithLocation(loc))
	if err != nil {
		log.Printf("scheduler init failed: %v", err)
	} else {
		_, _ = s.NewJob(gocron.DurationJob(1*time.Minute), gocron.NewTask(app.checkNudges))
		_, _ = s.NewJob(gocron.DailyJob(1, gocron.NewAtTimes(gocron.NewAtTime(8, 0, 0))), gocron.NewTask(app.checkPantryExpirations))
		_, _ = s.NewJob(gocron.DurationJob(1*time.Minute), gocron.NewTask(app.checkAIReviews))
		s.Start()
		log.Println("scheduler started (nudges: 1-min, pantry expiry: daily 8am, ai-review: 1-min)")
	}

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
