export const APP_TIMEZONE = process.env.NEXT_PUBLIC_APP_TIMEZONE || "UTC";

function appDateTimeFormatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    ...options,
  });
}

function extractParts(now: Date, options: Intl.DateTimeFormatOptions) {
  const parts = appDateTimeFormatter(options).formatToParts(now);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function timeZoneOffsetMinutes(at: Date): number {
  const parts = extractParts(at, {
    timeZoneName: "shortOffset",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const tzName = parts.timeZoneName || "GMT";
  if (tzName === "GMT" || tzName === "UTC") return 0;

  const match = tzName.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/);
  if (!match) return 0;

  const sign = match[1] === "-" ? -1 : 1;
  const hours = Number(match[2]);
  const minutes = Number(match[3] || "0");
  return sign * (hours * 60 + minutes);
}

export function appDateParts(now: Date = new Date()) {
  const parts = extractParts(now, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
  };
}

export function todayISOInAppTZ(now: Date = new Date()): string {
  const { year, month, day } = appDateParts(now);
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function addDaysISO(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + deltaDays);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function diffDaysISO(from: string, to: string): number {
  const [fromY, fromM, fromD] = from.split("-").map(Number);
  const [toY, toM, toD] = to.split("-").map(Number);
  const fromUTC = Date.UTC(fromY, fromM - 1, fromD);
  const toUTC = Date.UTC(toY, toM - 1, toD);
  return Math.floor((toUTC - fromUTC) / 86400000);
}

export function formatDateInAppTZ(
  dateStr: string,
  options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" },
): string {
  return appDateTimeFormatter(options).format(noonInAppTZ(dateStr));
}

export function noonInAppTZ(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const firstOffset = timeZoneOffsetMinutes(utcGuess);
  const firstPass = new Date(utcGuess.getTime() - firstOffset * 60000);
  const secondOffset = timeZoneOffsetMinutes(firstPass);
  return new Date(utcGuess.getTime() - secondOffset * 60000);
}
