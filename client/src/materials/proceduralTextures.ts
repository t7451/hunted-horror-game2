// Per-material procedural texture generators for the MaterialFactory fallback
// path. The deployed Netlify build has no committed texture binaries (KTX2s
// are gitignored, JPGs were never committed), so this module is what players
// actually see. Each material produces three tileable maps:
//
//   - albedo   (sRGB)         base color + structural variation
//   - normal   (linear, GL)   surface relief from a height field
//   - orm      (linear)       AO (R) / roughness (G) / metalness (B)
//
// Convention: callers should set `material.roughness = material.metalness = 1.0`
// so the ORM channels drive the final values directly.
//
// Resolution is fixed at 256² — large enough for visible structure, small
// enough that all 8 materials × 3 maps generate in ~10ms on a mid-tier laptop.
//
// The generators are deterministic (seed per-material) so a given map looks
// identical across reloads. They are called once per material at engine
// startup and cached by MaterialFactory; cost amortizes immediately.

import type { MaterialName } from "./MaterialFactory";

const SIZE = 256;

export type ProceduralMapCanvases = {
  albedoCanvas: HTMLCanvasElement;
  normalCanvas: HTMLCanvasElement;
  ormCanvas: HTMLCanvasElement;
};

type RGB = [number, number, number];

// Field buffers reused across the per-material painters. Re-created per
// material rather than pooled — per-call allocation is cheap (256KB total)
// and keeps the painters pure.
type Fields = {
  height: Float32Array; // -1..1, 0 = flat
  r: Float32Array;      // 0..255
  g: Float32Array;
  b: Float32Array;
  ao: Float32Array;     // 0..1, 1 = fully lit
  rough: Float32Array;  // 0..1
  metal: Float32Array;  // 0..1, almost always 0 here (no metallic surfaces)
};

function makeFields(): Fields {
  const n = SIZE * SIZE;
  return {
    height: new Float32Array(n),
    r: new Float32Array(n),
    g: new Float32Array(n),
    b: new Float32Array(n),
    ao: new Float32Array(n).fill(1.0),
    rough: new Float32Array(n).fill(0.9),
    metal: new Float32Array(n),
  };
}

// ── Public API ──────────────────────────────────────────────────────────────

export function generateProceduralMaps(name: MaterialName): ProceduralMapCanvases {
  const f = makeFields();
  switch (name) {
    case "wallpaper_dirty":
      paintWallpaper(f, hex(0x6b4a32), hex(0x8a6242), hex(0x3a261a));
      break;
    case "wood_floor_worn":
      paintWoodPlanks(f, hex(0x2a1f17), hex(0x18120c), {
        plankWidth: 64,
        vertical: true,
        worn: true,
        polished: false,
      });
      break;
    case "plaster_cracked":
      paintPlaster(f, hex(0x4a4038), {
        cracks: true,
        stainStrength: 0.35,
        roughBase: 0.94,
      });
      break;
    case "wood_panel_dark":
      paintWoodPlanks(f, hex(0x3a2a1c), hex(0x1f1610), {
        plankWidth: 32,
        vertical: true,
        worn: false,
        polished: true,
      });
      break;
    case "tile_kitchen_dirty":
      paintTiles(f, hex(0x6a665e), hex(0x2a2620));
      break;
    case "ceiling_plaster":
      // Ceiling is very dark; cracks visible but stains stronger.
      paintPlaster(f, hex(0x2a241e), {
        cracks: true,
        stainStrength: 0.55,
        roughBase: 0.98,
      });
      break;
    case "door_wood":
      paintDoor(f, hex(0x3a1f10), hex(0x1f1008));
      break;
    case "baseboard_trim":
      paintWoodGrain(f, hex(0x2a2520), hex(0x161210), {
        vertical: false,
        polished: true,
      });
      break;
  }
  return {
    albedoCanvas: writeAlbedo(f),
    normalCanvas: writeNormal(f),
    ormCanvas: writeOrm(f),
  };
}

// ── Painters ────────────────────────────────────────────────────────────────

type PlankOpts = {
  plankWidth: number;
  vertical: boolean;
  worn: boolean;
  polished: boolean;
};

