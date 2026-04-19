package main

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

type ctxKey string

const ctxKeyUserID ctxKey = "user_id"

func userIDFromContext(ctx context.Context) string {
	v, _ := ctx.Value(ctxKeyUserID).(string)
	return v
}

// ── JWT (HS256, stdlib only) ──────────────────────────────────────────────────

type jwtClaims struct {
	Sub string `json:"sub"`
	Exp int64  `json:"exp"`
}

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

var jwtHeader = b64url([]byte(`{"alg":"HS256","typ":"JWT"}`))

func (a *App) signToken(userID string) (string, error) {
	payload, err := json.Marshal(jwtClaims{Sub: userID, Exp: time.Now().Add(30 * 24 * time.Hour).Unix()})
	if err != nil {
		return "", err
	}
	body := jwtHeader + "." + b64url(payload)
	mac := hmac.New(sha256.New, a.JWTSecret)
	mac.Write([]byte(body))
	return body + "." + b64url(mac.Sum(nil)), nil
}

func (a *App) validateToken(tok string) (string, error) {
	parts := strings.Split(tok, ".")
	if len(parts) != 3 {
		return "", fmt.Errorf("malformed token")
	}
	mac := hmac.New(sha256.New, a.JWTSecret)
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal([]byte(parts[2]), []byte(b64url(mac.Sum(nil)))) {
		return "", fmt.Errorf("bad signature")
	}
	raw, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return "", fmt.Errorf("bad payload")
	}
	var claims jwtClaims
	if err := json.Unmarshal(raw, &claims); err != nil {
		return "", fmt.Errorf("bad claims")
	}
	if time.Now().Unix() > claims.Exp {
		return "", fmt.Errorf("expired")
	}
	return claims.Sub, nil
}

func tokenFromRequest(r *http.Request) string {
	if c, err := r.Cookie("intake_session"); err == nil {
		return c.Value
	}
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	return ""
}

// ── Middleware ────────────────────────────────────────────────────────────────

func (a *App) RequireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		tok := tokenFromRequest(r)
		// Try JWT first.
		if userID, err := a.validateToken(tok); err == nil {
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKeyUserID, userID)))
			return
		}
		// Fall back to API key (itak_ prefix).
		if strings.HasPrefix(tok, "itak_") {
			var userID string
			err := a.DB.QueryRow(r.Context(),
				`SELECT user_id FROM user_settings WHERE key='api_key' AND value=$1`,
				tok,
			).Scan(&userID)
			if err == nil {
				next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKeyUserID, userID)))
				return
			}
		}
		writeJSON(w, 401, map[string]any{"error": "unauthorized"})
	})
}

// ── Cookie helpers ────────────────────────────────────────────────────────────

func setSessionCookie(w http.ResponseWriter, token string) {
	http.SetCookie(w, &http.Cookie{
		Name:     "intake_session",
		Value:    token,
		Path:     "/",
		MaxAge:   30 * 24 * 60 * 60,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}

func clearSessionCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name:     "intake_session",
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		SameSite: http.SameSiteLaxMode,
	})
}
