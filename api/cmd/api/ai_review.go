package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"strings"
	"time"
)

func (a *App) checkAIReviews() {
	now := a.now()
	today := now.Format("2006-01-02")
	currentTime := fmt.Sprintf("%02d:%02d", now.Hour(), now.Minute())

	rows, err := a.DB.Query(context.Background(), `
		SELECT
			user_id,
			MAX(CASE WHEN key = 'ai_provider'          THEN value ELSE 'claude' END),
			MAX(CASE WHEN key = 'ai_api_key'            THEN value ELSE ''       END),
			MAX(CASE WHEN key = 'ai_review_time'        THEN value ELSE ''       END),
			MAX(CASE WHEN key = 'ai_last_review_date'   THEN value ELSE ''       END),
			MAX(CASE WHEN key = 'pantry_expiration_webhook' THEN value ELSE ''   END)
		FROM user_settings
		WHERE key IN ('ai_provider','ai_api_key','ai_review_time','ai_last_review_date','pantry_expiration_webhook')
		GROUP BY user_id
		HAVING MAX(CASE WHEN key = 'ai_api_key' THEN value END) IS NOT NULL
		   AND MAX(CASE WHEN key = 'ai_api_key' THEN value END) != ''
		   AND MAX(CASE WHEN key = 'ai_review_time' THEN value END) IS NOT NULL
		   AND MAX(CASE WHEN key = 'ai_review_time' THEN value END) != ''
	`)
	if err != nil {
		log.Printf("[ai-review] settings query error: %v", err)
		return
	}
	defer rows.Close()

	type userRow struct{ userID, provider, apiKey, reviewTime, lastDate, webhook string }
	var users []userRow
	for rows.Next() {
		var u userRow
		if err := rows.Scan(&u.userID, &u.provider, &u.apiKey, &u.reviewTime, &u.lastDate, &u.webhook); err != nil {
			continue
		}
		users = append(users, u)
	}

	for _, u := range users {
		if u.reviewTime > currentTime { continue }
		if u.lastDate == today { continue }

		log.Printf("[ai-review] running for user %s", u.userID)
		text, err := a.runAIReview(u.userID, u.provider, u.apiKey, today, "")
		if err != nil {
			log.Printf("[ai-review] error for user %s: %v", u.userID, err)
			continue
		}

		resultJSON, _ := json.Marshal(map[string]string{
			"date": today, "provider": u.provider,
			"runAt": time.Now().UTC().Format(time.RFC3339), "text": text,
		})
		for _, kv := range [][2]string{
			{"ai_last_review_date", today},
			{"ai_last_review_result", string(resultJSON)},
		} {
			a.DB.Exec(context.Background(), `
				INSERT INTO user_settings (user_id, key, value) VALUES ($1,$2,$3)
				ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
			`, u.userID, kv[0], kv[1])
		}

		if u.webhook != "" {
			msg := fmt.Sprintf("**Intake AI Review — %s**\n\n%s", today, text)
			if err := fireWebhook(u.webhook, msg); err != nil {
				log.Printf("[ai-review] webhook error: %v", err)
			}
		}
	}
}

func (a *App) runAIReview(userID, provider, apiKey, date, customTask string) (string, error) {
	ctx := context.Background()

	dayStart, _ := time.ParseInLocation("2006-01-02", date, a.Loc)
	dayEnd := dayStart.Add(24 * time.Hour)

	// Macro totals for the day
	var t aiTotals
	a.DB.QueryRow(ctx, `
		SELECT COALESCE(SUM(le.servings * fi.calories_per_serving),0),
		       COALESCE(SUM(le.servings * fi.protein_g_per_serving),0),
		       COALESCE(SUM(le.servings * fi.carbs_g_per_serving),0),
		       COALESCE(SUM(le.servings * fi.fat_g_per_serving),0),
		       COALESCE(SUM(le.servings * fi.fiber_g_per_serving),0)
		FROM log_entries le
		JOIN food_items fi ON fi.id = le.ref_id
		WHERE le.user_id = $1 AND le.kind = 'food'
		  AND le.occurred_at >= $2 AND le.occurred_at < $3
	`, userID, dayStart, dayEnd).Scan(&t.cals, &t.protein, &t.carbs, &t.fat, &t.fiber)

	// Individual log entries
	logRows, err := a.DB.Query(ctx, `
		SELECT le.meal, fi.name, fi.serving_label, le.servings,
		       le.servings * fi.calories_per_serving,
		       le.servings * fi.protein_g_per_serving,
		       le.servings * fi.carbs_g_per_serving,
		       le.servings * fi.fat_g_per_serving,
		       le.servings * fi.fiber_g_per_serving
		FROM log_entries le
		JOIN food_items fi ON fi.id = le.ref_id
		WHERE le.user_id = $1 AND le.kind = 'food'
		  AND le.occurred_at >= $2 AND le.occurred_at < $3
		ORDER BY le.occurred_at
	`, userID, dayStart, dayEnd)
	if err != nil {
		return "", fmt.Errorf("log query: %w", err)
	}
	defer logRows.Close()
	var entries []aiLogEntry
	for logRows.Next() {
		var e aiLogEntry
		if err := logRows.Scan(&e.meal, &e.name, &e.servingLabel, &e.servings,
			&e.cals, &e.protein, &e.carbs, &e.fat, &e.fiber); err != nil {
			continue
		}
		entries = append(entries, e)
	}

	// Nutrition goals (stored by frontend as JSON under key nutrition_goals)
	goals := aiGoals{Calories: 2200, Protein: 180, Carbs: 220, Fat: 70, Fiber: 30}
	var goalsJSON string
	a.DB.QueryRow(ctx, `SELECT value FROM user_settings WHERE user_id=$1 AND key='nutrition_goals'`, userID).Scan(&goalsJSON)
	if goalsJSON != "" {
		json.Unmarshal([]byte(goalsJSON), &goals) //nolint:errcheck
	}

	prompt := buildAIPrompt(date, goals, entries, t, customTask)
	return callAI(provider, apiKey, prompt)
}

