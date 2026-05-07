import * as THREE from "three";
import { tier } from "../util/device";

// Single source of truth for PBR materials. Caches by texture-set name so
// shared surfaces (the entire wall InstancedMesh, every floor tile) share
// one material + texture upload.
//
// Phase 4 ships the factory with procedural fallback textures: if the real
// KTX2 asset bundle isn't committed yet, `getMaterial(name)` returns a
// MeshStandardMaterial backed by canvas-generated noise/normal maps. The
// public API is identical, so when KTX2 files land in `public/assets/...`
// nothing in the consuming engine code changes.

export type MaterialName =
  | "wallpaper_dirty"
  | "wood_floor_worn"
  | "plaster_cracked"
  | "wood_panel_dark"
  | "tile_kitchen_dirty"
  | "ceiling_plaster";

type TextureSet = {
  albedo: string;
  normal: string;
  orm: string; // packed AO(R) / Roughness(G) / Metalness(B)
  tiling: number;
  // Fallback color used by the procedural placeholder if the asset 404s.
  fallbackColor: number;
  fallbackRoughness: number;
};

const TEXTURE_SETS: Record<MaterialName, TextureSet> = {
  wallpaper_dirty: {
    albedo: "/assets/textures/walls/wallpaper_dirty_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/wallpaper_dirty_01_2k_normal.ktx2",
    orm: "/assets/textures/walls/wallpaper_dirty_01_2k_orm.ktx2",
    tiling: 2,
    fallbackColor: 0x6b4a32,
    fallbackRoughness: 0.95,
  },
  wood_floor_worn: {
    albedo: "/assets/textures/floors/wood_floor_worn_01_2k_albedo.ktx2",
    normal: "/assets/textures/floors/wood_floor_worn_01_2k_normal.ktx2",
    orm: "/assets/textures/floors/wood_floor_worn_01_2k_orm.ktx2",
    tiling: 4,
    fallbackColor: 0x2a1f17,
    fallbackRoughness: 0.92,
  },
  plaster_cracked: {
    albedo: "/assets/textures/walls/plaster_cracked_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/plaster_cracked_01_2k_normal.ktx2",
    orm: "/assets/textures/walls/plaster_cracked_01_2k_orm.ktx2",
    tiling: 1,
    fallbackColor: 0x4a4038,
    fallbackRoughness: 0.98,
  },
  wood_panel_dark: {
    albedo: "/assets/textures/walls/wood_panel_dark_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/wood_panel_dark_01_2k_normal.ktx2",
    orm: "/assets/textures/walls/wood_panel_dark_01_2k_orm.ktx2",
    tiling: 2,
    fallbackColor: 0x3a2a1c,
    fallbackRoughness: 0.85,
  },
  tile_kitchen_dirty: {
    albedo: "/assets/textures/floors/tile_kitchen_dirty_01_2k_albedo.ktx2",
    normal: "/assets/textures/floors/tile_kitchen_dirty_01_2k_normal.ktx2",
    orm: "/assets/textures/floors/tile_kitchen_dirty_01_2k_orm.ktx2",
    tiling: 3,
    fallbackColor: 0x6a665e,
    fallbackRoughness: 0.6,
  },
  ceiling_plaster: {
    albedo: "/assets/textures/walls/plaster_cracked_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/plaster_cracked_01_2k_normal.ktx2",
    orm: "/assets/textures/walls/plaster_cracked_01_2k_orm.ktx2",
    tiling: 2,
    fallbackColor: 0x14100c,
    fallbackRoughness: 1.0,
  },
};

const cache = new Map<MaterialName, THREE.MeshStandardMaterial>();

type Ktx2LoaderLike = {
  load: (
    url: string,
    onLoad?: (tex: THREE.Texture) => void,
    onProgress?: undefined,
    onError?: (e: unknown) => void
  ) => THREE.Texture;
};

export type MaterialFactoryDeps = {
  ktx2Loader?: Ktx2LoaderLike | null;
};

let deps: MaterialFactoryDeps = {};

export function configureMaterials(d: MaterialFactoryDeps): void {
  deps = d;
}