function paintWoodPlanks(f: Fields, base: RGB, dark: RGB, opts: PlankOpts): void {
  const { plankWidth, vertical, worn, polished } = opts;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const along = vertical ? y : x;
      const across = vertical ? x : y;
      const plankIdx = Math.floor(across / plankWidth);
      const acrossInPlank = (across % plankWidth) / plankWidth;
      const edgeDist = Math.min(acrossInPlank, 1 - acrossInPlank);
      const plankSeed = hash1(plankIdx * 17.3 + 0.5);

      // Wood grain: long-axis sinusoidal streaks modulated by 2D noise.
      const grainPhase = along * 0.05 + plankSeed * 6.28;
      const grainBase = Math.sin(grainPhase) * 0.5 + 0.5;
      const grainNoise = fbm2(along * 0.05, across * 0.18, 3, plankIdx + 7);
      const grain = grainBase * 0.55 + grainNoise * 0.45;

      // Per-plank brightness shift (some planks are darker than others), plus
      // slow blotchy aging along the board so adjacent planks do not read flat.
      const age = fbm2(across * 0.025 + plankSeed * 40, along * 0.012, 3, 73);
      const plankShift = (plankSeed - 0.5) * 0.28 + (age - 0.5) * 0.16;

      const k = clamp01(0.32 + grain * 0.62 + plankShift);
      let r = dark[0] + (base[0] - dark[0]) * k;
      let g = dark[1] + (base[1] - dark[1]) * k;
      let b = dark[2] + (base[2] - dark[2]) * k;

      // Slight color variation per plank (warmer/cooler).
      const tint = (plankSeed - 0.5) * 12;
      r += tint;
      b -= tint * 0.5;

      // Subtle worn patches on heavily-traversed floors: lighter, smoother.
      if (worn) {
        const wear = fbm2(x * 0.013, y * 0.013, 3, 99);
        if (wear > 0.62) {
          const wf = (wear - 0.62) / 0.38;
          r += (210 - r) * wf * 0.20;
          g += (175 - g) * wf * 0.20;
          b += (140 - b) * wf * 0.20;
          f.rough[i] = 0.50 + (1 - wf) * 0.35;
        } else {
          f.rough[i] = 0.9;
        }
      } else {
        f.rough[i] = polished ? 0.7 : 0.86;
      }
      f.rough[i] = clamp01(f.rough[i] + (grainNoise - 0.5) * 0.08 + (plankSeed - 0.5) * 0.06);

      f.r[i] = r;
      f.g[i] = g;
      f.b[i] = b;
      f.height[i] = (grain - 0.5) * 0.22 + (age - 0.5) * 0.08;

      // Plank seam: dark recessed strip at plank boundaries.
      const seamW = worn ? 0.06 : 0.04;
      if (edgeDist < seamW) {
        const t = (seamW - edgeDist) / seamW; // 1 at seam center, 0 at edge of seam zone
        const mul = 1 - t * (worn ? 0.88 : 0.78);
        f.r[i] *= mul;
        f.g[i] *= mul;
        f.b[i] *= mul;
        f.height[i] = -t * (worn ? 0.92 : 0.7);
        f.ao[i] = 1 - t * (worn ? 0.8 : 0.7);
        f.rough[i] = 0.96;
      }

      // Cross-plank butt joints every ~1.6 plank lengths.
      const buttPhase = (along + plankSeed * 200) % (plankWidth * 3.2);
      const buttDist = Math.min(buttPhase, plankWidth * 3.2 - buttPhase);
      if (buttDist < 1.6) {
        const t = (1.6 - buttDist) / 1.6;
        const mul = 1 - t * (worn ? 0.82 : 0.7);
        f.r[i] *= mul;
        f.g[i] *= mul;
        f.b[i] *= mul;
        f.height[i] = Math.min(f.height[i], -t * (worn ? 0.7 : 0.5));
        f.ao[i] *= 1 - t * (worn ? 0.65 : 0.5);
      }

      // Hairline splits running with the grain. Coordinate-keyed so the texture
      // stays tileable and cheap, but broken up enough to avoid barcode lines.
      if (worn) {
        const splitCenter = 0.22 + hash1(plankIdx * 23.1) * 0.56;
        const splitDist = Math.abs(acrossInPlank - splitCenter);
        const splitBreak = fbm2(along * 0.018, plankIdx * 31.1, 2, 89);
        if (splitDist < 0.012 && splitBreak > 0.46) {
          const t = (0.012 - splitDist) / 0.012;
          const mul = 1 - t * 0.55;
          f.r[i] *= mul;
          f.g[i] *= mul;
          f.b[i] *= mul;
          f.height[i] = Math.min(f.height[i], -t * 0.42);
          f.ao[i] *= 1 - t * 0.28;
          f.rough[i] = Math.min(1.0, f.rough[i] + t * 0.12);
        }
      }
    }
  }

  if (worn) paintFloorScratches(f, vertical);
}

