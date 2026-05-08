export type DirectorDanger = "safe" | "near" | "critical";
export type DirectorEvent =
  | "ready"
  | "keyPickup"
  | "timerWarning"
  | "dangerChange"
  | "hideChange"
  | "tick";

export type DirectorSnapshot = {
  mapName: string;
  difficulty: number;
  keysRemaining: number;
  totalKeys: number;
  timeLeft: number;
  maxTime: number;
  danger: DirectorDanger;
  hidden: boolean;
  sprinting: boolean;
  moving: boolean;
  enemyDistance: number | null;
};

export type DirectorUpdate = {
  tension: number;
  enemySpeedMultiplier: number;
  reason: string;
  hint?: string;
};

type DirectorMemory = {
  lastHintAt: number;
  lastEvent: DirectorEvent | null;
  current: DirectorUpdate;
};

const DEFAULT_UPDATE: DirectorUpdate = {
  tension: 0.35,
  enemySpeedMultiplier: 1,
  reason: "calibrating",
};

const HINT_COOLDOWN_MS = 8_000;

export function createAIDirector() {
  const memory: DirectorMemory = {
    lastHintAt: 0,
    lastEvent: null,
    current: DEFAULT_UPDATE,
  };

  function trigger(
    event: DirectorEvent,
    snapshot: DirectorSnapshot,
    now = performance.now()
  ): DirectorUpdate {
    const progress =
      snapshot.totalKeys === 0
        ? 1
        : (snapshot.totalKeys - snapshot.keysRemaining) / snapshot.totalKeys;
    const urgency =
      1 - Math.max(0, Math.min(1, snapshot.timeLeft / snapshot.maxTime));
    const proximity = proximityScore(snapshot.danger, snapshot.enemyDistance);
    const stealthRelief = snapshot.hidden ? -0.22 : 0;
    const sprintPressure = snapshot.sprinting && snapshot.moving ? 0.08 : 0;
    const tension = clamp01(
      0.18 +
        progress * 0.28 +
        urgency * 0.26 +
        proximity * 0.36 +
        sprintPressure +
        stealthRelief
    );

    const behindSchedule = urgency - progress;
    const difficultyPressure = (snapshot.difficulty - 1) * 0.04;
    const dangerBrake =
      snapshot.danger === "critical" && !snapshot.hidden ? -0.06 : 0;
    const enemySpeedMultiplier = clamp(
      1 +
        progress * 0.12 -
        Math.max(0, behindSchedule) * 0.18 +
        difficultyPressure +
        dangerBrake,
      0.82,
      1.22
    );

    const reason = buildReason(snapshot, progress, urgency, tension);
    const hint = selectHint(event, snapshot, progress, urgency, tension);
    const shouldEmitHint =
      !!hint &&
      (event !== memory.lastEvent ||
        now - memory.lastHintAt >= HINT_COOLDOWN_MS ||
        isMajorEvent(event));

    if (shouldEmitHint) {
      memory.lastHintAt = now;
    }
    memory.lastEvent = event;

    memory.current = {
      tension,
      enemySpeedMultiplier,
      reason,
      hint: shouldEmitHint ? hint : undefined,
    };
    return memory.current;
  }

  function current() {
    return memory.current;
  }

  return { trigger, current };
}

function proximityScore(danger: DirectorDanger, enemyDistance: number | null) {
  if (danger === "critical") return 1;
  if (danger === "near") return 0.62;
  if (enemyDistance === null) return 0.15;
  return clamp01(1 - enemyDistance / 28) * 0.5;
}

function buildReason(
  snapshot: DirectorSnapshot,
  progress: number,
  urgency: number,
  tension: number
) {
  if (snapshot.hidden) return "stealth recovery";
  if (snapshot.danger === "critical") return "close pursuit";
  if (snapshot.keysRemaining === 0) return "exit pressure";
  if (urgency > progress + 0.28) return "helping a struggling run";
  if (tension > 0.72) return "high tension";
  return "adaptive pacing";
}

function selectHint(
  event: DirectorEvent,
  snapshot: DirectorSnapshot,
  progress: number,
  urgency: number,
  tension: number
) {
  if (event === "ready") {
    return `${snapshot.mapName} is watching. Collect keys quietly and use closets to break pursuit.`;
  }
  if (event === "keyPickup") {
    if (snapshot.keysRemaining === 0)
      return "The house exhales. Every key is yours; find the green exit.";
    return `${snapshot.keysRemaining} key${snapshot.keysRemaining === 1 ? "" : "s"} remain. Your path has been noticed.`;
  }
  if (event === "hideChange") {
    return snapshot.hidden
      ? "The director dampens the chase while you hide. Wait for distance."
      : "You left cover. Move before The Observer reacquires your trail.";
  }
  if (event === "dangerChange") {
    if (snapshot.danger === "critical")
      return "Critical pursuit: break line, stop sprinting, or hide now.";
    if (snapshot.danger === "near")
      return "The Observer heard you nearby. Use turns and closets to lower pressure.";
    return "The immediate danger faded. Search the next room.";
  }
  if (event === "timerWarning" || urgency > progress + 0.35) {
    return "The director is easing pursuit slightly; prioritize unexplored rooms.";
  }
  if (tension > 0.78 && snapshot.keysRemaining > 0) {
    return "Pressure is peaking. A short hide can reset the chase tempo.";
  }
  return undefined;
}

function isMajorEvent(event: DirectorEvent) {
  return event === "ready" || event === "keyPickup" || event === "timerWarning";
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}