export function getMaterial(name: MaterialName): THREE.MeshStandardMaterial {
  const cached = cache.get(name);
  if (cached) return cached;

  const set = TEXTURE_SETS[name];
  const anisotropy = tier === "high" ? 8 : 4;

  // If the KTX2 loader isn't configured yet (Phase 1 AssetManager not wired),
  // ship the procedural fallback immediately. Once textures land, calling
  // `configureMaterials({ ktx2Loader })` and clearing the cache will swap
  // them in.
  if (!deps.ktx2Loader) {
    const mat = buildFallbackMaterial(set, anisotropy);
    cache.set(name, mat);
    return mat;
  }

  // Real-asset path: hand back a material whose texture maps point at KTX2
  // URLs. Each map is registered with `onError` → procedural fallback so a
  // missing single map doesn't break the whole material.
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.85,
    metalness: 0,
    aoMapIntensity: 1.0,
    envMapIntensity: 0.4,
  });

  loadKtx2WithFallback(set.albedo, anisotropy, set.tiling, true).then(t => {
    mat.map = t;
    mat.needsUpdate = true;
  });
  loadKtx2WithFallback(set.normal, anisotropy, set.tiling, false).then(t => {
    mat.normalMap = t;
    mat.needsUpdate = true;
  });
  loadKtx2WithFallback(set.orm, anisotropy, set.tiling, false).then(t => {
    mat.aoMap = t;
    mat.roughnessMap = t;
    mat.metalnessMap = t;
    mat.needsUpdate = true;
  });

  cache.set(name, mat);
  return mat;
}

function loadKtx2WithFallback(
  url: string,
  anisotropy: number,
  tiling: number,
  srgb: boolean
): Promise<THREE.Texture> {
  return new Promise(resolve => {
    const loader = deps.ktx2Loader;
    if (!loader) {
      resolve(makeProceduralTexture(0xffffff, anisotropy, tiling, srgb));
      return;
    }
    loader.load(
      url,
      tex => {
        configureTexture(tex, anisotropy, tiling, srgb);
        resolve(tex);
      },
      undefined,
      () => {
        resolve(makeProceduralTexture(0xffffff, anisotropy, tiling, srgb));
      }
    );
  });
}

function buildFallbackMaterial(
  set: TextureSet,
  anisotropy: number
): THREE.MeshStandardMaterial {
  const albedo = makeProceduralTexture(
    set.fallbackColor,
    anisotropy,
    set.tiling,
    true
  );
  const normal = makeProceduralNormalTexture(anisotropy, set.tiling);
  const mat = new THREE.MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    color: 0xffffff,
    roughness: set.fallbackRoughness,
    metalness: 0.02,
    aoMapIntensity: 1.0,
    envMapIntensity: 0.4,
  });
  return mat;
}

function configureTexture(
  tex: THREE.Texture,
  anisotropy: number,
  tiling: number,
  srgb: boolean
): void {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(tiling, tiling);
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
}

// Procedural noise albedo — value-noise pattern grounds materials in
// something better than a flat color. Generated once per (color, tiling)
// at module load and cached on the texture object.
function makeProceduralTexture(
  baseColor: number,
  anisotropy: number,
  tiling: number,
  srgb: boolean
): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const r = (baseColor >> 16) & 0xff;
  const g = (baseColor >> 8) & 0xff;
  const b = baseColor & 0xff;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    // Two-octave hash noise — enough variation to read as "stuff" not a
    // solid fill at flashlight distance.
    const x = i % size;
    const y = (i / size) | 0;
    const n = hash2(x * 0.13, y * 0.17) * 0.6 + hash2(x * 0.41, y * 0.39) * 0.4;
    const k = 0.78 + n * 0.22;
    img.data[i * 4 + 0] = clamp255(r * k);
    img.data[i * 4 + 1] = clamp255(g * k);
    img.data[i * 4 + 2] = clamp255(b * k);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, anisotropy, tiling, srgb);
  return tex;
}

function makeProceduralNormalTexture(
  anisotropy: number,
  tiling: number
): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size;
    const y = (i / size) | 0;
    const dx = hash2(x * 0.21, y * 0.19) - hash2((x - 1) * 0.21, y * 0.19);
    const dy = hash2(x * 0.19, y * 0.21) - hash2(x * 0.19, (y - 1) * 0.21);
    // Pack tangent-space normal into RGB.
    img.data[i * 4 + 0] = clamp255(128 + dx * 80);
    img.data[i * 4 + 1] = clamp255(128 + dy * 80);
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, anisotropy, tiling, false);
  return tex;
}

function hash2(x: number, y: number): number {
  const s = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
  return s - Math.floor(s);
}

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v | 0;
}

// Test hook: clear cache so a Phase 4 re-init after assets land can swap
// fallback materials for the real KTX2-backed ones.
export function resetMaterialCache(): void {
  cache.forEach(m => m.dispose());
  cache.clear();
}
