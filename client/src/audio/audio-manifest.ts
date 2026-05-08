// client/src/audio/audio-manifest.ts
// Audio assets for HUNTED. Files live under public/audio/.
// Sound IDs marked spatial: true play through the SpatialAudio system,
// which positions them in 3D and applies HRTF panning + distance falloff.
// Global sounds (UI, ambient, heartbeat) stay 2D — they represent state,
// not a world position.

export type SoundId =
  | "ambient_loop"
  | "ambient_wind"
  | "static_drone"
  | "breath_panic"
  | "heartbeat_loop"
  // Legacy footstep variants (kept for fallback when surface-specific files
  // are missing — see FootstepSystem).
  | "footstep_wood_1"
  | "footstep_wood_2"
  | "footstep_wood_3"
  | "footstep_wood_4"
  // Surface-specific footstep variants (Batch 11). Wood reuses the existing
  // footstep_wood_* clips; carpet/stone/creaky 404 to the procedural fallback.
  | "step_wood_1"
  | "step_wood_2"
  | "step_carpet_1"
  | "step_carpet_2"
  | "step_stone_1"
  | "step_stone_2"
  | "step_creaky_1"
  | "step_creaky_2"
  | "key_pickup"
  | "key_sparkle"
  | "door_creak"
  | "observer_moan_1"
  | "observer_moan_2"
  | "observer_breathing"
  | "observer_stalk"
  | "jump_scare_sting"
  | "static_burst";

export type SoundDef = {
  src: string[];
  loop?: boolean;
  volume: number;
  category: "ambient" | "player" | "entity" | "sting";
  // Spatial-audio knobs. When `spatial` is true the sound plays through
  // SpatialAudio with HRTF panning and distance falloff.
  spatial?: boolean;
  refDistance?: number; // distance at which volume = 1.0
  rolloffFactor?: number; // higher = faster falloff (default 1)
  maxDistance?: number; // beyond this, sound is silent
};

export const AUDIO_MANIFEST: Record<SoundId, SoundDef> = {
  ambient_loop: {
    src: ["/audio/ambient_loop.ogg"],
    loop: true,
    volume: 0.06,
    category: "ambient",
  },
  ambient_wind: {
    src: ["/audio/ambient_wind.ogg", "/audio/ambient_wind.mp3"],
    loop: true,
    volume: 0.0, // driven dynamically by tickAmbient
    category: "ambient",
  },
  static_drone: {
    src: ["/audio/static_drone.ogg", "/audio/static_drone.mp3"],
    loop: true,
    volume: 0.12,
    category: "ambient",
  },
  breath_panic: {
    src: ["/audio/breath_panic.ogg"],
    loop: true,
    volume: 0.0,
    category: "player",
  },
  heartbeat_loop: {
    // Stays loop: false in the manifest; setHeartbeatProximity flips
    // `.loop(true)` programmatically once it's playing.
    src: ["/audio/heartbeat_loop.ogg"],
    loop: false,
    volume: 0.0, // driven dynamically by setHeartbeatProximity
    category: "player",
  },
  footstep_wood_1: {
    src: ["/audio/footstep_wood_1.ogg"],
    volume: 0.22,
    category: "player",
  },
  footstep_wood_2: {
    src: ["/audio/footstep_wood_2.ogg"],
    volume: 0.22,
    category: "player",
  },
  footstep_wood_3: {
    src: ["/audio/footstep_wood_3.ogg"],
    volume: 0.22,
    category: "player",
  },
  footstep_wood_4: {
    src: ["/audio/footstep_wood_4.ogg"],
    volume: 0.22,
    category: "player",
  },
  // Surface-specific variants. Wood reuses the existing footstep clips so
  // they don't fall through to procedural; the others 404 cleanly and use
  // proceduralStep with surface-specific tone shaping.
  step_wood_1: {
    src: ["/audio/footstep_wood_1.ogg"],
    volume: 0.4,
    category: "player",
  },
  step_wood_2: {
    src: ["/audio/footstep_wood_2.ogg"],
    volume: 0.4,
    category: "player",
  },
  step_carpet_1: {
    src: ["/audio/step_carpet_1.ogg", "/audio/step_carpet_1.mp3"],
    volume: 0.25,
    category: "player",
  },
  step_carpet_2: {
    src: ["/audio/step_carpet_2.ogg", "/audio/step_carpet_2.mp3"],
    volume: 0.25,
    category: "player",
  },
  step_stone_1: {
    src: ["/audio/step_stone_1.ogg", "/audio/step_stone_1.mp3"],
    volume: 0.45,
    category: "player",
  },
  step_stone_2: {
    src: ["/audio/step_stone_2.ogg", "/audio/step_stone_2.mp3"],
    volume: 0.45,
    category: "player",
  },
  step_creaky_1: {
    src: ["/audio/step_creaky_1.ogg", "/audio/step_creaky_1.mp3"],
    volume: 0.55,
    category: "player",
  },
  step_creaky_2: {
    src: ["/audio/step_creaky_2.ogg", "/audio/step_creaky_2.mp3"],
    volume: 0.55,
    category: "player",
  },
  key_pickup: {
    src: ["/audio/key_pickup.ogg"],
    volume: 0.5,
    category: "sting",
  },
  key_sparkle: {
    src: ["/audio/key_sparkle.ogg", "/audio/key_sparkle.mp3"],
    loop: true,
    volume: 0.35,
    category: "ambient",
    spatial: true,
    refDistance: 1.0,
    rolloffFactor: 2.0,
    maxDistance: 8,
  },
  door_creak: {
    src: ["/audio/door_creak.ogg"],
    volume: 0.6,
    category: "ambient",
    spatial: true,
    refDistance: 2.5,
    rolloffFactor: 1.0,
    maxDistance: 14,
  },
  observer_moan_1: {
    src: ["/audio/observer_moan_1.mp3"],
    volume: 0.7,
    category: "entity",
    spatial: true,
    refDistance: 3.0,
    rolloffFactor: 1.0,
    maxDistance: 22,
  },
  observer_moan_2: {
    src: ["/audio/observer_moan_2.mp3"],
    volume: 0.7,
    category: "entity",
    spatial: true,
    refDistance: 3.0,
    rolloffFactor: 1.0,
    maxDistance: 22,
  },
  observer_breathing: {
    src: ["/audio/observer_breathing.mp3"],
    loop: true,
    volume: 0.6,
    category: "entity",
    spatial: true,
    refDistance: 2.0,
    rolloffFactor: 1.2,
    maxDistance: 16,
  },
  observer_stalk: {
    src: ["/audio/observer_stalk.ogg"],
    loop: true,
    volume: 0.4,
    category: "entity",
    spatial: true,
    refDistance: 1.5,
    rolloffFactor: 1.5,
    maxDistance: 12,
  },
  jump_scare_sting: {
    src: ["/audio/jump_scare_sting.ogg"],
    volume: 0.85,
    category: "sting",
  },
  static_burst: {
    src: ["/audio/static_burst.ogg"],
    volume: 0.5,
    category: "sting",
    spatial: true,
    refDistance: 2.0,
    rolloffFactor: 1.2,
    maxDistance: 12,
  },
};

export const FOOTSTEP_POOL: SoundId[] = [
  "footstep_wood_1",
  "footstep_wood_2",
  "footstep_wood_3",
  "footstep_wood_4",
];
