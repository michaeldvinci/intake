"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { DEFAULT_NUTRITION_GOALS, NUTRITION_GOALS_KEY } from "../lib/settings";

export type NutritionGoals = {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  fiber: number;
};

type Ctx = {
  goals: NutritionGoals;
  setGoals: (goals: NutritionGoals) => void;
};

const NutritionGoalsContext = createContext<Ctx>({
  goals: DEFAULT_NUTRITION_GOALS,
  setGoals: () => {},
});

export function NutritionGoalsProvider({ children }: { children: React.ReactNode }) {
  const [goals, setGoalsState] = useState<NutritionGoals>(DEFAULT_NUTRITION_GOALS);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(NUTRITION_GOALS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setGoalsState({ ...DEFAULT_NUTRITION_GOALS, ...parsed });
      }
    } catch {
      // ignore malformed stored data
    }
  }, []);

  function setGoals(next: NutritionGoals) {
    setGoalsState(next);
    localStorage.setItem(NUTRITION_GOALS_KEY, JSON.stringify(next));
  }

  return (
    <NutritionGoalsContext.Provider value={{ goals, setGoals }}>
      {children}
    </NutritionGoalsContext.Provider>
  );
}

export function useNutritionGoals() {
  return useContext(NutritionGoalsContext);
}