func buildAIPrompt(date string, goals aiGoals, entries []aiLogEntry, t aiTotals, customTask string) string {
	var sb strings.Builder
	sb.WriteString("You are a concise, practical nutrition coach reviewing a user's food log.\n\n")
	sb.WriteString("## Daily Macro Goals\n")
	sb.WriteString(fmt.Sprintf("- Calories: %d kcal\n- Protein: %dg\n- Carbs: %dg\n- Fat: %dg\n- Fiber: %dg\n\n",
		goals.Calories, goals.Protein, goals.Carbs, goals.Fat, goals.Fiber))

	sb.WriteString(fmt.Sprintf("## Today's Food Log (%s)\n", date))
	if len(entries) == 0 {
		sb.WriteString("  (no food logged yet today)\n\n")
	} else {
		for _, e := range entries {
			sb.WriteString(fmt.Sprintf("  • [%s] %s — %.1f× %s → %d kcal | P: %.1fg | C: %.1fg | F: %.1fg\n",
				e.meal, e.name, e.servings, e.servingLabel, int(e.cals), e.protein, e.carbs, e.fat))
		}
		sb.WriteString("\n")
	}

	pct := func(eaten, goal float64) string {
		if goal == 0 { return "—" }
		return fmt.Sprintf("%d%%", int(eaten/goal*100))
	}
	sb.WriteString("## Current Totals vs Goals\n")
	sb.WriteString("| Macro | Eaten | Goal | Remaining | % |\n|-------|-------|------|-----------|---|\n")
	sb.WriteString(fmt.Sprintf("| Calories | %d kcal | %d kcal | %d kcal | %s |\n",
		int(t.cals), goals.Calories, goals.Calories-int(t.cals), pct(t.cals, float64(goals.Calories))))
	sb.WriteString(fmt.Sprintf("| Protein | %.1fg | %dg | %.1fg | %s |\n",
		t.protein, goals.Protein, float64(goals.Protein)-t.protein, pct(t.protein, float64(goals.Protein))))
	sb.WriteString(fmt.Sprintf("| Carbs | %.1fg | %dg | %.1fg | %s |\n",
		t.carbs, goals.Carbs, float64(goals.Carbs)-t.carbs, pct(t.carbs, float64(goals.Carbs))))
	sb.WriteString(fmt.Sprintf("| Fat | %.1fg | %dg | %.1fg | %s |\n",
		t.fat, goals.Fat, float64(goals.Fat)-t.fat, pct(t.fat, float64(goals.Fat))))
	sb.WriteString(fmt.Sprintf("| Fiber | %.1fg | %dg | %.1fg | %s |\n\n",
		t.fiber, goals.Fiber, float64(goals.Fiber)-t.fiber, pct(t.fiber, float64(goals.Fiber))))

	sb.WriteString("## Your Task\n")
	if customTask != "" {
		sb.WriteString(customTask)
	} else {
		sb.WriteString("Answer in two short sections:\n\n")
		sb.WriteString("**Assessment:** In 2–3 sentences, is today's log hitting macro targets effectively? Call out the biggest wins and the biggest gap.\n\n")
		sb.WriteString("**Suggestions:** List 2–3 specific foods (with rough portion sizes) that would most efficiently close the remaining gaps before end of day. Prioritize the most critical shortfalls first.\n\n")
		sb.WriteString("Be brief, practical, and specific. Skip generic advice.")
	}
	return sb.String()
}

func callAI(provider, apiKey, prompt string) (string, error) {
	if provider == "openai" {
		return callOpenAI(apiKey, prompt)
	}
	return callClaude(apiKey, prompt)
}