function paintFloorScratches(f: Fields, vertical: boolean): void {
  const rng = mulberry32(101);
  const SCRATCHES = 34;
  for (let s = 0; s < SCRATCHES; s++) {
    const baseAcross = rng() * SIZE;
    const baseAlong = rng() * SIZE;
    const len = 24 + rng() * 86;
    const drift = (rng() - 0.5) * 0.32;
    const width = rng() < 0.22 ? 2 : 1;
    const lightScratch = rng() < 0.6;
    const wobble = rng() * Math.PI * 2;

    for (let p = 0; p < len; p++) {
      const across = baseAcross + drift * p + Math.sin(p * 0.16 + wobble) * 0.8;
      const along = baseAlong + p;
      for (let w = -width; w <= width; w++) {
        const a = (1 - Math.abs(w) / (width + 0.5)) * (1 - p / len) * 0.85;
        if (a <= 0) continue;
        const x = vertical ? wrapInt(Math.round(across + w)) : wrapInt(Math.round(along));
        const y = vertical ? wrapInt(Math.round(along)) : wrapInt(Math.round(across + w));
        const i = y * SIZE + x;
        if (lightScratch) {
          f.r[i] += (205 - f.r[i]) * a * 0.22;
          f.g[i] += (170 - f.g[i]) * a * 0.18;
          f.b[i] += (125 - f.b[i]) * a * 0.12;
          f.height[i] += a * 0.08;
          f.rough[i] = Math.max(0.42, f.rough[i] - a * 0.16);
        } else {
          const mul = 1 - a * 0.34;
          f.r[i] *= mul;
          f.g[i] *= mul;
          f.b[i] *= mul;
          f.height[i] = Math.min(f.height[i], -a * 0.28);
          f.ao[i] *= 1 - a * 0.18;
          f.rough[i] = Math.min(1.0, f.rough[i] + a * 0.16);
        }
      }
    }
  }
}

function paintPlaster(
  f: Fields,
  base: RGB,
  opts: { cracks: boolean; stainStrength: number; roughBase: number }
): void {
  const { cracks, stainStrength, roughBase } = opts;

  // Base surface: low-frequency height variation + grain.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const big = fbm2(x * 0.018, y * 0.018, 4, 3);
      const fine = fbm2(x * 0.18, y * 0.18, 2, 11);
      const k = 0.7 + big * 0.3 + (fine - 0.5) * 0.18;
      const kk = clamp01(k);
      f.r[i] = base[0] * kk;
      f.g[i] = base[1] * kk;
      f.b[i] = base[2] * kk;
      f.height[i] = (big - 0.5) * 0.6 + (fine - 0.5) * 0.15;
      f.rough[i] = clamp01(roughBase + (fine - 0.5) * 0.08 + (big - 0.5) * 0.04);
    }
  }

  // Brownish water stains.
  if (stainStrength > 0) {
    const threshold = stainStrength >= 0.5 ? 0.48 : 0.55;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const i = y * SIZE + x;
        const stain = fbm2(x * 0.008, y * 0.008, 5, 41);
        if (stain > threshold) {
          const t = ((stain - threshold) / (1 - threshold)) * stainStrength;
          // Pull toward a brownish-yellow stain color.
          f.r[i] = f.r[i] * (1 - t) + 96 * t;
          f.g[i] = f.g[i] * (1 - t) + 70 * t;
          f.b[i] = f.b[i] * (1 - t) + 38 * t;
          f.height[i] = Math.min(f.height[i], -t * 0.12);
          f.ao[i] *= 1 - t * 0.12;
          f.rough[i] = Math.min(1.0, f.rough[i] + t * 0.08);
        }
      }
    }
  }

  if (stainStrength >= 0.5) paintCeilingMoldDamage(f);

  // Network of cracks: random-walk dark thin lines, AO darkens them strongly.
  if (cracks) {
    const rng = mulberry32(7);
    const NUM_CRACKS = 6;
    for (let c = 0; c < NUM_CRACKS; c++) {
      let cx = rng() * SIZE;
      let cy = rng() * SIZE;
      let angle = rng() * Math.PI * 2;
      const len = 60 + rng() * 80;
      for (let s = 0; s < len; s++) {
        // Wiggle the angle a bit.
        angle += (rng() - 0.5) * 0.4;
        cx += Math.cos(angle);
        cy += Math.sin(angle);
        // Branch occasionally.
        if (rng() < 0.04 && c < NUM_CRACKS - 2) {
          // Spawn a short branch by shifting one of the unspawned cracks here.
          // Cheap alternative: just paint a small perpendicular tick.
          const bx = cx + Math.cos(angle + Math.PI / 2) * (rng() * 6 - 3);
          const by = cy + Math.sin(angle + Math.PI / 2) * (rng() * 6 - 3);
          paintCrackPixel(f, bx, by, 0.6);
        }
        paintCrackPixel(f, cx, cy, 1.0);
      }
    }
  }
}

