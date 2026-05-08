import * as THREE from "three";
import { tier } from "../util/device";

// PBR material factory with 8 slots.
// Loading priority per slot:
//   1. JPG (if present at /assets/textures/{dir}/{slot}_{map}.jpg)  — populated by scripts/download-textures.js
//   2. KTX2 (future, when basisu pipeline ships)
//   3. Procedural canvas fallback (always available, no network)
//
// The KTX2 infrastructure stays in place (configureMaterials / ktx2Loader) so
// Phase N can swap it in without touching consuming code.

export type MaterialName =
  | "wallpaper_dirty"
  | "wood_floor_worn"
  | "plaster_cracked"
  | "wood_panel_dark"
  | "tile_kitchen_dirty"
  | "ceiling_plaster"
  | "door_wood"
  | "baseboard_trim";

type TextureSet = {
  // JPG paths (populated by scripts/download-textures.js)
  albedoJpg: string;
  normalJpg: string;
  ormJpg: string;
  // KTX2 paths (future pipeline)
  albedo: string;
  normal: string;
  orm: string;
  tiling: number;
  fallbackColor: number;
  fallbackRoughness: number;
};

const TEXTURE_SETS: Record<MaterialName, TextureSet> = {
  wallpaper_dirty: {
    albedoJpg: "/assets/textures/walls/wallpaper_dirty_albedo.jpg",
    normalJpg: "/assets/textures/walls/wallpaper_dirty_normal.jpg",
    ormJpg:    "/assets/textures/walls/wallpaper_dirty_orm.jpg",
    albedo: "/assets/textures/walls/wallpaper_dirty_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/wallpaper_dirty_01_2k_normal.ktx2",
    orm:    "/assets/textures/walls/wallpaper_dirty_01_2k_orm.ktx2",
    tiling: 2,
    fallbackColor: 0x6b4a32,
    fallbackRoughness: 0.95,
  },
  wood_floor_worn: {
    albedoJpg: "/assets/textures/floors/wood_floor_worn_albedo.jpg",
    normalJpg: "/assets/textures/floors/wood_floor_worn_normal.jpg",
    ormJpg:    "/assets/textures/floors/wood_floor_worn_orm.jpg",
    albedo: "/assets/textures/floors/wood_floor_worn_01_2k_albedo.ktx2",
    normal: "/assets/textures/floors/wood_floor_worn_01_2k_normal.ktx2",
    orm:    "/assets/textures/floors/wood_floor_worn_01_2k_orm.ktx2",
    tiling: 4,
    fallbackColor: 0x2a1f17,
    fallbackRoughness: 0.92,
  },
  plaster_cracked: {
    albedoJpg: "/assets/textures/walls/plaster_cracked_albedo.jpg",
    normalJpg: "/assets/textures/walls/plaster_cracked_normal.jpg",
    ormJpg:    "/assets/textures/walls/plaster_cracked_orm.jpg",
    albedo: "/assets/textures/walls/plaster_cracked_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/plaster_cracked_01_2k_normal.ktx2",
    orm:    "/assets/textures/walls/plaster_cracked_01_2k_orm.ktx2",
    tiling: 1,
    fallbackColor: 0x4a4038,
    fallbackRoughness: 0.98,
  },
  wood_panel_dark: {
    albedoJpg: "/assets/textures/walls/wood_panel_dark_albedo.jpg",
    normalJpg: "/assets/textures/walls/wood_panel_dark_normal.jpg",
    ormJpg:    "/assets/textures/walls/wood_panel_dark_orm.jpg",
    albedo: "/assets/textures/walls/wood_panel_dark_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/wood_panel_dark_01_2k_normal.ktx2",
    orm:    "/assets/textures/walls/wood_panel_dark_01_2k_orm.ktx2",
    tiling: 2,
    fallbackColor: 0x3a2a1c,
    fallbackRoughness: 0.85,
  },
  tile_kitchen_dirty: {
    albedoJpg: "/assets/textures/floors/tile_kitchen_dirty_albedo.jpg",
    normalJpg: "/assets/textures/floors/tile_kitchen_dirty_normal.jpg",
    ormJpg:    "/assets/textures/floors/tile_kitchen_dirty_orm.jpg",
    albedo: "/assets/textures/floors/tile_kitchen_dirty_01_2k_albedo.ktx2",
    normal: "/assets/textures/floors/tile_kitchen_dirty_01_2k_normal.ktx2",
    orm:    "/assets/textures/floors/tile_kitchen_dirty_01_2k_orm.ktx2",
    tiling: 3,
    fallbackColor: 0x6a665e,
    fallbackRoughness: 0.6,
  },
  ceiling_plaster: {
    albedoJpg: "/assets/textures/walls/ceiling_plaster_albedo.jpg",
    normalJpg: "/assets/textures/walls/ceiling_plaster_normal.jpg",
    ormJpg:    "/assets/textures/walls/ceiling_plaster_orm.jpg",
    albedo: "/assets/textures/walls/plaster_cracked_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/plaster_cracked_01_2k_normal.ktx2",
    orm:    "/assets/textures/walls/plaster_cracked_01_2k_orm.ktx2",
    tiling: 2,
    fallbackColor: 0x14100c,
    fallbackRoughness: 1.0,
  },
  door_wood: {
    albedoJpg: "/assets/textures/props/door_wood_albedo.jpg",
    normalJpg: "/assets/textures/props/door_wood_normal.jpg",
    ormJpg:    "/assets/textures/props/door_wood_orm.jpg",
    albedo: "/assets/textures/props/door_wood_01_2k_albedo.ktx2",
    normal: "/assets/textures/props/door_wood_01_2k_normal.ktx2",
    orm:    "/assets/textures/props/door_wood_01_2k_orm.ktx2",
    tiling: 1,
    fallbackColor: 0x3a1f10,
    fallbackRoughness: 0.7,
  },
  baseboard_trim: {
    albedoJpg: "/assets/textures/props/baseboard_trim_albedo.jpg",
    normalJpg: "/assets/textures/props/baseboard_trim_normal.jpg",
    ormJpg:    "/assets/textures/props/baseboard_trim_orm.jpg",
    albedo: "/assets/textures/props/baseboard_trim_01_2k_albedo.ktx2",
    normal: "/assets/textures/props/baseboard_trim_01_2k_normal.ktx2",
    orm:    "/assets/textures/props/baseboard_trim_01_2k_orm.ktx2",
    tiling: 4,
    fallbackColor: 0x2a2520,
    fallbackRoughness: 0.88,
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

  // Build a material immediately with the fallback procedural textures,
  // then async-swap in the real maps if JPG files are available.
  // This means the renderer never blocks waiting for assets.
  const mat = buildFallbackMaterial(set, anisotropy);
  cache.set(name, mat);

  // Attempt JPG load via TextureLoader (no extra deps, always available).
  void loadJpgMaps(set, anisotropy).then(maps => {
    if (!maps) return; // all three files 404'd — keep procedural
    if (maps.albedo) { mat.map = maps.albedo; }
    if (maps.normal) { mat.normalMap = maps.normal; }
    if (maps.orm) {
      mat.aoMap = maps.orm;
      mat.roughnessMap = maps.orm;
      mat.metalnessMap = maps.orm;
    }
    mat.needsUpdate = true;
  });

  // KTX2 path: if ktx2Loader is configured it overrides the JPG maps.
  // This fires after JPG so a slow KTX2 decode doesn't block the JPG upgrade.
  if (deps.ktx2Loader) {
    loadKtx2WithFallback(set.albedo, anisotropy, set.tiling, true).then(t => {
      mat.map = t; mat.needsUpdate = true;
    });
    loadKtx2WithFallback(set.normal, anisotropy, set.tiling, false).then(t => {
      mat.normalMap = t; mat.needsUpdate = true;
    });
    loadKtx2WithFallback(set.orm, anisotropy, set.tiling, false).then(t => {
      mat.aoMap = t; mat.roughnessMap = t; mat.metalnessMap = t;
      mat.needsUpdate = true;
    });
  }

  return mat;
}

// ── JPG loading ─────────────────────────────────────────────────────────────

const jpgLoader = new THREE.TextureLoader();

function loadJpg(url: string, anisotropy: number, tiling: number, srgb: boolean): Promise<THREE.Texture | null> {
  return new Promise(resolve => {
    jpgLoader.load(
      url,
      tex => {
        configureTexture(tex, anisotropy, tiling, srgb);
        resolve(tex);
      },
      undefined,
      () => resolve(null) // 404 or decode error → null
    );
  });
}

async function loadJpgMaps(set: TextureSet, anisotropy: number) {
  const [albedo, normal, orm] = await Promise.all([
    loadJpg(set.albedoJpg, anisotropy, set.tiling, true),
    loadJpg(set.normalJpg, anisotropy, set.tiling, false),
    loadJpg(set.ormJpg,    anisotropy, set.tiling, false),
  ]);
  if (!albedo && !normal && !orm) return null;
  return { albedo, normal, orm };
}

// ── KTX2 loading (future) ────────────────────────────────────────────────────

function loadKtx2WithFallback(url: string, anisotropy: number, tiling: number, srgb: boolean): Promise<THREE.Texture> {
  return new Promise(resolve => {
    const loader = deps.ktx2Loader;
    if (!loader) {
      resolve(makeProceduralTexture(0xffffff, anisotropy, tiling, srgb));
      return;
    }
    loader.load(
      url,
      tex => { configureTexture(tex, anisotropy, tiling, srgb); resolve(tex); },
      undefined,
      () => resolve(makeProceduralTexture(0xffffff, anisotropy, tiling, srgb))
    );
  });
}

// ── Fallback & helpers ───────────────────────────────────────────────────────

function buildFallbackMaterial(set: TextureSet, anisotropy: number): THREE.MeshStandardMaterial {
  const albedo = makeProceduralTexture(set.fallbackColor, anisotropy, set.tiling, true);
  const normal = makeProceduralNormalTexture(anisotropy, set.tiling);
  return new THREE.MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    color: 0xffffff,
    roughness: set.fallbackRoughness,
    metalness: 0.02,
    aoMapIntensity: 1.0,
    envMapIntensity: 0.4,
  });
}

function configureTexture(tex: THREE.Texture, anisotropy: number, tiling: number, srgb: boolean): void {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(tiling, tiling);
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
}

function makeProceduralTexture(baseColor: number, anisotropy: number, tiling: number, srgb: boolean): THREE.Texture {
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

function makeProceduralNormalTexture(anisotropy: number, tiling: number): THREE.Texture {
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

export function resetMaterialCache(): void {
  cache.forEach(m => m.dispose());
  cache.clear();
}
