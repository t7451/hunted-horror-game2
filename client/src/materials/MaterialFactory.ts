import * as THREE from "three";
import { tier } from "../util/device";
import { generateProceduralMaps } from "./proceduralTextures";

// PBR material factory with 8 slots.
// Loading priority per slot:
//   1. JPG (if present at /assets/textures/{dir}/{slot}_{map}.jpg)
//      — populated by scripts/fetch-textures.mjs (basisu also emits .ktx2)
//   2. KTX2 (preferred when present and the loader is configured)
//   3. Procedural per-material fallback (always available, no network) —
//      see proceduralTextures.ts. This is what the deployed Netlify build
//      uses since the binaries are gitignored.

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
  // JPG paths (populated by scripts/fetch-textures.mjs source jpgs).
  albedoJpg: string;
  normalJpg: string;
  ormJpg: string;
  // KTX2 paths (encoded by scripts/fetch-textures.mjs).
  albedo: string;
  normal: string;
  orm: string;
  // Texture repeat across each face (per-axis identical).
  tiling: number;
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
  },
  wood_floor_worn: {
    albedoJpg: "/assets/textures/floors/wood_floor_worn_albedo.jpg",
    normalJpg: "/assets/textures/floors/wood_floor_worn_normal.jpg",
    ormJpg:    "/assets/textures/floors/wood_floor_worn_orm.jpg",
    albedo: "/assets/textures/floors/wood_floor_worn_01_2k_albedo.ktx2",
    normal: "/assets/textures/floors/wood_floor_worn_01_2k_normal.ktx2",
    orm:    "/assets/textures/floors/wood_floor_worn_01_2k_orm.ktx2",
    tiling: 4,
  },
  plaster_cracked: {
    albedoJpg: "/assets/textures/walls/plaster_cracked_albedo.jpg",
    normalJpg: "/assets/textures/walls/plaster_cracked_normal.jpg",
    ormJpg:    "/assets/textures/walls/plaster_cracked_orm.jpg",
    albedo: "/assets/textures/walls/plaster_cracked_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/plaster_cracked_01_2k_normal.ktx2",
    orm:    "/assets/textures/walls/plaster_cracked_01_2k_orm.ktx2",
    tiling: 1,
  },
  wood_panel_dark: {
    albedoJpg: "/assets/textures/walls/wood_panel_dark_albedo.jpg",
    normalJpg: "/assets/textures/walls/wood_panel_dark_normal.jpg",
    ormJpg:    "/assets/textures/walls/wood_panel_dark_orm.jpg",
    albedo: "/assets/textures/walls/wood_panel_dark_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/wood_panel_dark_01_2k_normal.ktx2",
    orm:    "/assets/textures/walls/wood_panel_dark_01_2k_orm.ktx2",
    tiling: 2,
  },
  tile_kitchen_dirty: {
    albedoJpg: "/assets/textures/floors/tile_kitchen_dirty_albedo.jpg",
    normalJpg: "/assets/textures/floors/tile_kitchen_dirty_normal.jpg",
    ormJpg:    "/assets/textures/floors/tile_kitchen_dirty_orm.jpg",
    albedo: "/assets/textures/floors/tile_kitchen_dirty_01_2k_albedo.ktx2",
    normal: "/assets/textures/floors/tile_kitchen_dirty_01_2k_normal.ktx2",
    orm:    "/assets/textures/floors/tile_kitchen_dirty_01_2k_orm.ktx2",
    tiling: 3,
  },
  ceiling_plaster: {
    albedoJpg: "/assets/textures/walls/ceiling_plaster_albedo.jpg",
    normalJpg: "/assets/textures/walls/ceiling_plaster_normal.jpg",
    ormJpg:    "/assets/textures/walls/ceiling_plaster_orm.jpg",
    albedo: "/assets/textures/walls/plaster_cracked_01_2k_albedo.ktx2",
    normal: "/assets/textures/walls/plaster_cracked_01_2k_normal.ktx2",
    orm:    "/assets/textures/walls/plaster_cracked_01_2k_orm.ktx2",
    tiling: 2,
  },
  door_wood: {
    albedoJpg: "/assets/textures/props/door_wood_albedo.jpg",
    normalJpg: "/assets/textures/props/door_wood_normal.jpg",
    ormJpg:    "/assets/textures/props/door_wood_orm.jpg",
    albedo: "/assets/textures/props/door_wood_01_2k_albedo.ktx2",
    normal: "/assets/textures/props/door_wood_01_2k_normal.ktx2",
    orm:    "/assets/textures/props/door_wood_01_2k_orm.ktx2",
    tiling: 1,
  },
  baseboard_trim: {
    albedoJpg: "/assets/textures/props/baseboard_trim_albedo.jpg",
    normalJpg: "/assets/textures/props/baseboard_trim_normal.jpg",
    ormJpg:    "/assets/textures/props/baseboard_trim_orm.jpg",
    albedo: "/assets/textures/props/baseboard_trim_01_2k_albedo.ktx2",
    normal: "/assets/textures/props/baseboard_trim_01_2k_normal.ktx2",
    orm:    "/assets/textures/props/baseboard_trim_01_2k_orm.ktx2",
    tiling: 4,
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

  // Build a material immediately with the per-material procedural textures,
  // then async-swap in the real maps if JPG/KTX2 files are available.
  // This means the renderer never blocks waiting for assets.
  const mat = buildFallbackMaterial(name, set, anisotropy);
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

  // KTX2 path: if ktx2Loader is configured AND the asset actually loads, it
  // overrides the JPG/procedural maps. On failure (e.g. Netlify deploys where
  // the binaries are gitignored) we leave the existing maps in place rather
  // than overwriting them with a uniform fallback.
  if (deps.ktx2Loader) {
    void loadKtx2(set.albedo, anisotropy, set.tiling, true).then(t => {
      if (t) { mat.map = t; mat.needsUpdate = true; }
    });
    void loadKtx2(set.normal, anisotropy, set.tiling, false).then(t => {
      if (t) { mat.normalMap = t; mat.needsUpdate = true; }
    });
    void loadKtx2(set.orm, anisotropy, set.tiling, false).then(t => {
      if (t) {
        mat.aoMap = t; mat.roughnessMap = t; mat.metalnessMap = t;
        mat.needsUpdate = true;
      }
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

// ── KTX2 loading ────────────────────────────────────────────────────────────

// Resolves to the loaded texture, or null on failure. Failure leaves the
// caller's existing texture (procedural or JPG) in place.
function loadKtx2(url: string, anisotropy: number, tiling: number, srgb: boolean): Promise<THREE.Texture | null> {
  return new Promise(resolve => {
    const loader = deps.ktx2Loader;
    if (!loader) { resolve(null); return; }
    loader.load(
      url,
      tex => { configureTexture(tex, anisotropy, tiling, srgb); resolve(tex); },
      undefined,
      () => resolve(null)
    );
  });
}

// ── Fallback & helpers ───────────────────────────────────────────────────────

function buildFallbackMaterial(name: MaterialName, set: TextureSet, anisotropy: number): THREE.MeshStandardMaterial {
  const { albedoCanvas, normalCanvas, ormCanvas } = generateProceduralMaps(name);
  const albedo = canvasToTexture(albedoCanvas, anisotropy, set.tiling, true);
  const normal = canvasToTexture(normalCanvas, anisotropy, set.tiling, false);
  const orm = canvasToTexture(ormCanvas, anisotropy, set.tiling, false);
  // roughness/metalness = 1.0 lets the ORM map's G/B channels drive the final
  // values directly (three.js multiplies). When a real KTX2/JPG ORM later
  // swaps in via the same channel-packed convention, no scaling change is
  // needed. envMapIntensity stays low to keep horror lighting moody.
  return new THREE.MeshStandardMaterial({
    map: albedo,
    normalMap: normal,
    aoMap: orm,
    roughnessMap: orm,
    metalnessMap: orm,
    color: 0xffffff,
    roughness: 1.0,
    metalness: 1.0,
    aoMapIntensity: 1.0,
    envMapIntensity: 0.4,
  });
}

function canvasToTexture(canvas: HTMLCanvasElement, anisotropy: number, tiling: number, srgb: boolean): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  configureTexture(tex, anisotropy, tiling, srgb);
  return tex;
}

function configureTexture(tex: THREE.Texture, anisotropy: number, tiling: number, srgb: boolean): void {
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(tiling, tiling);
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
}

export function resetMaterialCache(): void {
  cache.forEach(m => m.dispose());
  cache.clear();
}
