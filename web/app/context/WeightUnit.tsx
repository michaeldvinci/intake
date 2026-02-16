"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type WeightUnit = "lbs" | "kg";

const STORAGE_KEY = "intake_weight_unit";

type Ctx = { unit: WeightUnit; setUnit: (unit: WeightUnit) => void; toggleUnit: () => void };
const WeightUnitContext = createContext<Ctx>({
  unit: "lbs",
  setUnit: () => {},
  toggleUnit: () => {},
});

export function WeightUnitProvider({ children }: { children: React.ReactNode }) {
  const [unit, setUnit] = useState<WeightUnit>("lbs");

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "kg" || stored === "lbs") setUnit(stored);
  }, []);

  function setStoredUnit(next: WeightUnit) {
    setUnit(next);
    localStorage.setItem(STORAGE_KEY, next);
  }

  function toggleUnit() {
    setStoredUnit(unit === "lbs" ? "kg" : "lbs");
  }

  return (
    <WeightUnitContext.Provider value={{ unit, setUnit: setStoredUnit, toggleUnit }}>
      {children}
    </WeightUnitContext.Provider>
  );
}

export function useWeightUnit() {
  return useContext(WeightUnitContext);
}

export const LBS_PER_KG = 2.20462;

export function toKg(value: number, unit: WeightUnit): number {
  return unit === "lbs" ? value / LBS_PER_KG : value;
}

export function fromKg(value: number, unit: WeightUnit): number {
  return unit === "lbs" ? value * LBS_PER_KG : value;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  const v = fromKg(kg, unit);
  return `${v.toFixed(1)} ${unit}`;
}