function paintCeilingMoldDamage(f: Fields): void {
  // Broad mildew blooms: muted green-black, rough, slightly recessed.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const mold = fbm2(x * 0.013, y * 0.013, 5, 67);
      const speckle = valueNoise2(x, y, 3, 121);
      if (mold > 0.6 || (mold > 0.53 && speckle > 0.78)) {
        const t = clamp01((mold - 0.53) / 0.47) * (0.55 + speckle * 0.25);
        f.r[i] = f.r[i] * (1 - t) + 24 * t;
        f.g[i] = f.g[i] * (1 - t) + 31 * t;
        f.b[i] = f.b[i] * (1 - t) + 21 * t;
        f.height[i] = Math.min(f.height[i], -t * 0.18);
        f.ao[i] *= 1 - t * 0.18;
        f.rough[i] = Math.min(1.0, f.rough[i] + t * 0.12);
      }
    }
  }

  // Water rings and soft pooled centers, deterministic and tile-wrapped.
  const rng = mulberry32(202);
  for (let r = 0; r < 7; r++) {
    const cx = Math.floor(rng() * SIZE);
    const cy = Math.floor(rng() * SIZE);
    const rx = 18 + rng() * 34;
    const ry = 10 + rng() * 24;
    const radius = Math.ceil(Math.max(rx, ry) * 1.35);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const d = Math.hypot(dx / rx, dy / ry);
        if (d > 1.25) continue;
        const xi = wrapInt(cx + dx);
        const yi = wrapInt(cy + dy);
        const i = yi * SIZE + xi;
        const ring = clamp01(1 - Math.abs(d - 1) * 5.0);
        const pool = d < 0.82 ? (0.82 - d) / 0.82 : 0;
        const t = ring * 0.55 + pool * 0.16;
        f.r[i] = f.r[i] * (1 - t) + 82 * t;
        f.g[i] = f.g[i] * (1 - t) + 61 * t;
        f.b[i] = f.b[i] * (1 - t) + 35 * t;
        f.height[i] = Math.min(f.height[i], -(ring * 0.22 + pool * 0.08));
        f.ao[i] *= 1 - t * 0.22;
        f.rough[i] = Math.min(1.0, f.rough[i] + t * 0.16);
      }
    }
  }
}

function paintCrackPixel(f: Fields, x: number, y: number, intensity: number): void {
  // 1px-thick crack with anti-aliased neighbors. Wraps for tileable output.
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const t = (dist === 0 ? 1.0 : dist === 1 ? 0.4 : 0.0) * intensity;
      if (t <= 0) continue;
      const xi = wrapInt(Math.round(x) + dx);
      const yi = wrapInt(Math.round(y) + dy);
      const i = yi * SIZE + xi;
      const mul = 1 - t * 0.85;
      f.r[i] *= mul;
      f.g[i] *= mul;
      f.b[i] *= mul;
      f.height[i] = Math.min(f.height[i], -t * 0.8);
      f.ao[i] *= 1 - t * 0.7;
    }
  }
}