func callClaude(apiKey, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":      "claude-opus-4-6",
		"max_tokens": 1024,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})
	req, _ := http.NewRequest("POST", "https://api.anthropic.com/v1/messages", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-api-key", apiKey)
	req.Header.Set("anthropic-version", "2023-06-01")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("claude request: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("claude API %d: %s", resp.StatusCode, string(respBody))
	}
	var result struct {
		Content []struct{ Text string `json:"text"` } `json:"content"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("claude decode: %w", err)
	}
	if len(result.Content) == 0 {
		return "", fmt.Errorf("claude returned no content")
	}
	return result.Content[0].Text, nil
}

func callOpenAI(apiKey, prompt string) (string, error) {
	body, _ := json.Marshal(map[string]any{
		"model":      "gpt-4o",
		"max_tokens": 1024,
		"messages":   []map[string]string{{"role": "user", "content": prompt}},
	})
	req, _ := http.NewRequest("POST", "https://api.openai.com/v1/chat/completions", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+apiKey)
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("openai request: %w", err)
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 200 {
		return "", fmt.Errorf("openai API %d: %s", resp.StatusCode, string(respBody))
	}
	var result struct {
		Choices []struct {
			Message struct{ Content string `json:"content"` } `json:"message"`
		} `json:"choices"`
	}
	if err := json.Unmarshal(respBody, &result); err != nil {
		return "", fmt.Errorf("openai decode: %w", err)
	}
	if len(result.Choices) == 0 {
		return "", fmt.Errorf("openai returned no choices")
	}
	return result.Choices[0].Message.Content, nil
}

func fireWebhookChunked(webhookURL, message string) error {
	const limit = 1990
	for len(message) > 0 {
		chunk := message
		if len(chunk) > limit {
			// Break at last newline within limit to avoid splitting mid-sentence
			cut := strings.LastIndex(message[:limit], "\n")
			if cut <= 0 {
				cut = limit
			}
			chunk = message[:cut]
			message = strings.TrimLeft(message[cut:], "\n")
		} else {
			message = ""
		}
		if err := fireWebhook(webhookURL, chunk); err != nil {
			return err
		}
	}
	return nil
}

func fireWebhook(webhookURL, message string) error {
	body, _ := json.Marshal(map[string]string{
		"content": message,
	})
	resp, err := http.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 400 {
		return fmt.Errorf("webhook returned %d", resp.StatusCode)
	}
	return nil
}

func (a *App) HandleTriggerAIReview(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		writeJSON(w, 400, map[string]any{"error": "user_id required"})
		return
	}

	// Read all needed settings in one query
	rows, err := a.DB.Query(r.Context(), `
		SELECT key, value FROM user_settings
		WHERE user_id = $1 AND key IN ('ai_provider','ai_api_key','pantry_expiration_webhook')
	`, userID)
	if err != nil {
		writeJSON(w, 500, map[string]any{"error": "settings query failed"})
		return
	}
	settings := map[string]string{}
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err == nil {
			settings[k] = v
		}
	}
	rows.Close()

	apiKey := settings["ai_api_key"]
	if apiKey == "" {
		writeJSON(w, 400, map[string]any{"error": "no API key configured"})
		return
	}
	provider := settings["ai_provider"]
	if provider == "" {
		provider = "claude"
	}
	webhookURL := settings["pantry_expiration_webhook"]
	log.Printf("[ai-review] trigger for user %s provider=%s webhook_set=%v", userID, provider, webhookURL != "")

	var reqBody struct {
		CustomPrompt string `json:"custom_prompt"`
	}
	json.NewDecoder(r.Body).Decode(&reqBody) //nolint:errcheck

	today := a.now().Format("2006-01-02")
	text, err := a.runAIReview(userID, provider, apiKey, today, reqBody.CustomPrompt)
	if err != nil {
		writeJSON(w, 502, map[string]any{"error": err.Error()})
		return
	}

	resultJSON, _ := json.Marshal(map[string]string{
		"date": today, "provider": provider,
		"runAt": time.Now().UTC().Format(time.RFC3339), "text": text,
	})
	for _, kv := range [][2]string{
		{"ai_last_review_date", today},
		{"ai_last_review_result", string(resultJSON)},
	} {
		a.DB.Exec(r.Context(), `
			INSERT INTO user_settings (user_id, key, value) VALUES ($1,$2,$3)
			ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value
		`, userID, kv[0], kv[1])
	}

	if webhookURL != "" {
		msg := fmt.Sprintf("**Intake AI Review — %s**\n\n%s", today, text)
		if err := fireWebhookChunked(webhookURL, msg); err != nil {
			log.Printf("[ai-review] webhook notify failed: %v", err)
		} else {
			log.Printf("[ai-review] webhook notified for user %s", userID)
		}
	} else {
		log.Printf("[ai-review] no webhook configured for user %s, skipping notify", userID)
	}

	writeJSON(w, 200, map[string]any{"text": text, "date": today, "provider": provider})
}

func (a *App) HandleGetLastAIReview(w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	if userID == "" {
		writeJSON(w, 400, map[string]any{"error": "user_id required"})
		return
	}
	var resultJSON string
	err := a.DB.QueryRow(r.Context(), `
		SELECT value FROM user_settings WHERE user_id=$1 AND key='ai_last_review_result'
	`, userID).Scan(&resultJSON)
	if err != nil || resultJSON == "" {
		writeJSON(w, 200, nil)
		return
	}
	// resultJSON is already a JSON string — write it directly
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(200)
	w.Write([]byte(resultJSON)) //nolint:errcheck
}
