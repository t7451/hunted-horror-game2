const STORAGE_KEY = "hunted_daily_v1";

export function getDailySeed(): number {
  const d = new Date();
  const ymd =
    d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
  let h = ymd >>> 0;
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

export function getDailyId(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export type DailyResult = {
  date: string;
  result: "escaped" | "caught";
  timeUsed: number;
};

export function getDailyResult(): DailyResult | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as DailyResult;
    if (stored.date !== getDailyId()) return null;
    return stored;
  } catch {
    return null;
  }
}

export function saveDailyResult(
  result: "escaped" | "caught",
  timeUsed: number
): void {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        date: getDailyId(),
        result,
        timeUsed,
      })
    );
  } catch {
    /* storage full */
  }
}

export function shareString(result: DailyResult): string {
  const min = Math.floor(result.timeUsed / 60);
  const sec = Math.round(result.timeUsed % 60);
  const icon = result.result === "escaped" ? "🟩" : "🟥";
  return `HUNTED daily ${result.date}\n${icon} ${result.result} in ${min}:${String(sec).padStart(2, "0")}\n${typeof window !== "undefined" ? window.location.origin : ""}`;
}
