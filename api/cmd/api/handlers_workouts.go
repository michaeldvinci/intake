package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

// ── helpers ───────────────────────────────────────────────────────────────────

func parseDays(s string) []int {
	if s == "" {
		return []int{}
	}
	parts := strings.Split(s, ",")
	days := make([]int, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.Atoi(strings.TrimSpace(p))
		if err == nil {
			days = append(days, n)
		}
	}
	return days
}

func encodeDays(days []int) string {
	strs := make([]string, len(days))
	for i, d := range days {
		strs[i] = strconv.Itoa(d)
	}
	return strings.Join(strs, ",")
}

// ── Programs ──────────────────────────────────────────────────────────────────

type WorkoutExercise struct {
	ID        string `json:"id"`
	ProgramID string `json:"program_id"`
	Name      string `json:"name"`
	Sets      int    `json:"sets"`
	RepsMin   int    `json:"reps_min"`
	RepsMax   int    `json:"reps_max"`
	SortOrder int    `json:"sort_order"`
}

type WorkoutProgram struct {
	ID        string            `json:"id"`
	Name      string            `json:"name"`
	Days      []int             `json:"days"`
	Exercises []WorkoutExercise `json:"exercises"`
	CreatedAt string            `json:"created_at"`
}

func (a *App) HandleListWorkoutPrograms(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}

	rows, err := a.DB.Query(r.Context(),
		`SELECT id, name, days, created_at FROM workout_programs WHERE user_id=$1 ORDER BY created_at`,
		userID,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query: %v", err)})
		return
	}
	defer rows.Close()

	programs := []WorkoutProgram{}
	for rows.Next() {
		var p WorkoutProgram
		var daysStr string
		var ts time.Time
		if err := rows.Scan(&p.ID, &p.Name, &daysStr, &ts); err != nil {
			continue
		}
		p.Days = parseDays(daysStr)
		p.CreatedAt = ts.Format(time.RFC3339)
		p.Exercises = []WorkoutExercise{}
		programs = append(programs, p)
	}
	rows.Close()

	for i, prog := range programs {
		exRows, err := a.DB.Query(r.Context(),
			`SELECT id, name, sets, reps_min, reps_max, sort_order
			 FROM workout_program_exercises WHERE program_id=$1
			 ORDER BY sort_order, created_at`,
			prog.ID,
		)
		if err != nil {
			continue
		}
		for exRows.Next() {
			var ex WorkoutExercise
			ex.ProgramID = prog.ID
			if err := exRows.Scan(&ex.ID, &ex.Name, &ex.Sets, &ex.RepsMin, &ex.RepsMax, &ex.SortOrder); err != nil {
				continue
			}
			programs[i].Exercises = append(programs[i].Exercises, ex)
		}
		exRows.Close()
	}

	writeJSON(w, 200, programs)
}

type CreateProgramRequest struct {
	UserID string `json:"user_id"`
	Name   string `json:"name"`
	Days   []int  `json:"days"`
}

