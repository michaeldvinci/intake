package main

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"

	"golang.org/x/crypto/bcrypt"
)

// ── Auth handlers ─────────────────────────────────────────────────────────────

type registerRequest struct {
	Email       string `json:"email"`
	Password    string `json:"password"`
	DisplayName string `json:"display_name"`
}

func (a *App) HandleRegister(w http.ResponseWriter, r *http.Request) {
	var req registerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	if req.Email == "" || req.Password == "" {
		writeJSON(w, 400, map[string]any{"error": "email and password required"})
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "hash error"})
		return
	}
	var id, email, displayName string
	err = a.DB.QueryRow(r.Context(),
		// If the email exists but has no password yet (legacy seed user), allow claiming it.
		`INSERT INTO users (email, display_name, password_hash) VALUES ($1,$2,$3)
		 ON CONFLICT (email) DO UPDATE
		   SET password_hash = EXCLUDED.password_hash,
		       display_name  = CASE WHEN users.display_name IS NULL OR users.display_name = ''
		                            THEN EXCLUDED.display_name ELSE users.display_name END
		   WHERE users.password_hash IS NULL OR users.password_hash = ''
		 RETURNING id, email, COALESCE(display_name,'')`,
		req.Email, req.DisplayName, string(hash),
	).Scan(&id, &email, &displayName)
	if err != nil {
		writeJSON(w, 409, map[string]any{"error": "email already registered"})
		return
	}
	tok, err := a.signToken(id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "token error"})
		return
	}
	setSessionCookie(w, tok)
	writeJSON(w, 201, map[string]any{"id": id, "email": email, "display_name": displayName})
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

func (a *App) HandleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]any{"error": "invalid json"})
		return
	}
	var id, hash, displayName string
	err := a.DB.QueryRow(r.Context(),
		`SELECT id, COALESCE(password_hash,''), COALESCE(display_name,'') FROM users WHERE email=$1`,
		req.Email,
	).Scan(&id, &hash, &displayName)
	if err != nil || hash == "" {
		writeJSON(w, 401, map[string]any{"error": "invalid credentials"})
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		writeJSON(w, 401, map[string]any{"error": "invalid credentials"})
		return
	}
	tok, err := a.signToken(id)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "token error"})
		return
	}
	setSessionCookie(w, tok)
	writeJSON(w, 200, map[string]any{"id": id, "email": req.Email, "display_name": displayName})
}

func (a *App) HandleLogout(w http.ResponseWriter, r *http.Request) {
	clearSessionCookie(w)
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (a *App) HandleClaimLocalData(w http.ResponseWriter, r *http.Request) {
	const localID = "00000000-0000-0000-0000-000000000001"
	userID := userIDFromContext(r.Context())
	if userID == localID {
		writeJSON(w, 400, map[string]any{"error": "already the local user"})
		return
	}

	tx, err := a.DB.Begin(r.Context())
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "tx error"})
		return
	}
	defer tx.Rollback(r.Context())

	var total int64

	// Tables with no compound unique constraint on user_id — safe to UPDATE directly.
	for _, t := range []string{
		"food_items", "recipes", "presets", "log_entries",
		"body_weights", "workout_programs", "meal_plan_entries",
	} {
		tag, err := tx.Exec(r.Context(),
			fmt.Sprintf("UPDATE %s SET user_id=$1 WHERE user_id=$2", t),
			userID, localID)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": "migrate error: " + t})
			return
		}
		total += tag.RowsAffected()
	}

	// Tables with UNIQUE(user_id, X) — drop any local rows that would conflict with
	// rows the target user already owns, then move the rest.
	type conflictTable struct {
		table string
		col   string
	}
	for _, ct := range []conflictTable{
		{"daily_activity", "date"},
		{"pantry_items", "food_item_id"},
		{"ingredient_categories", "ingredient_name"},
		{"nudges", "food_item_id"},
		{"user_settings", "key"},
	} {
		if _, err := tx.Exec(r.Context(), fmt.Sprintf(
			`DELETE FROM %s WHERE user_id=$1 AND %s IN
			 (SELECT %s FROM %s WHERE user_id=$2)`,
			ct.table, ct.col, ct.col, ct.table,
		), localID, userID); err != nil {
			writeJSON(w, 500, map[string]any{"error": "migrate error: " + ct.table})
			return
		}
		tag, err := tx.Exec(r.Context(),
			fmt.Sprintf("UPDATE %s SET user_id=$1 WHERE user_id=$2", ct.table),
			userID, localID)
		if err != nil {
			writeJSON(w, 500, map[string]any{"error": "migrate error: " + ct.table})
			return
		}
		total += tag.RowsAffected()
	}

	// workout_sessions has UNIQUE(user_id, program_id, date) — two-column conflict check.
	if _, err := tx.Exec(r.Context(), `
		DELETE FROM workout_sessions WHERE user_id=$1
		  AND (program_id, date) IN
		      (SELECT program_id, date FROM workout_sessions WHERE user_id=$2)`,
		localID, userID); err != nil {
		writeJSON(w, 500, map[string]any{"error": "migrate error: workout_sessions"})
		return
	}
	if tag, err := tx.Exec(r.Context(),
		"UPDATE workout_sessions SET user_id=$1 WHERE user_id=$2", userID, localID); err != nil {
		writeJSON(w, 500, map[string]any{"error": "migrate error: workout_sessions"})
		return
	} else {
		total += tag.RowsAffected()
	}

	if err := tx.Commit(r.Context()); err != nil {
		writeJSON(w, 500, map[string]any{"error": "commit error"})
		return
	}

	writeJSON(w, 200, map[string]any{"migrated_rows": total})
}

func (a *App) HandleGetAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())
	var key string
	err := a.DB.QueryRow(r.Context(),
		`SELECT value FROM user_settings WHERE user_id=$1 AND key='api_key'`,
		userID,
	).Scan(&key)
	if err != nil {
		writeJSON(w, 200, map[string]any{"api_key": ""})
		return
	}
	writeJSON(w, 200, map[string]any{"api_key": key})
}

func (a *App) HandleGenerateAPIKey(w http.ResponseWriter, r *http.Request) {
	userID := userIDFromContext(r.Context())
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		writeJSON(w, 500, map[string]any{"error": "random error"})
		return
	}
	key := "itak_" + hex.EncodeToString(b)
	_, err := a.DB.Exec(r.Context(), `
		INSERT INTO user_settings (user_id, key, value)
		VALUES ($1, 'api_key', $2)
		ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
	`, userID, key)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "save error"})
		return
	}
	writeJSON(w, 200, map[string]any{"api_key": key})
}

func (a *App) HandleMe(w http.ResponseWriter, r *http.Request) {
	const localID = "00000000-0000-0000-0000-000000000001"
	userID := userIDFromContext(r.Context())
	var email, displayName string
	var isFirstUser bool
	err := a.DB.QueryRow(r.Context(),
		`SELECT COALESCE(email,''), COALESCE(display_name,''),
		 (SELECT id FROM users WHERE id != $2 ORDER BY created_at ASC LIMIT 1) = $1
		 FROM users WHERE id=$1`,
		userID, localID,
	).Scan(&email, &displayName, &isFirstUser)
	if err != nil {
		writeJSON(w, 404, map[string]any{"error": "user not found"})
		return
	}
	writeJSON(w, 200, map[string]any{"id": userID, "email": email, "display_name": displayName, "is_first_user": isFirstUser})
}
