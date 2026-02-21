# Future Plans & Ideas

## Discord Bot Integration

**Concept**: Go companion app that watches a Discord channel and auto-logs food via AI.

### How it works
1. User posts a link in Discord (recipe site, MyFitnessPal, nutrition label photo, etc.)
2. Bot fetches the content
3. Sends to OpenAI API with MacroTrack API spec as context
4. OpenAI extracts nutrition data and formats as MacroTrack JSON
5. Bot POSTs to MacroTrack API (`/recipes`, `/log/food`, etc.)
6. Bot replies in Discord: "✅ Added Chicken Breast (165 kcal)"

### Architecture
- **Language**: Go
- **Discord library**: `discordgo`
- **OpenAI SDK**: `github.com/sashabaranov/go-openai`
- **Config**: Discord token, channel ID, OpenAI key, MacroTrack URL

### Configuration (env vars)
```
DISCORD_BOT_TOKEN=...
DISCORD_CHANNEL_ID=...
OPENAI_API_KEY=...
MACROTRACK_API_URL=http://localhost:8088
MACROTRACK_USER_ID=00000000-0000-0000-0000-000000000001
```

### Repository structure
```
macrotrack/
├── discord-bot/
│   ├── main.go
│   ├── go.mod
│   ├── Dockerfile
│   └── README.md
```

### Use cases
- Post MyFitnessPal links → auto-create food items
- Post recipe URLs → auto-create recipes with ingredients
- Post nutrition label photos (OCR via OpenAI vision) → auto-log meals
- Natural language: "I just ate 2 eggs and toast" → parsed and logged

### Future enhancements
- Slash commands: `/log chicken breast 6oz`
- Daily summaries posted to Discord
- Photo uploads → vision API extracts nutrition facts
- Integration with meal planning ("what should I eat for 40g protein?")

---

## Nudge — Daily Reminder System

**Status**: Implemented

**Concept**: Set daily reminders for food items (supplements, creatine, vitamins, etc.). Pick a food item and a deadline time. If it hasn't been logged by that time, a Discord webhook notification fires.

### Architecture
- **Scheduler**: `gocron/v2` runs in-process as a goroutine in the Go API
- **Check frequency**: Every 1 minute
- **Check logic**: Query `log_entries` for today — if no entry for the food item, fire webhook
- **Notification**: Discord webhook (simple POST with JSON `{"content": "..."}`)

### Database
```sql
CREATE TABLE nudges (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  food_item_id UUID REFERENCES food_items(id),
  remind_at TIME NOT NULL,        -- e.g. '14:00:00'
  webhook_url TEXT NOT NULL,      -- Discord webhook URL
  enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, food_item_id)
);
```

### API Endpoints
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/nudges` | List all nudges (includes `logged_today` status) |
| `POST` | `/nudges` | Create a nudge |
| `PUT` | `/nudges/{id}` | Update remind_at, webhook_url, or enabled |
| `DELETE` | `/nudges/{id}` | Delete a nudge |
| `POST` | `/nudges/{id}/test` | Fire webhook immediately for testing |

### Frontend
- Page at `/nudge` with food item search, time picker, webhook URL input
- Active reminders list with enable/disable toggle, test button, delete
- Green dot indicator when item has been logged today
- Default webhook URL saved in localStorage for convenience

### Files
- `db/init/008_nudges.sql` — migration
- `api/cmd/api/main.go` — handlers + gocron scheduler
- `web/app/nudge/page.tsx` — frontend page
- `web/app/components/Sidebar.tsx` — nav link