function paintTiles(f: Fields, base: RGB, grout: RGB): void {
  const TILE = 64;
  const GROUT_W = 3;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const tx = Math.floor(x / TILE);
      const ty = Math.floor(y / TILE);
      const inX = x % TILE;
      const inY = y % TILE;
      // Distance to nearest grout line (in either direction).
      const edgeX = Math.min(inX, TILE - inX);
      const edgeY = Math.min(inY, TILE - inY);
      const edge = Math.min(edgeX, edgeY);

      const tileSeed = hash1(tx * 31.7 + ty * 17.3);
      // Surface texture on the tile face: subtle noise + the occasional crack.
      const surface = fbm2(x * 0.07, y * 0.07, 3, 21);
      const grime = fbm2(x * 0.025, y * 0.025, 3, 77);
      const k = 0.85 + (surface - 0.5) * 0.16 + (tileSeed - 0.5) * 0.08;
      const kk = clamp01(k);

      if (edge < GROUT_W) {
        // Grout: darker, recessed, rougher, AO-darkened.
        const t = 1 - edge / GROUT_W;
        const corner = edgeX < GROUT_W * 1.8 && edgeY < GROUT_W * 1.8 ? 0.18 : 0;
        const speckle = hash2(x, y, 131) > 0.82 ? 0.2 : 0;
        const grimeMul = Math.max(0.22, 0.58 + (surface - 0.5) * 0.12 - grime * 0.18 - corner - speckle);
        f.r[i] = grout[0] * grimeMul;
        f.g[i] = grout[1] * grimeMul;
        f.b[i] = grout[2] * grimeMul;
        f.height[i] = -0.72 * t - grime * 0.12 - corner * 0.2;
        f.ao[i] = clamp01(1 - t * 0.68 - grime * 0.18 - corner);
        f.rough[i] = 0.97 + grime * 0.03;
      } else {
        f.r[i] = base[0] * kk;
        f.g[i] = base[1] * kk;
        f.b[i] = base[2] * kk;
        f.height[i] = (surface - 0.5) * 0.08;
        // Tile faces are smoother (a little ceramic gloss).
        f.rough[i] = 0.5 + (surface - 0.5) * 0.12 + (tileSeed - 0.5) * 0.05;

        // Dirty feathering beside grout lines so the grid reads grimy rather
        // than cleanly stamped.
        if (edge < GROUT_W + 8) {
          const t = (GROUT_W + 8 - edge) / 8;
          const dirt = clamp01(t * (0.3 + grime * 0.55));
          f.r[i] = f.r[i] * (1 - dirt) + 38 * dirt;
          f.g[i] = f.g[i] * (1 - dirt) + 32 * dirt;
          f.b[i] = f.b[i] * (1 - dirt) + 25 * dirt;
          f.height[i] -= dirt * 0.08;
          f.ao[i] *= 1 - dirt * 0.18;
          f.rough[i] = Math.min(1.0, f.rough[i] + dirt * 0.28);
        }

        // Stain patches — yellowed grime that pools on horizontal tiles.
        const stain = fbm2(x * 0.012, y * 0.012, 4, 53);
        if (stain > 0.6) {
          const t = (stain - 0.6) / 0.4;
          f.r[i] = f.r[i] * (1 - t * 0.6) + 90 * t * 0.6;
          f.g[i] = f.g[i] * (1 - t * 0.6) + 70 * t * 0.6;
          f.b[i] = f.b[i] * (1 - t * 0.6) + 36 * t * 0.6;
          f.rough[i] = Math.min(1.0, f.rough[i] + t * 0.25);
        }
      }
    }
  }

  paintTileDamage(f, TILE, GROUT_W);
}

function paintTileDamage(f: Fields, tileSize: number, groutW: number): void {
  const rng = mulberry32(151);

  for (let c = 0; c < 8; c++) {
    let x = rng() * SIZE;
    let y = rng() * SIZE;
    let angle = rng() * Math.PI * 2;
    const len = 18 + rng() * 34;
    for (let s = 0; s < len; s++) {
      angle += (rng() - 0.5) * 0.22;
      x += Math.cos(angle);
      y += Math.sin(angle);
      const inX = wrapInt(Math.round(x)) % tileSize;
      const inY = wrapInt(Math.round(y)) % tileSize;
      if (inX <= groutW || inY <= groutW) continue;
      paintTileCrackPixel(f, x, y, 0.65);
    }
  }

  for (let chip = 0; chip < 18; chip++) {
    const vertical = rng() < 0.5;
    const line = Math.floor(rng() * (SIZE / tileSize)) * tileSize;
    const offset = (rng() < 0.5 ? 1 : -1) * (groutW + 2 + rng() * 5);
    const cx = vertical ? line + offset : rng() * SIZE;
    const cy = vertical ? rng() * SIZE : line + offset;
    paintTileChip(f, cx, cy, 3 + rng() * 5, 2 + rng() * 4);
  }
}

function paintTileCrackPixel(f: Fields, x: number, y: number, intensity: number): void {
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const t = (dist === 0 ? 1.0 : 0.35) * intensity;
      const xi = wrapInt(Math.round(x) + dx);
      const yi = wrapInt(Math.round(y) + dy);
      const i = yi * SIZE + xi;
      const mul = 1 - t * 0.5;
      f.r[i] *= mul;
      f.g[i] *= mul;
      f.b[i] *= mul;
      f.height[i] = Math.min(f.height[i], -t * 0.34);
      f.ao[i] *= 1 - t * 0.25;
      f.rough[i] = Math.min(1.0, f.rough[i] + t * 0.2);
    }
  }
}

function paintTileChip(f: Fields, cx: number, cy: number, rx: number, ry: number): void {
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d > 1) continue;
      const xi = wrapInt(x);
      const yi = wrapInt(y);
      const i = yi * SIZE + xi;
      const t = 1 - d;
      f.r[i] = f.r[i] * (1 - t * 0.65) + 35 * t * 0.65;
      f.g[i] = f.g[i] * (1 - t * 0.65) + 31 * t * 0.65;
      f.b[i] = f.b[i] * (1 - t * 0.65) + 27 * t * 0.65;
      f.height[i] = Math.min(f.height[i], -t * 0.48);
      f.ao[i] *= 1 - t * 0.38;
      f.rough[i] = Math.min(1.0, f.rough[i] + t * 0.32);
    }
  }
}

