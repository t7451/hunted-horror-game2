export type RenderTier = "low" | "mid" | "high";

export type RenderPreset = {
  tier: RenderTier;
  toneMappingExposure: number;
  ambientFloor: number;
  hemisphereIntensity: number;
  fogDensity: number;
  lampIntensity: number;
  lampDistance: number;
  notes: string;
};

const PRESETS: Record<RenderTier, RenderPreset> = {
  low: {
    tier: "low",
    toneMappingExposure: 0.78,
    ambientFloor: 0.08,
    hemisphereIntensity: 0.16,
    fogDensity: 0.045,
    lampIntensity: 0.85,
    lampDistance: 6.5,
    notes: "Balanced for mobile and battery-saver modes.",
  },
  mid: {
    tier: "mid",
    toneMappingExposure: 0.88,
    ambientFloor: 0.09,
    hemisphereIntensity: 0.18,
    fogDensity: 0.042,
    lampIntensity: 0.95,
    lampDistance: 7.5,
    notes: "Default quality profile for brighter readability.",
  },
  high: {
    tier: "high",
    toneMappingExposure: 0.9,
    ambientFloor: 0.1,
    hemisphereIntensity: 0.2,
    fogDensity: 0.04,
    lampIntensity: 1.1,
    lampDistance: 8.5,
    notes: "Highest fidelity profile with stronger practical lights.",
  },
};
const MAX_PLAYERS_PER_SESSION_FOR_HIGH_TIER = 4;

export function normalizeRenderTier(value?: string): RenderTier {
  if (value === "low" || value === "mid" || value === "high") return value;
  return "mid";
}

export function getRenderPreset(tier?: string): RenderPreset {
  return PRESETS[normalizeRenderTier(tier)];
}

export function listRenderPresets(): RenderPreset[] {
  return [PRESETS.low, PRESETS.mid, PRESETS.high];
}

export function getRenderHelperScripts() {
  return [
    {
      id: "lighting-boost-v1",
      description: "Raises baseline ambient and practical lamp response.",
      applyTo: ["atmosphere", "lamps", "ceiling-fixtures"],
    },
    {
      id: "fog-balance-v1",
      description: "Reduces over-dark fog while preserving horror contrast.",
      applyTo: ["fog", "tone-mapping"],
    },
  ];
}

export function buildRenderDiagnostics(input: {
  sessions: number;
  players: number;
  uptime: number;
}) {
  const load = input.players / Math.max(1, input.sessions);
  const recommendedTier: RenderTier =
    load > MAX_PLAYERS_PER_SESSION_FOR_HIGH_TIER ? "mid" : "high";
  return {
    ...input,
    avgPlayersPerSession: Number(load.toFixed(2)),
    recommendedTier,
    preset: getRenderPreset(recommendedTier),
    helperScripts: getRenderHelperScripts(),
  };
}
