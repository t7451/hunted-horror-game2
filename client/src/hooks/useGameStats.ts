const STORAGE_KEY = "hunted_stats_v1";

export interface RunRecord {
  difficulty: string;
  result: "escaped" | "caught";
  timeUsed: number;
  timestamp: number;
}

export interface GameStats {
  runs: RunRecord[];
  bestTimes: Record<string, number>;
  escapedCount: number;
  caughtCount: number;
}

const EMPTY: GameStats = {
  runs: [],
  bestTimes: {},
  escapedCount: 0,
  caughtCount: 0,
};

export function loadStats(): GameStats {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    return { ...EMPTY, ...JSON.parse(raw) };
  } catch {
    return EMPTY;
  }
}

export function recordRun(
  difficulty: string,
  result: "escaped" | "caught",
  maxTime: number,
  timeLeft: number
): { stats: GameStats; isNewBest: boolean } {
  const stats = loadStats();
  const timeUsed = Math.round(maxTime - timeLeft);

  const run: RunRecord = {
    difficulty,
    result,
    timeUsed,
    timestamp: Date.now(),
  };
  stats.runs = [run, ...stats.runs].slice(0, 50);

  let isNewBest = false;
  if (result === "escaped") {
    stats.escapedCount += 1;
    const prev = stats.bestTimes[difficulty];
    if (prev === undefined || timeUsed < prev) {
      stats.bestTimes[difficulty] = timeUsed;
      isNewBest = true;
    }
  } else {
    stats.caughtCount += 1;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stats));
  } catch {
    /* storage full — stats still returned in-memory */
  }

  return { stats, isNewBest };
}

export function clearStats(): void {
  localStorage.removeItem(STORAGE_KEY);
}
