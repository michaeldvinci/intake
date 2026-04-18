# InTake — Self-Hosted Nutrition & Activity Tracker

A self-hosted macro tracker with food logging, recipe management, pantry tracking, workout logging, meal planning, and daily AI-powered reviews — all running on your own hardware.

> **Stack:** Next.js 14 · Go 1.22 · PostgreSQL 16 · Docker Compose

---

## Table of Contents

- [Quick Start](#quick-start)
- [Features](#features)
- [Environment Variables](#environment-variables)
- [Architecture](#architecture)
- [Authentication](#authentication)
- [API Reference](#api-reference)
  - [Auth](#auth)
  - [Dashboard](#dashboard)
  - [Food Items](#food-items)
  - [Food Log](#food-log)
  - [Body Metrics](#body-metrics)
  - [Activity & Water](#activity--water)
  - [Recipes](#recipes)
  - [Recipe Photos](#recipe-photos)
  - [Pantry](#pantry)
  - [Ingredient Categories](#ingredient-categories)
  - [Shopping List](#shopping-list)
  - [Presets](#presets)
  - [Nudges](#nudges)
  - [Meal Plan](#meal-plan)
  - [Workouts](#workouts)
  - [Settings](#settings)
  - [AI Review](#ai-review)
  - [Data Export & Import](#data-export--import)
- [Data Objects](#data-objects)
- [Database Schema](#database-schema)
- [Settings Keys](#settings-keys)
- [Scheduled Jobs](#scheduled-jobs)
- [Notes](#notes)

---

## Quick Start

**1. Grab the compose file**

```bash
curl -O https://raw.githubusercontent.com/michaeldvinci/intake/main/docker-compose.yml
```

**2. Create your `.env`**

```bash
curl -O https://raw.githubusercontent.com/michaeldvinci/intake/main/.env.example
cp .env.example .env
```

Edit `.env` — at minimum set `DATABASE_URL`. If accessing from another device (phone, tablet), also set `NEXT_PUBLIC_API_BASE`.

**3. Start**

```bash
docker compose up -d
```

Open **http://localhost:3001** — the schema is applied automatically on first boot.

**4. Register**

Navigate to `/login` and create an account. The first account registered gets a one-time option in Settings to import any data previously logged under the anonymous local user.

---

## Features

| Feature | Description |
|---|---|
| **Ledger** | Daily macro summary — calories, protein, net calories, steps. Food log grouped by meal with inline search and quick-add. |
| **Log** | Full per-meal food logging with serving sizes, meal assignment (breakfast / lunch / dinner / snack), and timestamps. |
| **Recipes** | Create food items with full macro profiles. Attach Markdown instructions, categorised ingredients, and a photo. |
| **Pantry** | Track quantities at home. Auto-deducts when you log a meal. Expiration tracking with Discord webhook alerts. |
| **Shopping** | Select recipes, generate a merged ingredient list grouped by category. Check off items or export to Markdown. |
| **Calendar** | Monthly view of daily calorie totals with color-coded progress towards your goal. |
| **Metrics** | Log body weight (lbs or kg) and daily steps / active calories over time, with a trend chart. |
| **Workouts** | Define programs with exercises (sets × reps range), schedule them by day of week, log sets with weight/reps. |
| **Meal Plan** | Plan meals by day, export as an `.ics` calendar file. |
| **Nudges** | Set per-food Discord webhook reminders that fire if you haven't logged that item by a specified time. |
| **AI Review** | Automated daily food log review via Claude or OpenAI, posted to Discord at a configurable time. |
| **Settings** | Macro goals, weight unit, water goal, meal plan times, AI config, data export/import, webhook URLs. |

---

## Environment Variables

### API (`api` service)

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | — | **Required.** Postgres connection string, e.g. `postgres://intake:intakepw@db:5432/intake?sslmode=disable` |
| `API_PORT` | `8080` | Port the API listens on inside the container |
| `APP_TIMEZONE` | `America/Chicago` | IANA timezone used for date math and scheduled jobs |
| `AUTH_SECRET` | *(random)* | HMAC-SHA256 key for JWT signing. If unset, a random key is generated on each boot — **sessions will not survive restarts** |

### Web (`web` service)

| Variable | Default | Description |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | `http://localhost:8080` | API URL used by browser clients on other devices (phone, tablet). Leave as-is for same-machine access. |
| `NEXT_PUBLIC_APP_TIMEZONE` | `America/Chicago` | IANA timezone for frontend date display |
| `API_INTERNAL_BASE` | `http://api:8080` | Internal Docker network URL the Next.js server uses to proxy `/api/*` |

### Database (`db` service)

| Variable | Default | Description |
|---|---|---|
| `POSTGRES_DB` | `intake` | Database name |
| `POSTGRES_USER` | `intake` | Database user |
| `POSTGRES_PASSWORD` | `intakepw` | Database password |

---

## Architecture

```
intake/
├── api/
│   ├── cmd/api/
│   │   ├── main.go                  # App bootstrap, router, scheduler
│   │   ├── schema.sql               # Embedded schema (applied on every boot)
│   │   ├── auth_middleware.go       # JWT cookie middleware
│   │   ├── handlers_auth.go         # Register, login, logout, me, claim-local-data
│   │   ├── handlers_food.go         # Food items CRUD + dashboard + log
│   │   ├── handlers_log.go          # Log food, list today, range totals, delete
│   │   ├── handlers_body.go         # Body weight + daily activity + water
│   │   ├── handlers_recipes.go      # Recipes + ingredients + shopping items
│   │   ├── handlers_photos.go       # Recipe photo upload/download/delete
│   │   ├── handlers_pantry.go       # Pantry CRUD + deduct + expiration checker
│   │   ├── handlers_categories.go   # Ingredient category mappings
│   │   ├── handlers_shopping.go     # Merged shopping list
│   │   ├── handlers_presets.go      # Meal presets
│   │   ├── handlers_nudges.go       # Food reminder nudges + Discord webhook
│   │   ├── handlers_meal_plan.go    # Meal plan entries + ICS export
│   │   ├── handlers_workouts.go     # Programs, exercises, sessions, sets
│   │   ├── handlers_settings.go     # Per-user key/value settings
│   │   ├── handlers_data.go         # Full JSON export/import + Markdown export
│   │   └── ai_review.go             # Claude/OpenAI daily review + Discord post
│   ├── go.mod
│   └── Dockerfile
├── web/
│   ├── app/
│   │   ├── page.tsx                 # Ledger (main dashboard)
│   │   ├── log/                     # Food log page
│   │   ├── recipes/                 # Recipe & food item management
│   │   ├── pantry/                  # Pantry tracker
│   │   ├── metrics/                 # Weight & activity entry
│   │   ├── calendar/                # Monthly calorie calendar
│   │   ├── shopping/                # Shopping list generator
│   │   ├── workouts/                # Workout tracker
│   │   ├── nudge/                   # Nudge management
│   │   ├── settings/                # Settings page
│   │   ├── login/                   # Auth page
│   │   ├── components/Sidebar.tsx   # Nav shell with collapse/expand
│   │   ├── context/
│   │   │   ├── Auth.tsx             # JWT session context
│   │   │   ├── WeightUnit.tsx       # lbs/kg preference
│   │   │   └── NutritionGoals.tsx   # Daily macro goal context
│   │   └── lib/                     # API client helpers, date utils
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
└── .env.example
```

### Services

| Service | Image | Internal port | Host port |
|---|---|---|---|
| `db` | `postgres:16-alpine` | 5432 | 5432 |
| `api` | `michaeldvinci/intake-api` | 8080 | `API_PORT` (8080) |
| `web` | `michaeldvinci/intake-web` | 3000 | 3001 |

The web container rewrites all `/api/*` requests to the API over the internal Docker network. The browser never reaches the API directly.

---

## Authentication

All API routes except `POST /auth/register`, `POST /auth/login`, and `POST /auth/logout` require a valid session.

**Mechanism:** HMAC-SHA256 JWT stored in an `HttpOnly` session cookie (`intake_session`). The cookie is set on login/register and cleared on logout.

**Session lifetime:** Sessions survive as long as `AUTH_SECRET` stays the same. If `AUTH_SECRET` is not set, a random key is generated at startup — all existing sessions become invalid on restart. Set a stable `AUTH_SECRET` in production.

**Local user:** A built-in user (`local@intake` / UUID `00000000-0000-0000-0000-000000000001`) is seeded at startup for backwards compatibility. This user has no password and cannot log in. The first registered account sees an "Import Local Data" button in Settings to migrate any data from this user.

---

## API Reference

**Base URL:** `http://localhost:8080` (or `NEXT_PUBLIC_API_BASE`)

All requests and responses use `application/json`. Authentication is via the `intake_session` cookie — include `credentials: "include"` in browser fetch calls.

### Auth

#### `POST /auth/register`

Create a new account.

**Request body:**

```json
{
  "email": "you@example.com",
  "password": "yourpassword",
  "display_name": "Your Name"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `email` | string | yes | Unique email address |
| `password` | string | yes | Plain text — hashed with bcrypt server-side |
| `display_name` | string | no | Display name shown in the sidebar |

**Response `201`:**

```json
{
  "id": "uuid",
  "email": "you@example.com",
  "display_name": "Your Name"
}
```

Sets the `intake_session` cookie.

---

#### `POST /auth/login`

Log in with existing credentials.

**Request body:**

```json
{
  "email": "you@example.com",
  "password": "yourpassword"
}
```

**Response `200`:**

```json
{
  "id": "uuid",
  "email": "you@example.com",
  "display_name": "Your Name"
}
```

Sets the `intake_session` cookie.

---

#### `POST /auth/logout`

Clear the session cookie.

**Response `200`:** `{ "ok": true }`

---

#### `GET /auth/me`

Return the current authenticated user.

**Response `200`:**

```json
{
  "id": "uuid",
  "email": "you@example.com",
  "display_name": "Your Name",
  "is_first_user": true
}
```

| Field | Type | Description |
|---|---|---|
| `id` | string (UUID) | User ID |
| `email` | string | Email address |
| `display_name` | string | Display name |
| `is_first_user` | boolean | `true` if this is the oldest non-local registered account — used to show the "Import Local Data" option in Settings |

---

#### `POST /auth/claim-local-data`

Migrate all data from the built-in local user (`local@intake`) to the authenticated user's account. Rows that would conflict with existing data are skipped. Idempotent.

**Response `200`:**

```json
{ "migrated_rows": 42 }
```

---

### Dashboard

#### `GET /dashboard/today`

Macro and activity totals for a single day.

**Query params:**

| Param | Type | Default | Description |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | today | Day to summarise |

**Response `200`:**

```json
{
  "date": "2025-01-01",
  "user_id": "uuid",
  "calories_in": 1840.5,
  "protein_g": 142.0,
  "carbs_g": 180.0,
  "fat_g": 55.0,
  "fiber_g": 28.0,
  "steps": 8200,
  "active_calories_est": 312.0
}
```

---

#### `GET /day/totals`

Same as `/dashboard/today` but includes `entry_count`.

**Query params:** `date` (YYYY-MM-DD, default today)

**Response `200`:**

```json
{
  "date": "2025-01-01",
  "entry_count": 6,
  "calories_in": 1840.5,
  "protein_g": 142.0,
  "carbs_g": 180.0,
  "fat_g": 55.0,
  "fiber_g": 28.0
}
```

---

### Food Items

Food items are the atomic unit. Every recipe also creates a corresponding food item so it can be logged directly.

#### `GET /food-items`

List all food items for the current user, sorted by name.

**Response `200`:** Array of `FoodItem` objects.

```json
[
  {
    "id": "uuid",
    "name": "Chicken Breast",
    "brand": "",
    "serving_label": "100g",
    "calories_per_serving": 165,
    "protein_g_per_serving": 31,
    "carbs_g_per_serving": 0,
    "fat_g_per_serving": 3.6,
    "fiber_g_per_serving": 0
  }
]
```

---

#### `POST /food-items`

Create a food item. Also creates a linked recipe record automatically.

**Request body:**

```json
{
  "name": "Chicken Breast",
  "brand": "Generic",
  "serving_label": "100g",
  "calories_per_serving": 165,
  "protein_g_per_serving": 31,
  "carbs_g_per_serving": 0,
  "fat_g_per_serving": 3.6,
  "fiber_g_per_serving": 0,
  "recipe_instructions": "Optional markdown instructions",
  "recipe_yield_count": 1,
  "recipe_ingredients": [
    { "food_item_id": "uuid", "amount_g": 100 }
  ]
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `name` | string | yes | Display name |
| `brand` | string | no | Brand name |
| `serving_label` | string | no | Default `"1 serving"` |
| `calories_per_serving` | number | no | kcal per serving |
| `protein_g_per_serving` | number | no | grams of protein |
| `carbs_g_per_serving` | number | no | grams of carbs |
| `fat_g_per_serving` | number | no | grams of fat |
| `fiber_g_per_serving` | number | no | grams of fiber |
| `recipe_instructions` | string | no | Markdown recipe instructions |
| `recipe_yield_count` | integer | no | Number of servings the recipe yields (default 1) |
| `recipe_ingredients` | array | no | Sub-ingredients with amounts in grams |

**Response `201`:** `{ "ok": true, "id": "uuid", "recipe_id": "uuid" }`

---

#### `GET /food-items/{id}`

Get a single food item by UUID.

**Response `200`:** `FoodItem` object. `404` if not found.

---

#### `PUT /food-items/{id}`

Update a food item and its associated recipe.

**Request body:** Same fields as `POST /food-items` (all optional except `name`).

**Response `200`:** `{ "ok": true }`

---

#### `DELETE /food-items/{id}`

Delete a food item. Cascades to recipe ingredients and log entries.

**Response `200`:** `{ "ok": true }`

---

### Food Log

#### `GET /log/today`

All log entries for a given day, ordered by time.

**Query params:**

| Param | Type | Default |
|---|---|---|
| `date` | `YYYY-MM-DD` | today |

**Response `200`:** Array of `LogEntry` objects.

```json
[
  {
    "id": "uuid",
    "meal": "breakfast",
    "food_item_id": "uuid",
    "food_name": "Oats",
    "serving_label": "100g",
    "servings": 1.5,
    "calories": 555,
    "protein_g": 13.5,
    "carbs_g": 100.5,
    "fat_g": 7.5,
    "fiber_g": 10.5,
    "occurred_at": "2025-01-01T08:30:00Z"
  }
]
```

---

#### `GET /log/range`

Per-day calorie totals for a date range. Used by the calendar view.

**Query params:**

| Param | Type | Required | Description |
|---|---|---|---|
| `from` | `YYYY-MM-DD` | yes | Start date (inclusive) |
| `to` | `YYYY-MM-DD` | yes | End date (inclusive) |

**Response `200`:**

```json
[
  { "date": "2025-01-01", "calories": 1840.5 },
  { "date": "2025-01-02", "calories": 2100.0 }
]
```

---

#### `POST /log/food`

Log a food item.

**Request body:**

```json
{
  "food_item_id": "uuid",
  "servings": 1.5,
  "meal": "lunch",
  "occurred_at": "2025-01-01T12:30:00Z",
  "note": "optional"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `food_item_id` | string (UUID) | yes | Food item to log |
| `servings` | number | yes | Number of servings (must be > 0) |
| `meal` | string | no | `breakfast`, `lunch`, `dinner`, or `snack_N`. Default `breakfast` |
| `occurred_at` | RFC3339 timestamp | no | Defaults to now |
| `note` | string | no | Optional note |

**Response `201`:** `{ "ok": true }`

---

#### `DELETE /log/{id}`

Delete a log entry by UUID.

**Response `200`:** `{ "ok": true }` · `404` if not found.

---

### Body Metrics

#### `POST /body/weight`

Log a body weight measurement.

**Request body:**

```json
{
  "weight_kg": 82.5,
  "measured_at": "2025-01-01T07:00:00Z",
  "note": "morning, fasted"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `weight_kg` | number | yes | Weight in kilograms |
| `measured_at` | RFC3339 timestamp | no | Defaults to now |
| `note` | string | no | Optional note |

**Response `201`:** `{ "ok": true }`

---

### Activity & Water

#### `POST /activity/daily`

Log or update steps and active calories for a day. Upserts on `(user_id, date)`.

**Request body:**

```json
{
  "date": "2025-01-01",
  "steps": 8200,
  "active_calories_est": 312.0
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `date` | `YYYY-MM-DD` | no | Defaults to today |
| `steps` | integer | no | Step count |
| `active_calories_est` | number | no | Estimated active calories burned |

**Response `201`:** `{ "ok": true }`

---

#### `GET /activity/water`

Get water intake (glasses) for a day.

**Query params:** `date` (YYYY-MM-DD, default today)

**Response `200`:** `{ "glasses": 5 }`

---

#### `POST /activity/water`

Set water intake for a day. Upserts on `(user_id, date)`.

**Request body:**

```json
{
  "date": "2025-01-01",
  "glasses": 6
}
```

**Response `200`:** `{ "ok": true }`

---

### Recipes

Recipes share their UUID with their underlying food item — every recipe *is* a food item. Macros are stored on the food item; instructions and ingredient breakdown are stored on the recipe.

#### `GET /recipes`

List all recipes for the current user, sorted by name.

**Response `200`:** Array of `RecipeSummary` objects.

```json
[
  {
    "id": "uuid",
    "name": "Overnight Oats",
    "brand": "",
    "serving_label": "1 bowl",
    "instructions": "# Overnight Oats\n...",
    "yield_count": 2,
    "calories_per_serving": 420,
    "protein_g_per_serving": 28,
    "carbs_g_per_serving": 55,
    "fat_g_per_serving": 10,
    "fiber_g_per_serving": 8,
    "created_at": "2025-01-01T00:00:00Z",
    "ingredient_count": 4
  }
]
```

---

#### `POST /recipes`

Create a recipe (and its linked food item).

**Request body:**

```json
{
  "name": "Overnight Oats",
  "brand": "",
  "serving_label": "1 bowl",
  "calories_per_serving": 420,
  "protein_g_per_serving": 28,
  "carbs_g_per_serving": 55,
  "fat_g_per_serving": 10,
  "fiber_g_per_serving": 8,
  "instructions": "## Instructions\n...",
  "yield_count": 2,
  "shopping_items": [
    { "name": "Rolled oats", "amount": 200, "unit": "g", "sort_order": 0 }
  ]
}
```

**Response `201`:** `{ "ok": true, "id": "uuid" }`

---

#### `GET /recipes/{id}`

Get a single recipe with full ingredient list.

**Response `200`:** `RecipeDetail` object.

```json
{
  "id": "uuid",
  "user_id": "uuid",
  "name": "Overnight Oats",
  "instructions": "## Instructions\n...",
  "yield_count": 2,
  "created_at": "2025-01-01T00:00:00Z",
  "ingredients": [
    {
      "id": "uuid",
      "food_item_id": "uuid",
      "food_name": "Rolled Oats",
      "brand": "",
      "amount_g": 200
    }
  ]
}
```

---

#### `PUT /recipes/{id}`

Update recipe name, instructions, or yield count.

**Request body:** `{ "name": "...", "instructions": "...", "yield_count": 2 }`

**Response `200`:** `{ "ok": true }`

---

#### `POST /recipes/{id}/ingredients`

Add a single ingredient to a recipe.

**Request body:**

```json
{ "food_item_id": "uuid", "amount_g": 200 }
```

**Response `201`:** `{ "ok": true, "id": "uuid" }`

---

#### `PUT /recipes/{id}/ingredients`

Replace all ingredients for a recipe atomically.

**Request body:**

```json
{
  "ingredients": [
    { "food_item_id": "uuid", "amount_g": 200 },
    { "food_item_id": "uuid", "amount_g": 50 }
  ]
}
```

**Response `200`:** `{ "ok": true, "ingredient_count": 2 }`

---

#### `PUT /recipes/{id}/ingredients/{ingredient_id}`

Update a single ingredient's amount.

**Request body:** `{ "amount_g": 250 }`

**Response `200`:** `{ "ok": true }`

---

#### `DELETE /recipes/{id}/ingredients/{ingredient_id}`

Remove an ingredient from a recipe.

**Response `200`:** `{ "ok": true }`

---

#### `POST /recipes/export-ingredients`

Merge and sum ingredients across multiple recipes. Used to build the shopping list.

**Request body:**

```json
{ "recipe_ids": ["uuid", "uuid"] }
```

**Response `200`:**

```json
{
  "ok": true,
  "ingredients": [
    { "food_item_id": "uuid", "name": "Rolled Oats", "brand": "", "total_g": 400 }
  ]
}
```

---

#### `GET /recipes/{id}/shopping-items`

List the shopping items (free-text lines, not food-item references) for a recipe.

**Response `200`:** Array of shopping item objects.

```json
[
  { "id": "uuid", "name": "Rolled oats", "amount": 200, "unit": "g", "sort_order": 0 }
]
```

---

#### `PUT /recipes/{id}/shopping-items`

Replace all shopping items for a recipe.

**Request body:**

```json
{
  "items": [
    { "name": "Rolled oats", "amount": 200, "unit": "g", "sort_order": 0 }
  ]
}
```

**Response `200`:** `{ "ok": true }`

---

### Recipe Photos

Photos are stored as base64 in the database (no file system required).

#### `GET /recipes/{id}/photo`

Download the recipe photo.

**Response `200`:** `image/*` binary. `404` if no photo exists.

---

#### `PUT /recipes/{id}/photo`

Upload a photo. Send as `multipart/form-data` with the image in the `photo` field, or as raw binary with the correct `Content-Type`.

**Response `200`:** `{ "ok": true }`

---

#### `DELETE /recipes/{id}/photo`

Remove the recipe photo.

**Response `200`:** `{ "ok": true }`

---

### Pantry

#### `GET /pantry`

List all pantry items for the current user.

**Response `200`:**

```json
[
  {
    "food_item_id": "uuid",
    "food_name": "Rolled Oats",
    "brand": "",
    "serving_label": "100g",
    "calories_per_serving": 389,
    "protein_g_per_serving": 17,
    "carbs_g_per_serving": 66,
    "fat_g_per_serving": 7,
    "quantity": 4.5,
    "updated_at": "2025-01-01T10:00:00Z",
    "expires_at": "2025-03-01"
  }
]
```

---

#### `PUT /pantry/{food_item_id}`

Set pantry quantity for a food item. Upserts on `(user_id, food_item_id)`.

**Request body:**

```json
{
  "quantity": 4.5,
  "expires_at": "2025-03-01"
}
```

| Field | Type | Description |
|---|---|---|
| `quantity` | number | Quantity in servings |
| `expires_at` | `YYYY-MM-DD` string or null | Optional expiration date |

**Response `200`:** `{ "ok": true }`

---

#### `DELETE /pantry/{food_item_id}`

Remove an item from the pantry.

**Response `200`:** `{ "ok": true }`

---

#### `POST /pantry/deduct`

Deduct servings from a pantry item (floors at 0). Called automatically after logging food.

**Request body:**

```json
{ "food_item_id": "uuid", "servings": 1.5 }
```

**Response `200`:** `{ "ok": true }`

---

### Ingredient Categories

Maps ingredient names to category slugs for shopping list grouping (e.g. `"Rolled Oats"` → `"grains"`).

#### `GET /ingredient-categories`

List all category mappings for the current user.

**Response `200`:**

```json
[
  { "ingredient_name": "Rolled Oats", "category_slug": "grains" }
]
```

---

#### `PUT /ingredient-categories`

Replace all category mappings for the current user.

**Request body:** Array of `{ ingredient_name, category_slug }` objects.

---

#### `PUT /ingredient-categories/{name}`

Set the category for a single ingredient name.

**Request body:** `{ "category_slug": "grains" }`

---

#### `PUT /ingredient-categories/set`

Batch set categories from a request body mapping.

---

#### `DELETE /ingredient-categories/{name}`

Remove a category mapping.

**Response `200`:** `{ "ok": true }`

---

### Shopping List

#### `GET /shopping-list`

Returns the full merged shopping list across all recipes that have shopping items, grouped by category.

**Response `200`:**

```json
[
  {
    "recipe_id": "uuid",
    "recipe_name": "Overnight Oats",
    "items": [
      { "id": "uuid", "name": "Rolled oats", "amount": 200, "unit": "g", "sort_order": 0 }
    ]
  }
]
```

---

### Presets

Presets are named groups of food items that can be applied to the log in one action.

#### `POST /presets`

Create a preset.

**Request body:**

```json
{
  "name": "Morning Stack",
  "items": [
    { "food_item_id": "uuid", "servings": 1 }
  ]
}
```

**Response `201`:** `{ "ok": true, "id": "uuid" }`

---

#### `POST /presets/{id}/apply`

Log all items in a preset for the current date.

**Request body:** `{ "meal": "breakfast", "date": "2025-01-01" }`

**Response `200`:** `{ "ok": true }`

---

### Nudges

Nudges fire a Discord webhook at a set time if a specific food item hasn't been logged that day.

#### `GET /nudges`

List all nudges. Includes `logged_today: boolean` for each.

**Response `200`:**

```json
[
  {
    "id": "uuid",
    "user_id": "uuid",
    "food_item_id": "uuid",
    "food_name": "Protein Shake",
    "remind_at": "09:00",
    "webhook_url": "https://discord.com/api/webhooks/...",
    "enabled": true,
    "logged_today": false
  }
]
```

---

#### `POST /nudges`

Create a nudge. One nudge per food item per user (upserts).

**Request body:**

```json
{
  "food_item_id": "uuid",
  "remind_at": "09:00",
  "webhook_url": "https://discord.com/api/webhooks/..."
}
```

**Response `201`:** `{ "ok": true, "id": "uuid" }`

---

#### `PUT /nudges/{id}`

Update a nudge's time, webhook URL, or enabled state. Send only the fields to update.

**Request body:**

```json
{
  "remind_at": "10:00",
  "webhook_url": "https://...",
  "enabled": false
}
```

**Response `200`:** `{ "ok": true }`

---

#### `DELETE /nudges/{id}`

Delete a nudge.

**Response `200`:** `{ "ok": true }`

---

#### `POST /nudges/{id}/test`

Fire the nudge's webhook immediately regardless of log state. Useful for testing.

**Response `200`:** `{ "ok": true, "message": "webhook fired" }`

---

### Meal Plan

#### `GET /meal-plan`

List all meal plan entries for the current user.

**Response `200`:**

```json
[
  {
    "id": "uuid",
    "date": "2025-01-06",
    "meal": "lunch",
    "food_item_id": "uuid",
    "food_name": "Overnight Oats",
    "servings": 1
  }
]
```

---

#### `POST /meal-plan`

Add a meal plan entry.

**Request body:**

```json
{
  "date": "2025-01-06",
  "meal": "lunch",
  "food_item_id": "uuid",
  "servings": 1
}
```

**Response `201`:** `{ "ok": true, "id": "uuid" }`

---

#### `DELETE /meal-plan/{id}`

Remove a meal plan entry.

**Response `200`:** `{ "ok": true }`

---

#### `GET /meal-plan/export.ics`

Export the meal plan as an iCalendar `.ics` file for import into any calendar app.

**Query params:**

| Param | Default | Description |
|---|---|---|
| `weeks` | setting `meal_plan_weeks` or `2` | Number of weeks to export |

**Response:** `text/calendar` with `Content-Disposition: attachment`.

---

### Workouts

#### `GET /workout-programs`

List all workout programs with their exercises.

**Response `200`:**

```json
[
  {
    "id": "uuid",
    "name": "Push Day",
    "days": [1, 3, 5],
    "created_at": "2025-01-01T00:00:00Z",
    "exercises": [
      {
        "id": "uuid",
        "program_id": "uuid",
        "name": "Bench Press",
        "sets": 4,
        "reps_min": 6,
        "reps_max": 8,
        "sort_order": 0
      }
    ]
  }
]
```

`days` is an array of weekday integers: `0`=Sunday, `1`=Monday … `6`=Saturday.

---

#### `POST /workout-programs`

Create a workout program.

**Request body:**

```json
{
  "name": "Push Day",
  "days": [1, 3, 5]
}
```

**Response `201`:** `{ "id": "uuid" }`

---

#### `PUT /workout-programs/{id}`

Update a program's name and/or scheduled days.

**Request body:** `{ "name": "...", "days": [1, 3] }`

**Response `200`:** `{ "ok": true }`

---

#### `DELETE /workout-programs/{id}`

Delete a program and all its exercises and sessions.

**Response `200`:** `{ "ok": true }`

---

#### `POST /workout-programs/{id}/exercises`

Add an exercise to a program.

**Request body:**

```json
{
  "name": "Bench Press",
  "sets": 4,
  "reps_min": 6,
  "reps_max": 8,
  "sort_order": 0
}
```

**Response `201`:** `{ "id": "uuid" }`

---

#### `DELETE /workout-programs/{id}/exercises/{exercise_id}`

Remove an exercise.

**Response `200`:** `{ "ok": true }`

---

#### `GET /workout-sessions/day`

Get all workout sessions scheduled for a given day (based on program day-of-week assignments). Includes logged sets for each exercise and the previous session's completed sets for reference.

**Query params:** `date` (YYYY-MM-DD, default today)

**Response `200`:**

```json
[
  {
    "session_id": "uuid",
    "program_id": "uuid",
    "program_name": "Push Day",
    "exercises": [
      {
        "id": "uuid",
        "program_id": "uuid",
        "name": "Bench Press",
        "sets": 4,
        "reps_min": 6,
        "reps_max": 8,
        "sort_order": 0,
        "logged_sets": [
          { "set_number": 1, "weight_kg": 80.0, "reps_actual": 8, "completed": true },
          { "set_number": 2, "weight_kg": null, "reps_actual": null, "completed": false }
        ],
        "prev_logged_sets": [
          { "set_number": 1, "weight_kg": 77.5, "reps_actual": 8, "completed": true }
        ]
      }
    ]
  }
]
```

`session_id` is `null` if no session has been started for this program on this date yet.

---

#### `POST /workout-sessions`

Start a workout session (creates a session record for a program + date). Upserts.

**Request body:**

```json
{
  "program_id": "uuid",
  "date": "2025-01-01"
}
```

**Response `201`:** `{ "id": "uuid" }`

---

#### `PUT /workout-session-sets`

Log or update a single set. Upserts on `(session_id, exercise_id, set_number)`.

**Request body:**

```json
{
  "session_id": "uuid",
  "exercise_id": "uuid",
  "set_number": 1,
  "weight_kg": 80.0,
  "reps_actual": 8,
  "completed": true
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `session_id` | UUID | yes | Session to log under |
| `exercise_id` | UUID | yes | Exercise within the program |
| `set_number` | integer | yes | 1-indexed set number |
| `weight_kg` | number or null | no | Weight used |
| `reps_actual` | integer or null | no | Reps completed |
| `completed` | boolean | no | Whether the set was completed |

**Response `200`:** `{ "id": "uuid" }`

---

### Settings

Settings are per-user key/value pairs stored server-side.

#### `GET /settings`

Return all settings for the current user as a flat object.

**Response `200`:**

```json
{
  "ai_provider": "claude",
  "ai_review_time": "20:00",
  "pantry_expiration_webhook": "https://discord.com/...",
  "nutrition_goals": "{\"calories\":2000,\"protein\":150,...}",
  "meal_plan_weeks": "2"
}
```

---

#### `PUT /settings`

Set a single key/value pair. Upserts.

**Request body:**

```json
{ "key": "ai_review_time", "value": "20:00" }
```

**Response `200`:** `{ "ok": true }`

See [Settings Keys](#settings-keys) for all supported keys.

---

### AI Review

The AI review reads your food log and macros for the day, sends them to Claude or OpenAI, and posts the response to your Discord webhook.

#### `POST /ai-review/run`

Trigger an AI review immediately.

**Request body:** (all optional)

```json
{
  "custom_prompt": "Was today a good day nutrition-wise?",
  "date": "2025-01-01"
}
```

**Response `200`:**

```json
{
  "ok": true,
  "text": "Great job hitting your protein goal today...",
  "provider": "claude",
  "date": "2025-01-01",
  "run_at": "2025-01-01T20:00:00Z"
}
```

---

#### `GET /ai-review/last`

Return the most recent AI review for the current user.

**Response `200`:** Same shape as the `run` response, or `null` if none exists.

---

### Data Export & Import

#### `GET /data/export`

Export all user data as a single JSON object (food items, recipes, log entries, body weights, activity, pantry, nudges, workout programs, meal plan).

**Response `200`:** Large JSON object suitable for backup and re-import.

---

#### `GET /data/export/markdown`

Export the food log as a human-readable Markdown document.

**Response `200`:** `text/markdown`

---

#### `POST /data/import`

Import a previously exported JSON blob. Upserts all records.

**Request body:** The JSON object from `GET /data/export`.

**Response `200`:** `{ "imported_rows": 142 }`

---

## Data Objects

### `FoodItem`

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Unique identifier |
| `name` | string | Display name |
| `brand` | string | Brand name (may be empty) |
| `serving_label` | string | Human-readable serving description, e.g. `"100g"` or `"1 cup"` |
| `calories_per_serving` | number | kcal per serving |
| `protein_g_per_serving` | number | Protein in grams |
| `carbs_g_per_serving` | number | Carbohydrates in grams |
| `fat_g_per_serving` | number | Fat in grams |
| `fiber_g_per_serving` | number | Fiber in grams |

### `LogEntry`

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Entry ID |
| `meal` | string | `breakfast`, `lunch`, `dinner`, `snack_1`, `snack_2`, etc. |
| `food_item_id` | UUID | Reference to the food item |
| `food_name` | string | Denormalised name at time of log |
| `serving_label` | string | Serving description |
| `servings` | number | Number of servings consumed |
| `calories` | number | Total calories (servings × per-serving) |
| `protein_g` | number | Total protein |
| `carbs_g` | number | Total carbs |
| `fat_g` | number | Total fat |
| `fiber_g` | number | Total fiber |
| `occurred_at` | RFC3339 timestamp | When the food was consumed |

### `RecipeSummary`

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Shared with the food item |
| `name` | string | Recipe name |
| `brand` | string | Brand (usually empty) |
| `serving_label` | string | e.g. `"1 bowl"` |
| `instructions` | string | Markdown instructions |
| `yield_count` | integer | Servings the recipe makes |
| `calories_per_serving` | number | Per serving macros |
| `ingredient_count` | integer | Number of ingredient lines |
| `created_at` | RFC3339 timestamp | Creation time |

### `WorkoutProgram`

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Program ID |
| `name` | string | Program name |
| `days` | integer[] | Weekdays (0=Sun … 6=Sat) |
| `exercises` | `WorkoutExercise[]` | Ordered exercise list |
| `created_at` | RFC3339 timestamp | |

### `WorkoutExercise`

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Exercise ID |
| `program_id` | UUID | Parent program |
| `name` | string | Exercise name |
| `sets` | integer | Target set count |
| `reps_min` | integer | Rep range lower bound |
| `reps_max` | integer | Rep range upper bound |
| `sort_order` | integer | Display order within program |

### `Nudge`

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Nudge ID |
| `food_item_id` | UUID | Food item to watch |
| `food_name` | string | Denormalised name |
| `remind_at` | `HH:MM` string | Time to fire if not logged |
| `webhook_url` | string | Discord webhook URL |
| `enabled` | boolean | Active/paused |
| `logged_today` | boolean | Whether the food was already logged today |

---

## Database Schema

All tables live in a single PostgreSQL database. The schema is applied via `schema.sql` embedded in the API binary and run on every boot (idempotent with `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ADD COLUMN IF NOT EXISTS`).

| Table | Key columns | Notes |
|---|---|---|
| `users` | `id`, `email`, `password_hash`, `display_name` | bcrypt-hashed password; local user seeded on first boot |
| `food_items` | `id`, `user_id`, `name`, `brand`, `serving_label`, macros | `source = 'custom'` for all user-created items |
| `recipes` | `id` (= food_item id), `user_id`, `instructions`, `yield_count` | 1:1 with food_items |
| `recipe_ingredients` | `recipe_id`, `food_item_id`, `amount_g` | Sub-ingredient breakdown in grams |
| `recipe_shopping_items` | `recipe_id`, `name`, `amount`, `unit`, `sort_order` | Free-text shopping lines |
| `recipe_photos` | `recipe_id`, `photo_data` (base64) | One photo per recipe |
| `log_entries` | `user_id`, `occurred_at`, `kind`, `ref_id`, `servings`, `meal` | `kind = 'food'`; `ref_id` = food_item id |
| `body_weights` | `user_id`, `measured_at`, `weight_kg` | Append-only measurements |
| `daily_activity` | `user_id`, `date`, `steps`, `active_calories_kcal_est`, `water_glasses` | UNIQUE(user_id, date) |
| `pantry_items` | `user_id`, `food_item_id`, `quantity`, `expires_at` | UNIQUE(user_id, food_item_id) |
| `ingredient_categories` | `user_id`, `ingredient_name`, `category_slug` | Shopping list grouping |
| `nudges` | `user_id`, `food_item_id`, `remind_at`, `webhook_url`, `enabled` | UNIQUE(user_id, food_item_id) |
| `user_settings` | `user_id`, `key`, `value` | Key/value store; PK = (user_id, key) |
| `presets` | `user_id`, `name` | |
| `preset_items` | `preset_id`, `kind`, `ref_id`, `servings` | |
| `workout_programs` | `user_id`, `name`, `days` | `days` stored as comma-separated integers |
| `workout_program_exercises` | `program_id`, `name`, `sets`, `reps_min`, `reps_max`, `sort_order` | |
| `workout_sessions` | `user_id`, `program_id`, `date` | UNIQUE(user_id, program_id, date) |
| `workout_session_sets` | `session_id`, `exercise_id`, `set_number`, `weight_kg`, `reps_actual`, `completed` | UNIQUE(session_id, exercise_id, set_number) |
| `meal_plan_entries` | `user_id`, `date`, `meal`, `food_item_id`, `servings` | |

---

## Settings Keys

All keys are stored via `PUT /settings` as strings and read back via `GET /settings`.

| Key | Example value | Description |
|---|---|---|
| `nutrition_goals` | `{"calories":2000,"protein":150,"carbs":200,"fat":65,"fiber":30}` | JSON-encoded daily macro targets |
| `ai_provider` | `claude` or `openai` | Which AI provider to use for daily reviews |
| `ai_api_key` | `sk-ant-...` | API key — stored in browser localStorage, never sent to the Intake server |
| `ai_review_time` | `20:00` | HH:MM time for the daily automated AI review |
| `ai_custom_prompt` | `"Was today..."` | Optional custom prompt (replaces default macro summary task) |
| `pantry_expiration_webhook` | `https://discord.com/api/webhooks/...` | Discord webhook for pantry expiration and AI review posts |
| `meal_plan_weeks` | `2` | How many weeks to include in the ICS export |
| `meal_plan_breakfast_time` | `08:00` | Time used for breakfast entries in the ICS export |
| `meal_plan_lunch_time` | `12:30` | Time for lunch entries |
| `meal_plan_dinner_time` | `19:00` | Time for dinner entries |

---

## Scheduled Jobs

The API runs three background jobs via gocron:

| Job | Schedule | What it does |
|---|---|---|
| **Nudge checker** | Every 1 minute | For each enabled nudge whose `remind_at` falls in the last minute, checks if the food item has been logged today. If not, fires the Discord webhook. |
| **Pantry expiration** | Daily at 8:00am | For each user with a `pantry_expiration_webhook`, finds items expiring today or tomorrow and sends a Discord alert. |
| **AI review** | Every 1 minute | Checks if any user's `ai_review_time` falls in the current minute and hasn't been run today. If so, runs the AI review and posts to Discord. |

All jobs run in the timezone configured by `APP_TIMEZONE`.

---

## Notes

- **Water tracker** — stored in the database (not `localStorage`) since the auth rewrite. Syncs across devices.
- **Pantry deduction** — fires as a non-blocking call when logging food. Silently no-ops if the food item isn't tracked in the pantry.
- **Recipe = food item** — every recipe shares a UUID with its food item. You log recipes by logging their food item.
- **Macro rounding** — macros are stored as `NUMERIC` (arbitrary precision) and returned as floats. Display rounding happens on the frontend.
- **No mobile app** — web only, but the UI is mobile-first responsive with a bottom nav on small screens.
- **API docs** — full OpenAPI 3.1 spec at [`api/openapi.yaml`](api/openapi.yaml), rendered via [GitHub Pages](https://michaeldvinci.github.io/intake/).
