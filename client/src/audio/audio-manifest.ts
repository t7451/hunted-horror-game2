// client/src/audio/audio-manifest.ts
// 15 CC0 audio assets sourced from OpenGameArt.org and ffmpeg synthesis.
// All files are in public/audio/ — OGG for most, MP3 for ghost moans.
// Sources:
//   ambient_loop, observer_stalk   — dark_ambiences.zip (CC0, Ogrebane, OGA)
//   heartbeat_loop                 — heartbeat_slow_0.wav (CC0, yd, OGA)
//   observer_moan_1/2/breathing    — qubodup-GhostMoans.zip (CC0, qubodup, OGA)
//   jump_scare_sting, static_burst — horror_sfx.zip (CC0, TinyWorlds, OGA)
//   footstep_wood_1..4             — footsteps.zip leather steps (CC0, nicubunu, OGA)
//   key_pickup                     — step_metal.ogg (CC0, nicubunu, OGA)
//   breath_panic, door_creak       — ffmpeg synthesized (CC0)

export type SoundId =
  | "ambient_loop"
  | "breath_panic"
  | "heartbeat_loop"
  | "footstep_wood_1"
  | "footstep_wood_2"
  | "footstep_wood_3"
  | "footstep_wood_4"
  | "key_pickup"
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
};

export const AUDIO_MANIFEST: Record<SoundId, SoundDef> = {
  ambient_loop: {
    src: ["/audio/ambient_loop.ogg"],
    loop: true,
    volume: 0.06,
    category: "ambient",
  },
  breath_panic: {
    src: ["/audio/breath_panic.ogg"],
    loop: true,
    volume: 0.0,
    category: "player",
  },
  heartbeat_loop: {
    src: ["/audio/heartbeat_loop.ogg"],
    loop: false,
    volume: 0.5,
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
  key_pickup: {
    src: ["/audio/key_pickup.ogg"],
    volume: 0.5,
    category: "sting",
  },
  door_creak: {
    src: ["/audio/door_creak.ogg"],
    volume: 0.4,
    category: "ambient",
  },
  observer_moan_1: {
    src: ["/audio/observer_moan_1.mp3"],
    volume: 0.35,
    category: "entity",
  },
  observer_moan_2: {
    src: ["/audio/observer_moan_2.mp3"],
    volume: 0.35,
    category: "entity",
  },
  observer_breathing: {
    src: ["/audio/observer_breathing.mp3"],
    loop: true,
    volume: 0.0,
    category: "entity",
  },
  observer_stalk: {
    src: ["/audio/observer_stalk.ogg"],
    loop: true,
    volume: 0.0,
    category: "entity",
  },
  jump_scare_sting: {
    src: ["/audio/jump_scare_sting.ogg"],
    volume: 0.85,
    category: "sting",
  },
  static_burst: {
    src: ["/audio/static_burst.ogg"],
    volume: 0.4,
    category: "sting",
  },
};

export const FOOTSTEP_POOL: SoundId[] = [
  "footstep_wood_1",
  "footstep_wood_2",
  "footstep_wood_3",
  "footstep_wood_4",
];
