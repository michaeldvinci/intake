// AI review is now handled server-side by the Go API.
// This module provides helpers for the settings page to interact with those endpoints.

import { AI_LAST_REVIEW_KEY, AIReviewResult } from "./settings";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

export async function triggerAIReview(customPrompt?: string): Promise<AIReviewResult> {
  const res = await fetch(`${API}/ai-review/run?user_id=${USER_ID}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ custom_prompt: customPrompt ?? "" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error ?? `AI review failed (${res.status})`);
  }
  const data = await res.json();
  const result: AIReviewResult = {
    date: data.date,
    provider: data.provider,
    runAt: new Date().toISOString(),
    text: data.text,
  };
  // Mirror to localStorage so the result survives a page reload without an extra fetch
  localStorage.setItem(AI_LAST_REVIEW_KEY, JSON.stringify(result));
  return result;
}

export async function fetchLastAIReview(): Promise<AIReviewResult | null> {
  const res = await fetch(`${API}/ai-review/last?user_id=${USER_ID}`);
  if (!res.ok) return null;
  const data = await res.json();
  if (!data) return null;
  return data as AIReviewResult;
}