function paintWallpaper(f: Fields, base: RGB, light: RGB, dark: RGB): void {
  // Vertical floral-ish stripe pattern: alternating column bands with a soft
  // damask motif, then water staining + tear damage on top.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      // 4 vertical bands of stripe pairs.
      const bandPhase = (x / 32) % 2.0; // 0..2
      const inLightBand = bandPhase < 1.0;
      // Damask: soft sinusoidal motif across both axes.
      const motif =
        Math.sin(x * 0.18) * Math.sin(y * 0.13) * 0.5 +
        Math.sin((x + y) * 0.08) * 0.25;
      const k = 0.75 + motif * 0.18;
      const kk = clamp01(k);
      const colA = inLightBand ? light : base;
      f.r[i] = colA[0] * kk;
      f.g[i] = colA[1] * kk;
      f.b[i] = colA[2] * kk;

      // Subtle paper grain.
      const grain = fbm2(x * 0.12, y * 0.12, 3, 19);
      const gShift = (grain - 0.5) * 18;
      f.r[i] += gShift;
      f.g[i] += gShift * 0.9;
      f.b[i] += gShift * 0.7;
      f.height[i] = (grain - 0.5) * 0.1 + motif * 0.025;
      f.rough[i] = 0.9 + (grain - 0.5) * 0.08;
    }
  }

  // Water stains: large brown splotches that pull toward `dark`.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const stain = fbm2(x * 0.009, y * 0.009, 5, 27);
      const drip = fbm2(x * 0.045, y * 0.004, 3, 29);
      if (stain > 0.53 || (stain > 0.46 && drip > 0.64)) {
        const t = clamp01((stain - 0.46) / 0.54) * (0.62 + drip * 0.34);
        f.r[i] = f.r[i] * (1 - t) + dark[0] * t;
        f.g[i] = f.g[i] * (1 - t) + dark[1] * t;
        f.b[i] = f.b[i] * (1 - t) + dark[2] * t;
        f.height[i] = Math.min(f.height[i], -t * 0.1);
        f.ao[i] *= 1 - t * 0.1;
        f.rough[i] = Math.min(1.0, f.rough[i] + t * 0.1);
      }
    }
  }

  // Tear damage: a few horizontal rip strips where the paper has peeled.
  const rng = mulberry32(13);
  const TEARS = 5;
  for (let t = 0; t < TEARS; t++) {
    const cy = Math.floor(rng() * SIZE);
    const startX = Math.floor(rng() * SIZE);
    const len = 32 + Math.floor(rng() * 58);
    const thickness = 2 + Math.floor(rng() * 3);
    for (let s = 0; s < len; s++) {
      const xi = wrapInt(startX + s);
      const wave = Math.floor(Math.sin(s * 0.34 + t) * 3 + Math.sin(s * 0.11) * 2);
      for (let dy = -thickness - 2; dy <= thickness + 2; dy++) {
        const yi = wrapInt(cy + dy + Math.floor(Math.sin(s * 0.4 + t) * 2));
        const i = yi * SIZE + xi;
        const dist = Math.abs(dy + wave * 0.15);
        if (dist <= thickness) {
          const a = 1 - dist / (thickness + 0.5);
          // Reveal a darker substrate underneath.
          f.r[i] = f.r[i] * (1 - a * 0.82) + 30 * a * 0.82;
          f.g[i] = f.g[i] * (1 - a * 0.82) + 22 * a * 0.82;
          f.b[i] = f.b[i] * (1 - a * 0.82) + 15 * a * 0.82;
          f.height[i] = Math.min(f.height[i], -a * 0.8);
          f.ao[i] *= 1 - a * 0.6;
          f.rough[i] = Math.min(1.0, f.rough[i] + a * 0.1);
        } else {
          // Raised curled paper lip catches flashlight as a thin ragged edge.
          const a = 1 - (dist - thickness) / 2.5;
          f.r[i] += (125 - f.r[i]) * a * 0.22;
          f.g[i] += (92 - f.g[i]) * a * 0.2;
          f.b[i] += (60 - f.b[i]) * a * 0.16;
          f.height[i] += a * 0.26;
          f.rough[i] = Math.max(0.68, f.rough[i] - a * 0.08);
        }
      }
    }
  }

  paintWallpaperPeelPatch(f, 60, 190, 30, 20, dark);
  paintWallpaperPeelPatch(f, 185, 82, 24, 34, dark);
}

