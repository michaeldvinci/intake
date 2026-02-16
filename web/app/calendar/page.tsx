"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { todayISOInAppTZ } from "../lib/date";

const USER_ID = "00000000-0000-0000-0000-000000000001";
const API = "/api";

type DayTotal = { date: string; calories: number };

function daysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}
function firstDayOfWeek(year: number, month: number) {
  return new Date(year, month, 1).getDay(); // 0=Sun
}
function toDateStr(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAY_NAMES = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

export default function CalendarPage() {
  const router = useRouter();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [totals, setTotals] = useState<Record<string, number>>({});

  useEffect(() => {
    const from = toDateStr(year, month, 1);
    const to = toDateStr(year, month, daysInMonth(year, month));
    fetch(`${API}/log/range?user_id=${USER_ID}&from=${from}&to=${to}`)
      .then(r => r.ok ? r.json() : [])
      .then((data: DayTotal[]) => {
        const map: Record<string, number> = {};
        data.forEach(d => { map[d.date] = d.calories; });
        setTotals(map);
      })
      .catch(() => {});
  }, [year, month]);

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11); }
    else setMonth(m => m - 1);
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0); }
    else setMonth(m => m + 1);
  }

  const totalDays = daysInMonth(year, month);
  const startPad = firstDayOfWeek(year, month);
  const todayStr = todayISOInAppTZ(now);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 24 }}>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: "-0.5px", flex: 1 }}>Calendar</h1>
        <button className="btn btn-ghost" onClick={prevMonth} style={{ padding: "6px 14px" }}>‹</button>
        <span style={{ fontWeight: 700, fontSize: 16, minWidth: 160, textAlign: "center" }}>
          {MONTH_NAMES[month]} {year}
        </span>
        <button className="btn btn-ghost" onClick={nextMonth} style={{ padding: "6px 14px" }}>›</button>
      </div>

      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
        {/* Day headers */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: "1px solid var(--border)",
        }}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{
              padding: "10px 0", textAlign: "center",
              fontSize: 12, fontWeight: 700, color: "var(--muted)", letterSpacing: "0.05em",
            }}>{d}</div>
          ))}
        </div>

        {/* Day grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
          {/* Leading empty cells */}
          {Array.from({ length: startPad }).map((_, i) => (
            <div key={`pad-${i}`} style={{ borderBottom: "1px solid var(--border)", borderRight: "1px solid var(--border)", minHeight: 80 }} />
          ))}

          {Array.from({ length: totalDays }).map((_, i) => {
            const day = i + 1;
            const dateStr = toDateStr(year, month, day);
            const kcal = totals[dateStr];
            const isToday = dateStr === todayStr;
            const col = (startPad + i) % 7;

            return (
              <div
                key={day}
                onClick={() => router.push(`/?date=${dateStr}`)}
                style={{
                  minHeight: 80,
                  padding: "10px 12px",
                  borderBottom: "1px solid var(--border)",
                  borderRight: col < 6 ? "1px solid var(--border)" : undefined,
                  cursor: "pointer",
                  background: isToday ? "var(--surface2)" : undefined,
                  transition: "background 0.15s",
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = "var(--surface2)"; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isToday ? "var(--surface2)" : ""; }}
              >
                <span style={{
                  fontSize: 13, fontWeight: isToday ? 800 : 500,
                  color: isToday ? "var(--accent)" : "var(--text)",
                  width: 24, height: 24, display: "flex", alignItems: "center", justifyContent: "center",
                  borderRadius: "50%",
                  background: isToday ? "rgba(108,99,255,0.15)" : undefined,
                }}>{day}</span>
                {kcal !== undefined && (
                  <span style={{ fontSize: 11, color: "var(--muted)", fontWeight: 600 }}>
                    {Math.round(kcal)} kcal
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