func (a *App) HandleCreateWorkoutProgram(w http.ResponseWriter, r *http.Request) {
	var req CreateProgramRequest
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

	var id string
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO workout_programs (user_id, name, days) VALUES ($1,$2,$3) RETURNING id`,
		req.UserID, req.Name, encodeDays(req.Days),
	).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"id": id})
}

func (a *App) HandleUpdateWorkoutProgram(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req CreateProgramRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}

	_, err := a.DB.Exec(r.Context(),
		`UPDATE workout_programs SET name=$1, days=$2 WHERE id=$3 AND user_id=$4`,
		req.Name, encodeDays(req.Days), id, req.UserID,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("update: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleDeleteWorkoutProgram(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}

	ct, err := a.DB.Exec(r.Context(),
		`DELETE FROM workout_programs WHERE id=$1 AND user_id=$2`, id, userID,
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

// ── Exercises ─────────────────────────────────────────────────────────────────

type CreateExerciseRequest struct {
	Name      string `json:"name"`
	Sets      int    `json:"sets"`
	RepsMin   int    `json:"reps_min"`
	RepsMax   int    `json:"reps_max"`
	SortOrder int    `json:"sort_order"`
}

func (a *App) HandleCreateExercise(w http.ResponseWriter, r *http.Request) {
	programID := chi.URLParam(r, "id")
	var req CreateExerciseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.Name == "" {
		writeJSON(w, 400, map[string]any{"error": "name required"})
		return
	}
	if req.Sets <= 0 {
		req.Sets = 3
	}

	var id string
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO workout_program_exercises (program_id, name, sets, reps_min, reps_max, sort_order)
		 VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
		programID, req.Name, req.Sets, req.RepsMin, req.RepsMax, req.SortOrder,
	).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("insert: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"id": id})
}

func (a *App) HandleDeleteExercise(w http.ResponseWriter, r *http.Request) {
	exerciseID := chi.URLParam(r, "exercise_id")
	_, err := a.DB.Exec(r.Context(),
		`DELETE FROM workout_program_exercises WHERE id=$1`, exerciseID,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("delete: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// ── Sessions ──────────────────────────────────────────────────────────────────

type SessionSet struct {
	SetNumber  int      `json:"set_number"`
	WeightKg   *float64 `json:"weight_kg"`
	RepsActual *int     `json:"reps_actual"`
	Completed  bool     `json:"completed"`
}

type SessionExercise struct {
	WorkoutExercise
	LoggedSets []SessionSet `json:"logged_sets"`
}

type WorkoutSessionDay struct {
	SessionID   *string           `json:"session_id"`
	ProgramID   string            `json:"program_id"`
	ProgramName string            `json:"program_name"`
	Exercises   []SessionExercise `json:"exercises"`
}

func (a *App) HandleGetWorkoutSessionsForDate(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		userID = DefaultUserID
	}
	dateStr := r.URL.Query().Get("date")
	if dateStr == "" {
		dateStr = a.now().Format("2006-01-02")
	}
	date, err := time.Parse("2006-01-02", dateStr)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "date must be YYYY-MM-DD"})
		return
	}
	dow := int(date.Weekday()) // 0=Sun ... 6=Sat

	rows, err := a.DB.Query(r.Context(),
		`SELECT id, name, days FROM workout_programs WHERE user_id=$1`, userID,
	)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("query programs: %v", err)})
		return
	}
	defer rows.Close()

	type prog struct {
		id   string
		name string
		days []int
	}
	var scheduled []prog
	for rows.Next() {
		var p prog
		var daysStr string
		if err := rows.Scan(&p.id, &p.name, &daysStr); err != nil {
			continue
		}
		p.days = parseDays(daysStr)
		for _, d := range p.days {
			if d == dow {
				scheduled = append(scheduled, p)
				break
			}
		}
	}
	rows.Close()

	result := []WorkoutSessionDay{}
	for _, p := range scheduled {
		sd := WorkoutSessionDay{ProgramID: p.id, ProgramName: p.name}

		// Check for existing session
		var sessionID string
		serr := a.DB.QueryRow(r.Context(),
			`SELECT id FROM workout_sessions WHERE user_id=$1 AND program_id=$2 AND date=$3`,
			userID, p.id, date,
		).Scan(&sessionID)
		if serr == nil {
			sd.SessionID = &sessionID
		}

		// Get exercises
		exRows, err := a.DB.Query(r.Context(),
			`SELECT id, name, sets, reps_min, reps_max, sort_order
			 FROM workout_program_exercises WHERE program_id=$1
			 ORDER BY sort_order, created_at`,
			p.id,
		)
		if err != nil {
			sd.Exercises = []SessionExercise{}
			result = append(result, sd)
			continue
		}
		for exRows.Next() {
			var ex SessionExercise
			ex.ProgramID = p.id
			if err := exRows.Scan(&ex.ID, &ex.Name, &ex.Sets, &ex.RepsMin, &ex.RepsMax, &ex.SortOrder); err != nil {
				continue
			}

			// Build placeholder sets
			loggedSets := make([]SessionSet, ex.Sets)
			for i := range loggedSets {
				loggedSets[i] = SessionSet{SetNumber: i + 1}
			}

			// Fill in actual logged sets
			if sd.SessionID != nil {
				setRows, err := a.DB.Query(r.Context(),
					`SELECT set_number, weight_kg, reps_actual, completed
					 FROM workout_session_sets WHERE session_id=$1 AND exercise_id=$2
					 ORDER BY set_number`,
					*sd.SessionID, ex.ID,
				)
				if err == nil {
					for setRows.Next() {
						var s SessionSet
						if err := setRows.Scan(&s.SetNumber, &s.WeightKg, &s.RepsActual, &s.Completed); err != nil {
							continue
						}
						idx := s.SetNumber - 1
						if idx >= 0 && idx < len(loggedSets) {
							loggedSets[idx] = s
						}
					}
					setRows.Close()
				}
			}

			ex.LoggedSets = loggedSets
			sd.Exercises = append(sd.Exercises, ex)
		}
		exRows.Close()

		if sd.Exercises == nil {
			sd.Exercises = []SessionExercise{}
		}
		result = append(result, sd)
	}

	sort.Slice(result, func(i, j int) bool { return result[i].ProgramName < result[j].ProgramName })
	writeJSON(w, 200, result)
}

type CreateSessionRequest struct {
	UserID    string `json:"user_id"`
	ProgramID string `json:"program_id"`
	Date      string `json:"date"`
}

func (a *App) HandleCreateWorkoutSession(w http.ResponseWriter, r *http.Request) {
	var req CreateSessionRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.UserID == "" {
		req.UserID = DefaultUserID
	}
	if req.ProgramID == "" || req.Date == "" {
		writeJSON(w, 400, map[string]any{"error": "program_id and date required"})
		return
	}
	date, err := time.Parse("2006-01-02", req.Date)
	if err != nil {
		writeJSON(w, 400, map[string]any{"error": "date must be YYYY-MM-DD"})
		return
	}

	var id string
	err = a.DB.QueryRow(r.Context(),
		`INSERT INTO workout_sessions (user_id, program_id, date) VALUES ($1,$2,$3)
		 ON CONFLICT (user_id, program_id, date) DO UPDATE SET date=EXCLUDED.date
		 RETURNING id`,
		req.UserID, req.ProgramID, date,
	).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert session: %v", err)})
		return
	}
	writeJSON(w, 201, map[string]any{"id": id})
}

// ── Session Sets ──────────────────────────────────────────────────────────────

type UpsertSetRequest struct {
	SessionID  string   `json:"session_id"`
	ExerciseID string   `json:"exercise_id"`
	SetNumber  int      `json:"set_number"`
	WeightKg   *float64 `json:"weight_kg"`
	RepsActual *int     `json:"reps_actual"`
	Completed  bool     `json:"completed"`
}

func (a *App) HandleUpsertSessionSet(w http.ResponseWriter, r *http.Request) {
	var req UpsertSetRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.SessionID == "" || req.ExerciseID == "" || req.SetNumber <= 0 {
		writeJSON(w, 400, map[string]any{"error": "session_id, exercise_id, set_number required"})
		return
	}

	var id string
	err := a.DB.QueryRow(r.Context(),
		`INSERT INTO workout_session_sets (session_id, exercise_id, set_number, weight_kg, reps_actual, completed)
		 VALUES ($1,$2,$3,$4,$5,$6)
		 ON CONFLICT (session_id, exercise_id, set_number) DO UPDATE SET
		   weight_kg   = EXCLUDED.weight_kg,
		   reps_actual = EXCLUDED.reps_actual,
		   completed   = EXCLUDED.completed
		 RETURNING id`,
		req.SessionID, req.ExerciseID, req.SetNumber, req.WeightKg, req.RepsActual, req.Completed,
	).Scan(&id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": fmt.Sprintf("upsert set: %v", err)})
		return
	}
	writeJSON(w, 200, map[string]any{"id": id})
}