function paintWallpaperPeelPatch(f: Fields, cx: number, cy: number, rx: number, ry: number, dark: RGB): void {
  for (let y = cy - ry - 3; y <= cy + ry + 3; y++) {
    for (let x = cx - rx - 3; x <= cx + rx + 3; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      const noise = valueNoise2(x, y, 12, 177) * 0.22;
      const d = Math.hypot(dx, dy) + noise;
      if (d > 1.12) continue;
      const xi = wrapInt(x);
      const yi = wrapInt(y);
      const i = yi * SIZE + xi;
      if (d < 0.92) {
        const a = clamp01((0.92 - d) / 0.55);
        f.r[i] = f.r[i] * (1 - a * 0.78) + dark[0] * a * 0.78;
        f.g[i] = f.g[i] * (1 - a * 0.78) + dark[1] * a * 0.78;
        f.b[i] = f.b[i] * (1 - a * 0.78) + dark[2] * a * 0.78;
        f.height[i] = Math.min(f.height[i], -a * 0.5);
        f.ao[i] *= 1 - a * 0.32;
        f.rough[i] = Math.min(1.0, f.rough[i] + a * 0.12);
      } else {
        const edge = clamp01((1.12 - d) / 0.2);
        f.r[i] += (116 - f.r[i]) * edge * 0.28;
        f.g[i] += (82 - f.g[i]) * edge * 0.24;
        f.b[i] += (50 - f.b[i]) * edge * 0.18;
        f.height[i] += edge * 0.22;
        f.rough[i] = Math.max(0.7, f.rough[i] - edge * 0.08);
      }
    }
  }
}

function paintDoor(f: Fields, base: RGB, dark: RGB): void {
  // Single piece of vertical-grain wood with a recessed central panel,
  // a knot, and a bit of weathering.
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const grainPhase = y * 0.06;
      const grainBase = Math.sin(grainPhase + Math.sin(x * 0.04) * 1.2) * 0.5 + 0.5;
      const grainNoise = fbm2(y * 0.04, x * 0.16, 3, 5);
      const grain = grainBase * 0.6 + grainNoise * 0.4;

      const k = clamp01(0.4 + grain * 0.55);
      f.r[i] = dark[0] + (base[0] - dark[0]) * k;
      f.g[i] = dark[1] + (base[1] - dark[1]) * k;
      f.b[i] = dark[2] + (base[2] - dark[2]) * k;
      f.height[i] = (grain - 0.5) * 0.15;
      f.rough[i] = 0.7 + (grain - 0.5) * 0.06;
    }
  }
  // Recessed rectangular panel inset.
  const PAD = 40;
  const FRAME = 8;
  for (let y = PAD; y < SIZE - PAD; y++) {
    for (let x = PAD; x < SIZE - PAD; x++) {
      const i = y * SIZE + x;
      const dx = Math.min(x - PAD, SIZE - PAD - 1 - x);
      const dy = Math.min(y - PAD, SIZE - PAD - 1 - y);
      const d = Math.min(dx, dy);
      if (d < FRAME) {
        // Inner bevel: darker line.
        const t = 1 - d / FRAME;
        const mul = 1 - t * 0.55;
        f.r[i] *= mul;
        f.g[i] *= mul;
        f.b[i] *= mul;
        f.height[i] = -t * 0.6;
        f.ao[i] *= 1 - t * 0.5;
      } else {
        // Inset surface: slightly darker, lifted.
        f.r[i] *= 0.92;
        f.g[i] *= 0.92;
        f.b[i] *= 0.92;
        f.height[i] -= 0.25;
      }
    }
  }
  // A wood knot in the upper third.
  drawKnot(f, 90, 60, 14);
}

function drawKnot(f: Fields, cx: number, cy: number, radius: number): void {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > radius) continue;
      const xi = wrapInt(x);
      const yi = wrapInt(y);
      const i = yi * SIZE + xi;
      const t = 1 - d / radius;
      const ringPhase = d * 1.6;
      const ring = (Math.sin(ringPhase) * 0.5 + 0.5) * t;
      const mul = 1 - (t * 0.7 + ring * 0.2);
      f.r[i] *= mul;
      f.g[i] *= mul;
      f.b[i] *= mul;
      f.height[i] = Math.min(f.height[i], -t * 0.4 + ring * 0.1);
      f.ao[i] *= 1 - t * 0.4;
    }
  }
}

