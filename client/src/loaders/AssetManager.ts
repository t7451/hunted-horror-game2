import * as THREE from "three";

// Centralized asset loader. Phases later in the visual overhaul plan
// (textures, GLB props, audio) all flow through this so the loading screen
// can show real progress + phase labels driven by manifest tags.
//
// Phase 1 ships the skeleton: LoadingManager-backed progress, manifest tagging,
// and lazy-loaded GLTF/KTX2/Meshopt loaders. Wiring of actual assets happens
// in later phases per the spec.

export type AssetKind = "texture" | "model" | "audio";

export type AssetEntry = {
  key: string;
  url: string;
  kind: AssetKind;
  phase?: string; // e.g. "Hanging paintings"
};

export type Manifest = AssetEntry[];

export type LoadResult = {
  textures: Map<string, THREE.Texture>;
  models: Map<string, unknown>; // GLTF type kept loose to avoid eager three-stdlib import
  audio: Map<string, AudioBuffer>;
};

export type ProgressInfo = {
  loaded: number;
  total: number;
  currentItem: string;
};

type ProgressCb = (info: ProgressInfo) => void;
type PhaseCb = (phase: string) => void;

export class AssetManager {
  readonly manager = new THREE.LoadingManager();
  private progressCbs = new Set<ProgressCb>();
  private phaseCbs = new Set<PhaseCb>();
  private currentPhase = "";
  private urlToPhase = new Map<string, string>();
  private loadedCount = 0;
  private totalCount = 0;
  private gltfLoader: unknown | null = null;
  private ktx2Loader: unknown | null = null;
  private audioLoader: THREE.AudioLoader | null = null;
  private audioCtx: AudioContext | null = null;

  constructor(
    private readonly basisPath = "/basis/",
    private readonly dracoPath = "/draco/"
  ) {
    this.manager.onStart = (url, loaded, total) => {
      this.totalCount = total;
      this.loadedCount = loaded;
      this.emitProgress(url);
      this.maybeEmitPhase(url);
    };
    this.manager.onProgress = (url, loaded, total) => {
      this.totalCount = total;
      this.loadedCount = loaded;
      this.emitProgress(url);
      this.maybeEmitPhase(url);
    };
  }

  onProgress(cb: ProgressCb): () => void {
    this.progressCbs.add(cb);
    return () => this.progressCbs.delete(cb);
  }

  onPhase(cb: PhaseCb): () => void {
    this.phaseCbs.add(cb);
    return () => this.phaseCbs.delete(cb);
  }

  async load(
    manifest: Manifest,
    renderer?: THREE.WebGLRenderer
  ): Promise<LoadResult> {
    const result: LoadResult = {
      textures: new Map(),
      models: new Map(),
      audio: new Map(),
    };

    for (const entry of manifest) {
      if (entry.phase) this.urlToPhase.set(entry.url, entry.phase);
    }

    // Group by kind so we can lazy-init only the loaders we need.
    const textures = manifest.filter(m => m.kind === "texture");
    const models = manifest.filter(m => m.kind === "model");
    const audio = manifest.filter(m => m.kind === "audio");

    const tasks: Promise<void>[] = [];

    if (textures.length > 0) {
      const ktx2 = await this.getKtx2Loader(renderer);
      const ktx2Load = ktx2 as {
        loadAsync: (url: string) => Promise<THREE.Texture>;
      } | null;
      const texLoader = new THREE.TextureLoader(this.manager);
      for (const t of textures) {
        if (t.url.endsWith(".ktx2") && ktx2Load) {
          tasks.push(
            ktx2Load.loadAsync(t.url).then(tex => {
              result.textures.set(t.key, tex);
            })
          );
        } else {
          tasks.push(
            texLoader.loadAsync(t.url).then(tex => {
              result.textures.set(t.key, tex);
            })
          );
        }
      }
    }

    if (models.length > 0) {
      const gltf = await this.getGltfLoader();
      const gltfLoad = gltf as { loadAsync: (url: string) => Promise<unknown> };
      for (const m of models) {
        tasks.push(
          gltfLoad.loadAsync(m.url).then(g => {
            result.models.set(m.key, g);
          })
        );
      }
    }

    if (audio.length > 0) {
      this.audioLoader ??= new THREE.AudioLoader(this.manager);
      for (const a of audio) {
        tasks.push(
          this.audioLoader.loadAsync(a.url).then(buf => {
            result.audio.set(a.key, buf);
          })
        );
      }
    }

    await Promise.all(tasks);
    this.emitPhase("Ready");
    return result;
  }

  private async getGltfLoader(): Promise<unknown> {
    if (this.gltfLoader) return this.gltfLoader;
    const stdlib = await import("three-stdlib").catch(() => null);
    if (!stdlib) {
      throw new Error("three-stdlib not installed; cannot load GLTF models");
    }
    const mod = stdlib as {
      GLTFLoader?: new (m: THREE.LoadingManager) => unknown;
      DRACOLoader?: new () => { setDecoderPath: (p: string) => void };
      MeshoptDecoder?: unknown;
    };
    if (!mod.GLTFLoader)
      throw new Error("GLTFLoader missing from three-stdlib");
    const loader = new mod.GLTFLoader(this.manager) as {
      setDRACOLoader: (l: unknown) => void;
      setMeshoptDecoder: (d: unknown) => void;
      setKTX2Loader: (l: unknown) => void;
    };
    if (mod.DRACOLoader) {
      const draco = new mod.DRACOLoader();
      draco.setDecoderPath(this.dracoPath);
      loader.setDRACOLoader(draco);
    }
    if (mod.MeshoptDecoder) loader.setMeshoptDecoder(mod.MeshoptDecoder);
    const ktx2 = await this.getKtx2Loader();
    if (ktx2) loader.setKTX2Loader(ktx2);
    this.gltfLoader = loader;
    return loader;
  }

  private async getKtx2Loader(
    renderer?: THREE.WebGLRenderer
  ): Promise<unknown | null> {
    if (this.ktx2Loader) return this.ktx2Loader;
    const stdlib = await import("three-stdlib").catch(() => null);
    if (!stdlib) return null;
    const mod = stdlib as {
      KTX2Loader?: new (m: THREE.LoadingManager) => {
        setTranscoderPath: (p: string) => void;
        detectSupport: (r: THREE.WebGLRenderer) => unknown;
      };
    };
    if (!mod.KTX2Loader) return null;
    const loader = new mod.KTX2Loader(this.manager);
    loader.setTranscoderPath(this.basisPath);
    if (renderer) loader.detectSupport(renderer);
    this.ktx2Loader = loader;
    return loader;
  }

  private emitProgress(currentItem: string) {
    const info: ProgressInfo = {
      loaded: this.loadedCount,
      total: Math.max(this.totalCount, this.loadedCount),
      currentItem,
    };
    this.progressCbs.forEach(cb => cb(info));
  }

  private maybeEmitPhase(url: string) {
    const phase = this.urlToPhase.get(url);
    if (phase) this.emitPhase(phase);
  }

  private emitPhase(phase: string) {
    if (phase === this.currentPhase) return;
    this.currentPhase = phase;
    this.phaseCbs.forEach(cb => cb(phase));
  }

  getAudioContext(): AudioContext {
    if (!this.audioCtx) {
      const Ctor =
        (window as unknown as { AudioContext: typeof AudioContext })
          .AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.audioCtx = new Ctor();
    }
    return this.audioCtx;
  }
}
