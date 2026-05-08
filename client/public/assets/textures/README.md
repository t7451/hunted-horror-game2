# Textures

PBR texture sets consumed by `client/src/materials/MaterialFactory.ts`.
Until the `.ktx2` files land here, MaterialFactory falls back to procedural
canvas-generated noise — playable but flat.

## Layout

```
public/assets/textures/
├── walls/
│   ├── wallpaper_dirty_01_2k_{albedo,normal,orm}.ktx2
│   └── plaster_cracked_01_2k_{albedo,normal,orm}.ktx2
├── floors/
│   └── wood_floor_worn_01_2k_{albedo,normal,orm}.ktx2
├── ceilings/
│   └── ceiling_plaster_01_2k_{albedo,normal,orm}.ktx2
├── doors/
│   └── door_wood_01_2k_{albedo,normal,orm}.ktx2
└── trim/
    └── baseboard_painted_01_2k_{albedo,normal,orm}.ktx2
```

Each set ships three KTX2 maps:
- `_albedo` — diffuse / base color (sRGB)
- `_normal` — OpenGL-convention tangent-space normal (linear)
- `_orm`    — packed AO(R) / Roughness(G) / Metalness(B) (linear)

## Generating

`scripts/fetch-textures.mjs` pulls the source JPGs from Poly Haven (CC0) and
encodes them with `basisu`. From the repo root:

```bash
# 1. Install basisu (one-time)
#    macOS:           brew install basis_universal
#    Linux (no sudo): build from source — basisu isn't packaged in apt.
#                     Needs cmake + g++ + make.
#       curl -sL https://github.com/Kitware/CMake/releases/download/v3.31.6/cmake-3.31.6-linux-x86_64.tar.gz | tar xz -C ~/.local --strip-components=1
#       git clone --depth 1 -b v2_1_0 https://github.com/BinomialLLC/basis_universal /tmp/basisu
#       cd /tmp/basisu && ~/.local/bin/cmake CMakeLists.txt -DCMAKE_BUILD_TYPE=Release && make -j$(nproc)
#       install -m 755 bin/basisu ~/.local/bin/

# 2. Fetch + encode (idempotent; re-running skips already-encoded files)
node scripts/fetch-textures.mjs
node scripts/fetch-textures.mjs --force   # re-encode everything
```

The script picks Poly Haven slugs that match each MaterialFactory slot.
Edit the `ASSETS` array in the script to swap slugs.

## License

All source PBR sets are sourced from [Poly Haven](https://polyhaven.com)
under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). No
attribution is required, but the slugs used are recorded in
`scripts/fetch-textures.mjs` for reproducibility.