function paintWoodGrain(
  f: Fields,
  base: RGB,
  dark: RGB,
  opts: { vertical: boolean; polished: boolean }
): void {
  const { vertical, polished } = opts;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const along = vertical ? y : x;
      const across = vertical ? x : y;
      const grainPhase = along * 0.05;
      const grainBase = Math.sin(grainPhase + Math.sin(across * 0.03) * 0.8) * 0.5 + 0.5;
      const grainNoise = fbm2(along * 0.05, across * 0.18, 3, 13);
      const grain = grainBase * 0.55 + grainNoise * 0.45;

      const k = clamp01(0.4 + grain * 0.55);
      f.r[i] = dark[0] + (base[0] - dark[0]) * k;
      f.g[i] = dark[1] + (base[1] - dark[1]) * k;
      f.b[i] = dark[2] + (base[2] - dark[2]) * k;
      f.height[i] = (grain - 0.5) * 0.1;
      f.rough[i] = polished ? 0.62 : 0.84;
    }
  }
}

// ── Canvas writers ──────────────────────────────────────────────────────────

function writeAlbedo(f: Fields): HTMLCanvasElement {
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  const n = SIZE * SIZE;
  for (let i = 0; i < n; i++) {
    img.data[i * 4 + 0] = clampU8(f.r[i]);
    img.data[i * 4 + 1] = clampU8(f.g[i]);
    img.data[i * 4 + 2] = clampU8(f.b[i]);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

// Sobel-derived normal map from the height field. Wraps at edges so the
// output tiles seamlessly.
function writeNormal(f: Fields): HTMLCanvasElement {
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  const STRENGTH = 2.4; // larger = more pronounced relief
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const xL = x === 0 ? SIZE - 1 : x - 1;
      const xR = x === SIZE - 1 ? 0 : x + 1;
      const yU = y === 0 ? SIZE - 1 : y - 1;
      const yD = y === SIZE - 1 ? 0 : y + 1;
      const hL = f.height[y * SIZE + xL];
      const hR = f.height[y * SIZE + xR];
      const hU = f.height[yU * SIZE + x];
      const hD = f.height[yD * SIZE + x];
      const dx = (hR - hL) * STRENGTH;
      const dy = (hD - hU) * STRENGTH;
      // OpenGL-convention tangent-space normal: +Y is up.
      const len = Math.hypot(dx, dy, 1);
      const nx = -dx / len;
      const ny = -dy / len;
      const nz = 1 / len;
      img.data[i * 4 + 0] = clampU8(128 + nx * 127);
      img.data[i * 4 + 1] = clampU8(128 + ny * 127);
      img.data[i * 4 + 2] = clampU8(128 + nz * 127);
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function writeOrm(f: Fields): HTMLCanvasElement {
  const canvas = createCanvas();
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(SIZE, SIZE);
  const n = SIZE * SIZE;
  for (let i = 0; i < n; i++) {
    img.data[i * 4 + 0] = clampU8(f.ao[i] * 255);
    img.data[i * 4 + 1] = clampU8(f.rough[i] * 255);
    img.data[i * 4 + 2] = clampU8(f.metal[i] * 255);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

function createCanvas(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SIZE;
  c.height = SIZE;
  return c;
}

// ── Noise helpers ───────────────────────────────────────────────────────────

function hash1(x: number): number {
  const s = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function hash2(x: number, y: number, seed: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233 + seed * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

// Bilinear value noise on a grid. cellSize controls the feature size.
function valueNoise2(x: number, y: number, cellSize: number, seed: number): number {
  const cx = Math.floor(x / cellSize);
  const cy = Math.floor(y / cellSize);
  const fx = x / cellSize - cx;
  const fy = y / cellSize - cy;
  const c00 = hash2(cx, cy, seed);
  const c10 = hash2(cx + 1, cy, seed);
  const c01 = hash2(cx, cy + 1, seed);
  const c11 = hash2(cx + 1, cy + 1, seed);
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = c00 + (c10 - c00) * sx;
  const b = c01 + (c11 - c01) * sx;
  return a + (b - a) * sy;
}

// Fractal Brownian motion: sum of `octaves` noise layers at decreasing scales
// and amplitudes. Returns a value in [0, 1].
function fbm2(x: number, y: number, octaves: number, seed: number): number {
  let sum = 0;
  let amp = 1;
  let total = 0;
  let cell = 32; // first octave feature size in source units
  for (let i = 0; i < octaves; i++) {
    sum += valueNoise2(x, y, cell, seed + i * 17) * amp;
    total += amp;
    amp *= 0.5;
    cell = Math.max(1, cell / 2);
  }
  return sum / total;
}

// Deterministic PRNG used inside painters that need repeatable random
// placement (cracks, tears) — separate from the stateless hash functions
// above because we want a sequential stream, not coordinate-keyed lookup.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Math utilities ──────────────────────────────────────────────────────────

function hex(n: number): RGB {
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampU8(v: number): number {
  if (v < 0) return 0;
  if (v > 255) return 255;
  return v | 0;
}

function wrapInt(v: number): number {
  return ((v % SIZE) + SIZE) % SIZE;
}
