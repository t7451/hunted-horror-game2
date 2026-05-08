# Audio

Howler-backed audio bed for `client/src/audio/AudioWorld.ts`. Until these
files land, AudioWorld falls back to procedural WebAudio synthesis (the
pre-Howler implementation, preserved verbatim in the same class).

## Required files

```
public/assets/audio/
├── ambient/
│   └── house_drone_loop.ogg          # creaky-house ambient bed (loop, ~30-60s)
├── loops/
│   ├── heartbeat_loop.ogg            # single steady heartbeat (loop, 1-2s)
│   └── breath_panic_loop.ogg         # panicked breath (loop, ~3-5s)
├── footsteps/
│   ├── wood_step_01.ogg              # 4 variants, randomized per step
│   ├── wood_step_02.ogg
│   ├── wood_step_03.ogg
│   └── wood_step_04.ogg
├── stingers/
│   └── jump_scare_01.ogg             # one-shot, fires on catch
├── sfx/
│   ├── key_pickup_chime.ogg          # one-shot, fires on key collect
│   └── door_creak_01.ogg             # one-shot
└── entity/
    ├── entity_moan_01.ogg            # 2 variants, auto-fired on tension
    └── entity_moan_02.ogg
```

`.ogg` is preferred for size + Web Audio compatibility. Howler will also
accept `.mp3` if you swap the extensions in `AudioWorld.ts`.

## Sourcing from freesound.org (CC0)

All sounds below should be filtered to **CC0** license on freesound.org
search. Suggested queries — pick one that fits, trim/loop in Audacity:

| Slot                    | Search query                                   | Notes                                |
|-------------------------|------------------------------------------------|--------------------------------------|
| `house_drone_loop`      | `creaky house ambient`, `haunted house drone`  | 30-60s seamless loop                 |
| `heartbeat_loop`        | `heartbeat single beat`                        | one beat, loops at neutral BPM       |
| `breath_panic_loop`     | `panicked breathing`, `scared breath`          | seamless loop, no clear inhale/exhale boundary |
| `wood_step_01..04`      | `wood floor footstep`, `creaky wood step`      | 4 distinct takes for variation       |
| `jump_scare_01`         | `jump scare stinger`, `horror impact`          | one-shot, ~1-2s, big                 |
| `key_pickup_chime`      | `pickup chime`, `magic chime short`            | bright, ~0.5s                        |
| `door_creak_01`         | `door creak`                                   | wooden, slow                         |
| `entity_moan_01..02`    | `demon moan`, `creature growl distant`         | 2 distinct takes; played randomly    |

## Workflow

1. Sign in to freesound.org.
2. Filter search results to **License: Creative Commons 0**.
3. Download the original (not preview).
4. In Audacity: trim, normalize to ~-3dB peak, export as Vorbis OGG quality 6.
5. Drop into the path above with the exact filename.

The next page-load picks them up automatically — Howler preloads on
`AudioWorld` construction. If a file is missing or 404s, that single slot
silently falls back to procedural; other slots are unaffected.

## License

Sounds must be **CC0**. If you use a CC-BY sound instead, add an entry to
`public/LICENSES.md` with author + freesound URL.
