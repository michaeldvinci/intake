// Default values for nutrition goals (used when no user preference is stored)
export const DEFAULT_NUTRITION_GOALS = {
  calories: 2200,
  protein: 180,
  carbs: 220,
  fat: 70,
  fiber: 30,
};

export const NUTRITION_GOALS_KEY = "intake_nutrition_goals";

// AI daily review
export const AI_PROVIDER_KEY = "intake_ai_provider";
export const AI_KEY_KEY = "intake_ai_key";
export const AI_REVIEW_TIME_KEY = "intake_ai_review_time";
export const AI_LAST_REVIEW_KEY = "intake_ai_last_review";

export type AIProvider = "claude" | "openai";

export type AIReviewResult = {
  date: string;    // YYYY-MM-DD
  provider: AIProvider;
  runAt: string;   // ISO timestamp
  text: string;
};
